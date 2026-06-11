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
| DTC keeps | "Standard Shipping" €4.95 + "Free Shipping (Orders over €99.99)" |
| Per-kg rate title at checkout | **B2B Weight Shipping** |
| Shopify app | **GN B2B Shipping** (CLI-managed, Client ID `9ea53daf3e8d6f84fc35c4d4c6cf1670`) |

All business rules live in **one file**: [`carrier-service/src/config.ts`](carrier-service/src/config.ts).
Adding a zone later = appending `{ name, countries: ["XX"], perKg: 2.5 }` to `zones`.

## How it works

```
                ┌──────────────────────────────────────────────┐
 Checkout ─────▶│ Shopify                                       │
                │ 1) Carrier Service callback ──────────────────┼─▶ Render app (Component A)
                │    "B2B Weight Shipping" = €/kg × cart weight │◀─ rate JSON (cents, EUR)
                │ 2) Delivery Customization Function (Comp. B): │
                │    B2B buyer → hide native flat rates         │
                │    DTC buyer → hide the per-kg rate           │
                └──────────────────────────────────────────────┘
```

Two components are required because the Carrier Service callback does **not** include any
B2B/DTC information — the carrier app returns its rate for everyone, and the Function does
the visibility split per buyer.

**One CLI-managed app — "GN B2B Shipping" — handles both components:**
it owns the Function extension, declares all Admin API scopes in
[`shopify.app.toml`](shopify.app.toml), and its Client ID + Secret give the setup scripts
their Admin API access (via the OAuth **client credentials grant** — there is no manual
`shpat_` token reveal for CLI/Dev-Dashboard apps).

- **Component A** — [`carrier-service/`](carrier-service/): Node 20 + Express + TypeScript,
  hosted on Render (always-on paid instance). Stateless; callback URL contains a random
  secret segment; requests from other shops are rejected.
- **Component B** — [`extensions/b2b-delivery-visibility/`](extensions/b2b-delivery-visibility/):
  Shopify Function (delivery customization), deployed via Shopify CLI, runs on Shopify, free.

## Repo layout

```
shopify.app.toml            GN B2B Shipping config — scopes, embedded=false (source of truth)
carrier-service/            Component A (deployed to Render, rootDir in render.yaml)
  src/config.ts             ← THE config: zones, per-kg prices, rate titles
  src/rates.ts              pure rate math (unit-tested)
  src/server.ts             Express app: POST /carrier-service/rates/:secret, GET /health
  scripts/lib/admin.ts      Admin GraphQL client + client-credentials token fetch
  scripts/register-carrier.ts    registers/updates the carrier service (idempotent)
  scripts/activate-function.ts   creates + enables the delivery customization
  scripts/check-weights.ts       audits catalog for variants with missing/zero weight
extensions/b2b-delivery-visibility/   Component B (deployed with `shopify app deploy`)
  src/run.graphql           function input query
  src/run.js                hide logic (titles mirrored from config.ts — keep in sync!)
render.yaml                 Render blueprint for Component A
```

## Deploy runbook

Prereqs: Node 20+, Git, Shopify CLI (`npm i -g @shopify/cli@latest`).
Every step below is labeled **[CLI]**, **[Dev Dashboard]** (dev.shopify.com/dashboard),
or **[Render]** / **[Shopify admin]**. You never touch the Dev Dashboard's
"Create version / App URL" form — `shopify app deploy` creates and releases versions
from `shopify.app.toml` (`include_config_on_deploy = true`).

### 1. Link and deploy the app — [CLI]

From the repo root:

```bash
shopify app config link     # pick your organization, then the existing app "GN B2B Shipping"
```

This matches the repo to the existing app. Verify afterwards that `client_id` in
`shopify.app.toml` is still `9ea53daf3e8d6f84fc35c4d4c6cf1670` (the CLI rewrites the file;
all other values should survive — scopes, `embedded = false`, the extension stays wired).

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

1. dev.shopify.com/dashboard → **Apps** → **GN B2B Shipping** → **Home**
2. Scroll to **Installs** → **Install app** → select the ibban store → **Install**

This grants the four scopes. Note for later: if you ever **change** scopes in the TOML,
re-run `shopify app deploy` **and** re-approve the new scopes on the store — scope changes
are not applied to installed stores automatically.

### 3. Set up script credentials — [Dev Dashboard + CLI]

There is no `shpat_` token to copy anywhere. The scripts fetch their own 24-hour Admin
token via the **client credentials grant**, using the app's Client ID + Secret:

1. Dev Dashboard → **Apps → GN B2B Shipping → Settings** → copy **Client ID** and
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

### 4. Deploy Component A — [Render]

1. Render dashboard → **New → Blueprint** → pick this GitHub repo (uses `render.yaml`),
   or create a Web Service manually: root directory `carrier-service`, build
   `npm ci && npm run build`, start `npm start`, health check path `/health`, any **paid**
   instance type (always-on; a cold start would exceed Shopify's ~10 s callback timeout).
2. Set environment variables on the service:
   - `SHOP_DOMAIN` — the store's `*.myshopify.com` domain
   - `CALLBACK_SECRET` — generate with `openssl rand -hex 16` (same value as in `.env`)
3. Deploy, then verify: `curl https://<your-app>.onrender.com/health` → `{"status":"ok"}`.

**⏸ PAUSE — confirm the Render URL and a green health check before continuing.**

### 5. Register the carrier service — [CLI, then Shopify admin]

```bash
cd carrier-service
npm run register-carrier
```

The script is idempotent (re-running updates the callback URL). Afterwards, in
**Shopify admin → Settings → Shipping and delivery**, open the **General** shipping
profile and make sure the new carrier **"ibBan B2B Shipping"** is added as a rate
provider on the relevant zones so its rate is offered at checkout.
**Do NOT touch the existing "Standard Shipping" / "Free Shipping" rates.**

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

- [ ] **DTC checkout** (not logged in as a company): only "Standard Shipping €4.95" /
      "Free Shipping (Orders over €99.99)". Per-kg rate hidden.
- [ ] **B2B checkout** (company login): only "B2B Weight Shipping". Native rates hidden.
- [ ] Spain B2B, 2 kg → **€2.00**
- [ ] Spain B2B, 1.3 kg → **€1.30**
- [ ] Non-ES B2B, 2 kg → **€8.00**
- [ ] Non-ES B2B, 1.3 kg → **€5.20** (true per-kg, no bracket rounding)
- [ ] Rate updates when cart quantity/weight changes

## Changing prices / zones / titles later

1. Edit `carrier-service/src/config.ts` (zones, perKg, minimumCharge…) → push to GitHub →
   Render auto-deploys. Done — no re-registration needed.
2. **Only if you rename rate titles** (`rateServiceName` / `nativeRateTitles`): also update
   the constants at the top of `extensions/b2b-delivery-visibility/src/run.js` and run
   `shopify app deploy`. The function matches titles **exactly** — if they drift, B2B/DTC
   hiding silently breaks.
3. **Only if you change scopes** in `shopify.app.toml`: `shopify app deploy`, then
   re-approve the scopes on the store (installed stores don't pick up scope changes
   automatically).

## Operations notes

- **Logs:** every rate request logs one line on Render: destination country, zone, total kg,
  €/kg, final price, and warnings (e.g. zero cart weight).
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
