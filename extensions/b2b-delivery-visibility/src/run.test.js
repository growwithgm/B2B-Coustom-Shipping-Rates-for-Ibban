import { describe, expect, it } from "vitest";
import { run } from "./run.js";

// Mirrors the live ibban.com zones (Oct 2026): native titles were renamed from
// "Standard Shipping" / "Free Shipping (Orders over €99.99)" to these.
const OPTIONS = [
  { handle: "free-handle", title: "FREE delivery - 2 to 4 days", cost: { amount: "0.0" } },
  { handle: "std-handle", title: "Standard delivery - 2 to 4 days", cost: { amount: "4.95" } },
  { handle: "b2b-handle", title: "B2B Weight Shipping", cost: { amount: "5.2" } },
];

const COMPANY = { id: "gid://shopify/Company/1", name: "Acme GmbH" };

function input(company, options = OPTIONS) {
  return {
    cart: {
      buyerIdentity: company ? { purchasingCompany: { company } } : null,
      deliveryGroups: [{ deliveryOptions: options }],
    },
  };
}

describe("delivery customization run", () => {
  it("B2B buyer: hides every native rate, keeps only the per-kg rate", () => {
    const result = run(input(COMPANY));
    expect(result.operations).toEqual([
      { deliveryOptionHide: { deliveryOptionHandle: "free-handle" } },
      { deliveryOptionHide: { deliveryOptionHandle: "std-handle" } },
    ]);
  });

  it("B2B buyer: native rates are hidden whatever they are called", () => {
    const result = run(
      input(COMPANY, [
        { handle: "old-std", title: "Standard Shipping", cost: { amount: "4.95" } },
        { handle: "old-free", title: "Free Shipping (Orders over €99.99)", cost: { amount: "0.0" } },
        { handle: "quoted", title: "Standard delivery - quoted at checkout", cost: { amount: "140.0" } },
        { handle: "b2b", title: "ibBan B2B Shipping B2B Weight Shipping", cost: { amount: "5.2" } },
      ]),
    );
    expect(result.operations).toEqual([
      { deliveryOptionHide: { deliveryOptionHandle: "old-std" } },
      { deliveryOptionHide: { deliveryOptionHandle: "old-free" } },
      { deliveryOptionHide: { deliveryOptionHandle: "quoted" } },
    ]);
  });

  it("B2B buyer: hides nothing when the per-kg rate is missing (never leaves zero options)", () => {
    const result = run(
      input(COMPANY, [
        { handle: "free", title: "FREE delivery", cost: { amount: "0.0" } },
        { handle: "std", title: "Standard delivery", cost: { amount: "4.95" } },
      ]),
    );
    expect(result.operations).toEqual([]);
  });

  it("B2B buyer: decides per delivery group", () => {
    const result = run({
      cart: {
        buyerIdentity: { purchasingCompany: { company: COMPANY } },
        deliveryGroups: [
          { deliveryOptions: OPTIONS },
          { deliveryOptions: [{ handle: "other-std", title: "Standard delivery", cost: { amount: "4.95" } }] },
        ],
      },
    });
    expect(result.operations).toEqual([
      { deliveryOptionHide: { deliveryOptionHandle: "free-handle" } },
      { deliveryOptionHide: { deliveryOptionHandle: "std-handle" } },
    ]);
  });

  it("DTC buyer: hides only the per-kg rate", () => {
    const result = run(input(null));
    expect(result.operations).toEqual([{ deliveryOptionHide: { deliveryOptionHandle: "b2b-handle" } }]);
  });

  it("DTC buyer with missing buyerIdentity object entirely", () => {
    const result = run({ cart: { buyerIdentity: null, deliveryGroups: [{ deliveryOptions: OPTIONS }] } });
    expect(result.operations).toEqual([{ deliveryOptionHide: { deliveryOptionHandle: "b2b-handle" } }]);
  });

  it("DTC buyer: hides the carrier rate even when Shopify prepends the carrier name", () => {
    const result = run(
      input(null, [
        { handle: "std", title: "Standard delivery", cost: { amount: "4.95" } },
        { handle: "b2b", title: "ibBan B2B Shipping B2B Weight Shipping", cost: { amount: "0.6" } },
      ]),
    );
    expect(result.operations).toEqual([{ deliveryOptionHide: { deliveryOptionHandle: "b2b" } }]);
  });

  it("handles empty delivery groups", () => {
    const result = run({ cart: { buyerIdentity: null, deliveryGroups: [] } });
    expect(result.operations).toEqual([]);
  });
});
