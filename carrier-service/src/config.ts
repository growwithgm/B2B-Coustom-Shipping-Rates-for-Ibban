// config.ts — single source of truth for the shipping business rules.
//
// To add a new zone later, append { name, countries: [...], perKg } to `zones`.
// First match wins; any country not matched falls back to `defaultPerKg`.
//
// IMPORTANT: `rateServiceName` and `nativeRateTitles` are mirrored in the
// Delivery Customization Function at
//   extensions/b2b-delivery-visibility/src/run.js
// If you change them here, change them there too and redeploy the function
// (`shopify app deploy`), otherwise the B2B/DTC hiding breaks.

export interface ShippingZone {
  name: string;
  /** ISO 3166-1 alpha-2 country codes */
  countries: string[];
  /** EUR per kilogram */
  perKg: number;
}

export interface ShippingConfig {
  currency: string;
  /** Title shown at checkout for the per-kg rate */
  rateServiceName: string;
  rateServiceCode: string;
  rateDescription: string;
  /** Name of the carrier service as registered in Shopify admin */
  carrierName: string;
  /** EUR; raise later if you want a price floor */
  minimumCharge: number;
  /** First match wins */
  zones: ShippingZone[];
  /** EUR per kg for every country NOT matched by a zone */
  defaultPerKg: number;
  /** Native rate titles to HIDE from B2B buyers (must match checkout titles exactly) */
  nativeRateTitles: string[];
}

export const SHIPPING_CONFIG: ShippingConfig = {
  currency: "EUR",
  rateServiceName: "B2B Weight Shipping",
  rateServiceCode: "B2B_WEIGHT",
  rateDescription: "Calculated by weight",
  carrierName: "ibBan B2B Shipping",
  minimumCharge: 0.0,
  zones: [
    { name: "Spain", countries: ["ES"], perKg: 1.0 },
  ],
  defaultPerKg: 4.0,
  // Verified 2026-06-11 against the live General profile via the Admin API —
  // these match the store's method definition names character-for-character.
  nativeRateTitles: [
    "Standard Shipping",
    "Free Shipping (Orders over €99.99)",
  ],
};
