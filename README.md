# ibBan — B2B-only Weight-Based Shipping

B2B (company) buyers on **ibban.com** get a true per-kg shipping rate; DTC buyers keep the
existing native flat rates, completely untouched.

| Setting | Value |
|---|---|
| Spain (ES) | €1.00 / kg |
| All other countries | €4.00 / kg |
| Basis | total cart weight, true per-kg (1.3 kg → €5.20) |
| Currency | EUR |
| Applies to | B2B (company) buyers only |
| DTC keeps | all native rates of the General profile, whatever they are called |
| Per-kg rate title at checkout | **B2B Weight Shipping** |
| Shopify app | installed on ibban.com as **ibBan B2B Shipping New** (by Ibban.com); repo config was created as GN B2B Shipping — run `shopify app config link` against the installed app |
| Hosting | carrier service on **Vercel** (zero-config Express, Fluid compute) |

All business rules live in **one file**: [`carrier-service/src/config.ts`](carrier-service/src/config.ts).
Adding a zone later = appending `{ name, countries: ["XX"], perKg: 2.5 }` to `zones`.

## How it works

```
                ┌──────────────────────────────────────────────┐
 Checkout ─────▶│ Shopify                                       │
                │ 1) Carrier Service callback ──────────────────┼─▶ Vercel app (Component A)
                │    "B2B Weight Shipping" = €/kg × cart weight │◀─ rate JSON (cents, EUR)
                │ 2) Delivery Customization Function (Comp. B): │
                │    B2B buyer → hide every non-per-kg option   │
                │    DTC buyer → hide the per-kg rate           │
                └──────────────────────────────────────────────┘
```

Two components are required because the Carrier Service callback does **not** include any
B2B/DTC information — the carrier app returns its rate for everyone, and the Function does
the visibility split per buyer.

**One CLI-managed app — "ibBan B2B Shipping New" on the store — handles both components:**
it owns the Function extension, declares all Admin API scopes in
[`shopify.app.toml`](shopify.app.toml), and its Client ID + Secret give the setup scripts
their Admin API access (via the OAuth **client credentials grant** — there is no manual
`shpat_` token reveal for CLI/Dev-Dashboard apps).

- **Component A** — [`carrier-service/`](carrier-service/): Node 20 + Express + TypeScript,
  hosted on Vercel (the Express app becomes one Vercel Function; Fluid compute keeps cold
  starts well under Shopify's ~10 s callback timeout). Stateless; callback URL contains a
  random secret segment; requests from other shops are rejected.
- **Component B** — [`extensions/b2b-delivery-visibility/`](extensions/b2b-delivery-visibility/):
  Shopify Function (delivery customization), deployed via Shopify CLI, runs on Shopify, free.

## Repo layout

```
shopify.app.toml            app config — scopes, embedded=false (source of truth)
carrier-service/            Component A (Vercel project, Root Directory = carrier-service)
  src/config.ts             ← THE config: zones, per-kg prices, rate title
  src/rates.ts              pure rate math (unit-tested)
  src/server.ts             Express app (default export for Vercel): POST /carrier-service/rates/:secret, GET /health
  scripts/lib/admin.ts      Admin GraphQL client + client-credentials token fetch
  scripts/register-carrier.ts    registers/updates the carrier service (idempotent)
  scripts/activate-function.ts   creates + enables the delivery customization
  scripts/check-weights.ts       audits catalog for variants with missing/zero weight
extensions/b2b-delivery-visibility/   Component B (deployed with `shopify app deploy`)
  src/run.graphql           function input query
  src/run.js                hide logic (per-kg title mirrored from config.ts — keep in sync!)
```

## Moving from Render to Vercel (Oct 2026)

The carrier service used to run on Render (`ibban-b2b-shipping.onrender.com`). To move it:

1. Deploy `carrier-service` on Vercel (runbook step 4) with the **same** `SHOP_DOMAIN`
   and `CALLBACK_SECRET` values.
2. Set `APP_URL` in `carrier-service/.env` to the Vercel production URL and run
   `npm run register-carrier` (runbook step 5) — it updates the existing carrier's
   callback URL in place; zones that already use the carrier keep it.
3. Test a B2B and a DTC checkout (step 8), check the Vercel logs show the rate requests,
   then shut the Render service down.

## Deploy runbook

Prereqs: Node 20+, Git, Shopify CLI (`npm i -g @shopify/cli@latest`).
Every step below is labeled **[CLI]**, **[Dev Dashboard]** (dev.shopify.com/dashboard),
or **[Vercel]** / **[Shopify admin]**. You never touch the Dev Dashboard's
"Create version / App URL" form — `shopify app deploy` creates and releases versions
from `shopify.app.toml` (`include_config_on_deploy = true`).

### 1. Link and deploy the app — [CLI]

From the repo root:

```bash
shopify app config link     # pick the Ibban.com organization, then the app installed on the
                            # store ("ibBan B2B Shipping New")
```

This matches the repo to the app that is actually installed on ibban.com and owns the
live Function + carrier service. That app lives in the **Ibban.com** Dev Dashboard
organization (open it from the store admin: store name menu → Dev Dashboard), not in the
Grow Nest organization — the two "GN B2B Shipping" apps there have 0 installs. The CLI
rewrites `client_id` in `shopify.app.toml`; all other values should survive (scopes,
`embedded = false`, the extension stays wired).

```bash
# REQUIRED before deploy: the CLI's JS-function build needs the
# @shopify/shopify_function library installed inside the extension.
npm install --prefix extensions/b2b-delivery-visibility

shopify app deploy          # pushes config + the Function, creates AND releases the version
```

The function build runs three steps (GraphQL typegen → ESBuild bundle → Javy wasm
compile) and downloads its toolchain on first run. A committed minimal
`schema.graphql` makes typegen work out of the box; to refresh it to the full
version-exact schema any time, run
`shopify app function schema --path extensions/b2b-delivery-visibility`.

(`--no-release` exists if you ever want a staged version; you don't need it here.)

> Deploying the Function does **not** activate it. Activation is step 6 — deliberately
> last. **Do not activate the Function before the carrier rate is live (step 5), or B2B
> checkout would hide the native rates and show NO shipping option at all.**

### 2. Install the app on the store — [Dev Dashboard]

1. Dev Dashboard (Ibban.com organization) → **Apps** → **ibBan B2B Shipping New** → **Home**
2. Scroll to **Installs** → **Install app** → select the ibban store → **Install**

This grants the four scopes. Note for later: if you ever **change** scopes in the TOML,
re-run `shopify app deploy` **and** re-approve the new scopes on the store — scope changes
are not applied to installed stores automatically.

### 3. Set up script credentials — [Dev Dashboard + CLI]

There is no `shpat_` token to copy anywhere. The scripts fetch their own 24-hour Admin
token via the **client credentials grant**, using the app's Client ID + Secret:

1. Dev Dashboard (Ibban.com organization) → **Apps → ibBan B2B Shipping New → Settings** → copy **Client ID** and
   **Client secret**.
2. ```bash
   cd carrier-service
   npm install
   cp .env.example .env    # fill in SHOP_DOMAIN, SHOPIFY_CLIENT_SECRET, APP_URL, CALLBACK_SECRET
   ```

**Ordering matters:** the grant only works after steps 1–2 (version deployed → app
installed → scopes granted). If you see `shop_not_permitted`, the app and store aren't in
the same Dev Dashboard organization — open the dashboard from the store's admin (store
name menu → Dev Dashboard) and check the app is listed there.

(The Dev Dashboard's "App Automation Tokens" are **not** this — those authenticate the
CLI in CI/CD pipelines, not Admin API calls.)

### 4. Deploy Component A — [Vercel]

1. vercel.com → **Add New… → Project** → import this GitHub repo.
2. **Root Directory:** `carrier-service`. Framework preset: **Express** (auto-detected —
   `src/server.ts` default-exports the app). Leave build/output settings on default.
3. **Environment Variables** (Production):
   - `SHOP_DOMAIN` — the store's `*.myshopify.com` domain
   - `CALLBACK_SECRET` — generate with `openssl rand -hex 16` (same value as in `.env`)
4. Deploy, then verify: open `https://<project>.vercel.app/health` → `{"status":"ok"}`.
   Use the **production** domain (`<project>.vercel.app`), never a preview URL — preview
   deployments sit behind Vercel's deployment protection and would reject Shopify.
5. Put that URL in `carrier-service/.env` as `APP_URL`, and in `shopify.app.toml`
   (`application_url` + `redirect_urls`).

Every push to `main` redeploys automatically.

**⏸ PAUSE — confirm the Vercel URL and a green health check before continuing.**

### 5. Register the carrier service — [CLI, then Shopify admin]

```bash
cd carrier-service
npm run register-carrier
```

The script is idempotent (re-running updates the callback URL). Afterwards, in
**Shopify admin → Settings → Shipping and delivery**, open the **General** shipping
profile and make sure the carrier **"ibBan B2B Shipping"** is added as a rate provider
on **every** zone (Add shipping option → Use carrier or app to calculate rates). A zone
without it never offers "B2B Weight Shipping", so B2B buyers there fall back to the native
rates — including free shipping. Leave the existing native rates as they are.

Test: add a weighted product to the cart and go to checkout — at this point **everyone**
(B2B and DTC) sees "B2B Weight Shipping" alongside the native rates. That's expected
and required before the next step.

**⏸ PAUSE — confirm the per-kg rate appears at a test checkout. Only proceed once it
does: activating the Function while the carrier rate is missing would leave B2B buyers
with no shipping options.**

### 6. Activate the Function — [CLI]

```bash
cd carrier-service
npm run activate-function
```

The script finds the deployed delivery-customization function, checks nothing is already
active, and runs `deliveryCustomizationCreate` (enabled immediately). Because the token
comes from the same app that owns the Function, no ownership workaround is needed.

### 7. Verify product weights (mandatory!) — [CLI]

Weight-based rates compute from variant `grams`. Any product missing a weight ships wrong.

```bash
cd carrier-service
npm run check-weights      # lists every variant with missing/zero weight; exits 1 if any ACTIVE
```

Fix weights in admin (include packaging weight) before going live.

> A first audit (2026-06-11) already found at least one ACTIVE product with zero weight:
> "ibBan Women's Long Necklace Soni" (SKU IBN-400127). Run the full audit before launch.

### 8. Test checklist

- [ ] **DTC checkout** (not logged in as a company): only the native rates
      ("Standard delivery…" / "FREE delivery…"). Per-kg rate hidden.
- [ ] **B2B checkout** (company login): only "B2B Weight Shipping". Native rates hidden,
      including FREE delivery on orders above the free-shipping threshold.
- [ ] Spain B2B, 2 kg → **€2.00**
- [ ] Spain B2B, 1.3 kg → **€1.30**
- [ ] Non-ES B2B, 2 kg → **€8.00**
- [ ] Non-ES B2B, 1.3 kg → **€5.20** (true per-kg, no bracket rounding)
- [ ] Rate updates when cart quantity/weight changes

## Changing prices / zones / titles later

1. Edit `carrier-service/src/config.ts` (zones, perKg, minimumCharge…) → push to GitHub →
   Vercel auto-deploys. Done — no re-registration needed.
2. **Renaming or adding native rates** in Shopify admin needs **no code change** — the
   Function hides every non-carrier option for B2B buyers, whatever it is called. Only
   remember to add the carrier to any **new zone** (see step 5).
3. **Only if you rename the per-kg rate** (`rateServiceName`): also update
   `B2B_RATE_TITLE` at the top of `extensions/b2b-delivery-visibility/src/run.js` and run
   `shopify app deploy`. If they drift, B2B/DTC hiding silently breaks.
4. **Only if you change scopes** in `shopify.app.toml`: `shopify app deploy`, then
   re-approve the scopes on the store (installed stores don't pick up scope changes
   automatically).

## Operations notes

- **Logs:** every rate request logs one line (Vercel → project → Logs): destination
  country, zone, total kg, €/kg, final price, and warnings (e.g. zero cart weight).
- **Uptime:** point a monitor (UptimeRobot etc.) at `GET /health`. If the app is down or
  slower than ~10 s, Shopify shows no per-kg rate and B2B buyers may see no shipping options.
- **Security:** the callback path embeds `CALLBACK_SECRET` (carrier callbacks aren't
  HMAC-signed); wrong secret → 404, wrong shop domain → 403. The endpoint is stateless.
  Keep `SHOPIFY_CLIENT_SECRET` out of git (`.env` is gitignored); rotate it in the Dev
  Dashboard if it ever leaks.
- **Tokens:** scripts mint a fresh 24-hour Admin token per run via the client credentials
  grant — nothing to store or rotate manually.
- **Tests:** `npm test` at repo root runs both unit suites (rate math + function logic).

## Local development

```bash
cd carrier-service && npm install
npm run dev        # server on :3000 with CALLBACK_SECRET from your shell/.env
npm test
```

```bash
cd extensions/b2b-delivery-visibility && npm install && npm test
```
