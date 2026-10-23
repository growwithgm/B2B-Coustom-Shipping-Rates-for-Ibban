// Delivery Customization Function — B2B/DTC shipping option visibility.
// Target: cart.delivery-options.transform.run
//
// Rule:
//   B2B buyer (purchasingCompany set) → keep ONLY the per-kg carrier rate,
//                                       hide every other option.
//   DTC buyer                          → hide the per-kg carrier rate,
//                                       leave everything else untouched.
//
// The function no longer depends on the names of the store's native rates.
// Earlier it hid a fixed list of native titles ("Standard Shipping", …);
// when the shipping zones were rebuilt with new names ("FREE delivery",
// "Standard delivery - 2 to 4 days", …) nothing matched any more and B2B
// buyers checked out with free native shipping. Now anything that is not the
// carrier rate is treated as native, whatever it is called.
//
// KEEP IN SYNC with carrier-service/src/config.ts:
//   B2B_RATE_TITLE === SHIPPING_CONFIG.rateServiceName
// Matched by substring because Shopify may prepend the carrier name to
// carrier-service option titles (e.g. "ibBan B2B Shipping B2B Weight Shipping").

const B2B_RATE_TITLE = "B2B Weight Shipping";

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 */

/** @param {{ title?: string | null }} option */
function isCarrierRate(option) {
  return (option.title ?? "").includes(B2B_RATE_TITLE);
}

/**
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function run(input) {
  const isB2B = Boolean(input.cart.buyerIdentity?.purchasingCompany?.company);

  const operations = [];
  for (const group of input.cart.deliveryGroups ?? []) {
    const options = group.deliveryOptions ?? [];

    let toHide;
    if (isB2B) {
      // Only hide the native options when the per-kg rate is actually offered
      // for this delivery group. If the carrier rate is missing (server down,
      // carrier not added to this zone), hiding everything would leave the
      // B2B buyer with no way to check out at all.
      toHide = options.some(isCarrierRate)
        ? options.filter((option) => !isCarrierRate(option))
        : [];
    } else {
      toHide = options.filter(isCarrierRate);
    }

    for (const option of toHide) {
      operations.push({
        deliveryOptionHide: { deliveryOptionHandle: option.handle },
      });
    }
  }

  return { operations };
}
