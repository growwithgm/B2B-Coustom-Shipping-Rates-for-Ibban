import { timingSafeEqual } from "node:crypto";
import express from "express";
import { calculateRates, type RateRequest } from "./rates.js";

const PORT = Number(process.env.PORT ?? 3000);
const CALLBACK_SECRET = process.env.CALLBACK_SECRET ?? "";
const SHOP_DOMAIN = (process.env.SHOP_DOMAIN ?? "").toLowerCase();

if (!CALLBACK_SECRET) {
  console.warn(
    "[startup] CALLBACK_SECRET is not set — the rates endpoint will reject every request. " +
      "Set it in the Render environment (and use the same value when running register-carrier).",
  );
}

function secretMatches(candidate: string): boolean {
  if (!CALLBACK_SECRET) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(CALLBACK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Shopify CarrierService callback. The :secret path segment keeps the URL
// unguessable (carrier callbacks are not HMAC-signed like webhooks).
app.post("/carrier-service/rates/:secret", (req, res) => {
  if (!secretMatches(req.params.secret)) {
    res.status(404).end();
    return;
  }

  const shopHeader = (req.get("x-shopify-shop-domain") ?? "").toLowerCase();
  if (SHOP_DOMAIN && shopHeader && shopHeader !== SHOP_DOMAIN) {
    console.warn(`[rates] rejected request from unexpected shop "${shopHeader}"`);
    res.status(403).json({ rates: [] });
    return;
  }

  try {
    const rateRequest: RateRequest | undefined = req.body?.rate;
    if (!rateRequest) {
      console.warn("[rates] request body had no `rate` object — returning no rates");
      res.status(200).json({ rates: [] });
      return;
    }

    const { rates, diagnostics } = calculateRates(rateRequest);
    console.log(
      `[rates] country=${diagnostics.country} zone=${diagnostics.zone} ` +
        `totalKg=${diagnostics.totalKg.toFixed(3)} perKg=€${diagnostics.perKg.toFixed(2)} ` +
        `price=€${(diagnostics.priceCents / 100).toFixed(2)}` +
        (diagnostics.warnings.length ? ` WARNINGS: ${diagnostics.warnings.join(" | ")}` : ""),
    );
    res.status(200).json({ rates });
  } catch (error) {
    // Never crash the callback: an empty rate list just hides the option.
    console.error("[rates] unexpected error:", error);
    res.status(200).json({ rates: [] });
  }
});

app.listen(PORT, () => {
  console.log(`[startup] carrier service listening on port ${PORT}`);
});
