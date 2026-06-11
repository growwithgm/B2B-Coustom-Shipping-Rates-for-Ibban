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

- **Component A** — [`carrier-service/`](carrier-service/): Node 20 + Express + TypeScript,
  hosted on Render (always-on paid instance). Stateless; callback URL contains a random
  secret segment; requests from other shops are rejected.
- **Component B** — [`extensions/b2b-delivery-visibility/`](extensions/b2b-delivery-visibility/):
  Shopify Function (delivery customization), deployed via Shopify CLI, runs on Shopify, free.

## Repo layout

```
carrier-service/            Component A (deployed to Render, rootDir in render.yaml)
  src/config.ts             ← THE config: zones, per-kg prices, rate titles
  src/rates.ts              pure rate math (unit-tested)
  src/server.ts             Express app: POST /carrier-service/rates/:secret, GET /health
  scripts/register-carrier.ts    registers/updates the carrier service (idempotent)
  scripts/activate-function.ts   creates + enables the delivery customization
  scripts/check-weights.ts       audits catalog for variants with missing/zero weight
extensions/b2b-delivery-visibility/   Component B (deployed with `shopify app deploy`)
  src/run.graphql           function input query
  src/run.js                hide logic (titles mirrored from config.ts — keep in sync!)
render.yaml                 Render blueprint for Component A
shopify.app.toml            Shopify CLI app config (link with `shopify app config link`)
```

## Deploy runbook

Prereqs: Node 20+, Git, Shopify CLI (`npm i -g @shopify/cli@latest`), Render account,
this repo on GitHub. The Carrier Service API is already enabled on the store's plan.

### 1. Create the Admin API token (custom app)

Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**
(name e.g. `ibban-b2b-shipping-admin`). Under *Configuration → Admin API integration*
grant scopes:

- `write_shipping` (carrier service registration)
- `write_delivery_customizations` (function activation)
- `read_products` + `read_inventory` (weight audit — variant weights live on the inventory item)

Install the app on the store and copy the **Admin API access token** (`shpat_…`, shown once).

### 2. Deploy Component A on Render

1. Render dashboard → **New → Blueprint** → pick this GitHub repo (uses `render.yaml`),
   or create a Web Service manually: root directory `carrier-service`, build
   `npm ci && npm run build`, start `npm start`, health check path `/health`, any **paid**
   instance type (always-on; a cold start would exceed Shopify's ~10 s callback timeout).
2. Set environment variables on the service:
   - `SHOP_DOMAIN` — the store's `*.myshopify.com` domain
   - `CALLBACK_SECRET` — generate with `openssl rand -hex 16`
3. Deploy, then verify: `curl https://<your-app>.onrender.com/health` → `{"status":"ok"}`.

**⏸ PAUSE — confirm the Render URL and a green health check before continuing.**

### 3. Register the carrier service

```bash
cd carrier-service
npm install
cp .env.example .env     # fill in SHOP_DOMAIN, ADMIN_API_ACCESS_TOKEN, APP_URL, CALLBACK_SECRET
npm run register-carrier
```

The script is idempotent (re-running updates the callback URL). Afterwards, in
**Settings → Shipping and delivery**, open the **General** shipping profile and make sure
the new carrier **"ibBan B2B Shipping"** is added as a rate provider on the relevant zones
(domestic + international) so its rate is offered at checkout.
**Do NOT touch the existing "Standard Shipping" / "Free Shipping" rates.**

Test: add a weighted product to the cart and go to checkout — at this point **everyone**
(B2B and DTC) sees "B2B Weight Shipping" alongside the native rates. That's expected;
step 4 fixes visibility.

**⏸ PAUSE — confirm the rate appears at a test checkout.**

### 4. Deploy + activate Component B (the function)

```bash
shopify app config link    # create/link the CLI app; choose CUSTOM distribution
shopify app deploy         # uploads the function
```

Install the app on the store (Partner dashboard → the app → choose Distribution →
generate the single-store install link for ibban.com).

Then activate the customization:

```bash
cd carrier-service
npm run activate-function
```

If the mutation is rejected because the function belongs to the CLI app (not the admin
custom app whose token you're using), use the fallback printed by the script: run
`shopify app dev`, open the dev console GraphiQL, and execute `deliveryCustomizationCreate`
there — it runs as the owning app. (Mutation text is in
`carrier-service/scripts/activate-function.ts`.)

### 5. Verify product weights (mandatory!)

Weight-based rates compute from variant `grams`. Any product missing a weight ships wrong.

```bash
cd carrier-service
npm run check-weights      # lists every variant with missing/zero weight; exits 1 if any ACTIVE
```

Fix weights in admin (include packaging weight) before going live.

> A first audit (2026-06-11) already found at least one ACTIVE product with zero weight:
> "ibBan Women's Long Necklace Soni" (SKU IBN-400127). Run the full audit before launch.

### 6. Test checklist

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

## Operations notes

- **Logs:** every rate request logs one line on Render: destination country, zone, total kg,
  €/kg, final price, and warnings (e.g. zero cart weight).
- **Uptime:** point a monitor (UptimeRobot etc.) at `GET /health`. If the app is down or
  slower than ~10 s, Shopify shows no per-kg rate and B2B buyers may see no shipping options.
- **Security:** the callback path embeds `CALLBACK_SECRET` (carrier callbacks aren't
  HMAC-signed); wrong secret → 404, wrong shop domain → 403. The endpoint is stateless.
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
