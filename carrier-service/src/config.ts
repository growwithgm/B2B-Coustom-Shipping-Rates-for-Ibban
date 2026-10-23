// config.ts — single source of truth for the shipping business rules.
//
// To add a new zone later, append { name, countries: [...], perKg } to `zones`.
// First match wins; any country not matched falls back to `defaultPerKg`.
//
// IMPORTANT: `rateServiceName` is mirrored in the Delivery Customization
// Function at extensions/b2b-delivery-visibility/src/run.js (B2B_RATE_TITLE).
// If you change it here, change it there too and redeploy the function
// (`shopify app deploy`), otherwise the B2B/DTC hiding breaks.
// The store's native rate names do NOT matter any more — the function hides
// every non-carrier option for B2B buyers, whatever the native rates are called.

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
};
