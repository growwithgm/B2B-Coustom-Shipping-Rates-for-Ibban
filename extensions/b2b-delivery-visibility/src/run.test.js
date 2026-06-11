import { describe, expect, it } from "vitest";
import { run } from "./run.js";

const OPTIONS = [
  { handle: "std-handle", title: "Standard Shipping", cost: { amount: "4.95" } },
  { handle: "free-handle", title: "Free Shipping (Orders over €99.99)", cost: { amount: "0.0" } },
  { handle: "b2b-handle", title: "B2B Weight Shipping", cost: { amount: "5.2" } },
];

function input(company) {
  return {
    cart: {
      buyerIdentity: company ? { purchasingCompany: { company } } : null,
      deliveryGroups: [{ deliveryOptions: OPTIONS }],
    },
  };
}

describe("delivery customization run", () => {
  it("B2B buyer: hides both native flat rates, keeps the per-kg rate", () => {
    const result = run(input({ id: "gid://shopify/Company/1", name: "Acme GmbH" }));
    expect(result.operations).toEqual([
      { hide: { deliveryOptionHandle: "std-handle" } },
      { hide: { deliveryOptionHandle: "free-handle" } },
    ]);
  });

  it("DTC buyer: hides only the per-kg rate", () => {
    const result = run(input(null));
    expect(result.operations).toEqual([{ hide: { deliveryOptionHandle: "b2b-handle" } }]);
  });

  it("DTC buyer with missing buyerIdentity object entirely", () => {
    const result = run({ cart: { buyerIdentity: null, deliveryGroups: [{ deliveryOptions: OPTIONS }] } });
    expect(result.operations).toEqual([{ hide: { deliveryOptionHandle: "b2b-handle" } }]);
  });

  it("does not touch unknown option titles", () => {
    const result = run({
      cart: {
        buyerIdentity: { purchasingCompany: { company: { id: "gid://shopify/Company/1" } } },
        deliveryGroups: [
          { deliveryOptions: [{ handle: "x", title: "Some Other Rate", cost: { amount: "9.99" } }] },
        ],
      },
    });
    expect(result.operations).toEqual([]);
  });

  it("handles empty delivery groups", () => {
    const result = run({ cart: { buyerIdentity: null, deliveryGroups: [] } });
    expect(result.operations).toEqual([]);
  });
});
