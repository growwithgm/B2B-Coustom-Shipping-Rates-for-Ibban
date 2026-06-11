// Delivery Customization Function — B2B/DTC shipping option visibility.
//
// KEEP IN SYNC with carrier-service/src/config.ts:
//   B2B_RATE_TITLE      === SHIPPING_CONFIG.rateServiceName
//   NATIVE_RATE_TITLES  === SHIPPING_CONFIG.nativeRateTitles
// Titles are matched EXACTLY against the checkout delivery option titles.
// If they drift, the B2B/DTC split silently stops working.

const B2B_RATE_TITLE = "B2B Weight Shipping";
const NATIVE_RATE_TITLES = [
  "Standard Shipping",
  "Free Shipping (Orders over €99.99)",
];

/**
 * @param {import("../generated/api").RunInput} input
 * @returns {import("../generated/api").FunctionRunResult}
 */
export function run(input) {
  const isB2B = Boolean(input.cart.buyerIdentity?.purchasingCompany?.company);

  const operations = [];
  for (const group of input.cart.deliveryGroups ?? []) {
    for (const option of group.deliveryOptions ?? []) {
      const title = option.title ?? "";
      const shouldHide = isB2B
        ? NATIVE_RATE_TITLES.includes(title) // B2B buyer: hide the native flat rates
        : title === B2B_RATE_TITLE; // DTC buyer: hide the per-kg rate
      if (shouldHide) {
        operations.push({ hide: { deliveryOptionHandle: option.handle } });
      }
    }
  }

  return { operations };
}
