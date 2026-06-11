// Pure rate calculation — no I/O, fully unit-tested.

import { SHIPPING_CONFIG } from "./config.js";

/** Shape of an item inside Shopify's CarrierService rate request. */
export interface RateRequestItem {
  name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  grams?: number | null;
  requires_shipping?: boolean | null;
}

/** The `rate` object Shopify POSTs to the callback. Only fields we use. */
export interface RateRequest {
  origin?: { country?: string | null } | null;
  destination?: { country?: string | null } | null;
  items?: RateRequestItem[] | null;
  currency?: string | null;
}

/** One entry of the CarrierService JSON response. total_price is integer cents as a string. */
export interface CarrierRate {
  service_name: string;
  service_code: string;
  total_price: string;
  currency: string;
  description: string;
}

export interface RateResult {
  rates: CarrierRate[];
  diagnostics: {
    country: string;
    zone: string;
    totalKg: number;
    perKg: number;
    priceCents: number;
    warnings: string[];
  };
}

export function calculateRates(rate: RateRequest): RateResult {
  const warnings: string[] = [];

  const items = rate.items ?? [];
  const totalGrams = items
    .filter((item) => item.requires_shipping !== false)
    .reduce(
      (sum, item) =>
        sum + Math.max(0, item.grams ?? 0) * Math.max(0, item.quantity ?? 0),
      0,
    );
  const totalKg = totalGrams / 1000;

  const country = (rate.destination?.country ?? "").toUpperCase();
  if (!country) {
    warnings.push("Missing destination country — using default per-kg rate.");
  }

  const zone = SHIPPING_CONFIG.zones.find((z) => z.countries.includes(country));
  const perKg = zone ? zone.perKg : SHIPPING_CONFIG.defaultPerKg;

  // Integer math in cents avoids floating-point drift: €/kg × grams ÷ 1000.
  const minimumCents = Math.round(SHIPPING_CONFIG.minimumCharge * 100);
  let priceCents = Math.round((Math.round(perKg * 100) * totalGrams) / 1000);

  if (totalGrams === 0) {
    warnings.push(
      "Total cart weight is 0 g — products are probably missing weights. Charging the minimum.",
    );
    priceCents = minimumCents;
  }
  priceCents = Math.max(priceCents, minimumCents);

  return {
    rates: [
      {
        service_name: SHIPPING_CONFIG.rateServiceName,
        service_code: SHIPPING_CONFIG.rateServiceCode,
        total_price: String(priceCents),
        currency: SHIPPING_CONFIG.currency,
        description: SHIPPING_CONFIG.rateDescription,
      },
    ],
    diagnostics: {
      country: country || "??",
      zone: zone ? zone.name : "default",
      totalKg,
      perKg,
      priceCents,
      warnings,
    },
  };
}
