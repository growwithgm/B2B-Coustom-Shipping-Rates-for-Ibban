import { describe, expect, it } from "vitest";
import { calculateRates, type RateRequest } from "./rates.js";

function request(country: string, items: RateRequest["items"]): RateRequest {
  return { destination: { country }, items, currency: "EUR" };
}

describe("calculateRates", () => {
  it("Spain, 2 kg → €2.00 (€1/kg)", () => {
    const { rates } = calculateRates(request("ES", [{ grams: 1000, quantity: 2 }]));
    expect(rates[0].total_price).toBe("200");
    expect(rates[0].currency).toBe("EUR");
    expect(rates[0].service_name).toBe("B2B Weight Shipping");
  });

  it("Spain, 1.3 kg → €1.30 (true per-kg, not bracket-rounded)", () => {
    const { rates } = calculateRates(request("ES", [{ grams: 1300, quantity: 1 }]));
    expect(rates[0].total_price).toBe("130");
  });

  it("France, 2 kg → €8.00 (€4/kg default zone)", () => {
    const { rates } = calculateRates(request("FR", [{ grams: 500, quantity: 4 }]));
    expect(rates[0].total_price).toBe("800");
  });

  it("non-ES, 1.3 kg → €5.20", () => {
    const { rates } = calculateRates(request("DE", [{ grams: 1300, quantity: 1 }]));
    expect(rates[0].total_price).toBe("520");
  });

  it("lowercase country code still matches the zone", () => {
    const { rates, diagnostics } = calculateRates(request("es", [{ grams: 1000, quantity: 1 }]));
    expect(diagnostics.zone).toBe("Spain");
    expect(rates[0].total_price).toBe("100");
  });

  it("sums weight across line items and quantities", () => {
    const { diagnostics } = calculateRates(
      request("ES", [
        { grams: 250, quantity: 2 },
        { grams: 1500, quantity: 1 },
      ]),
    );
    expect(diagnostics.totalKg).toBeCloseTo(2.0);
    expect(diagnostics.priceCents).toBe(200);
  });

  it("ignores items that do not require shipping", () => {
    const { rates } = calculateRates(
      request("ES", [
        { grams: 1000, quantity: 1, requires_shipping: true },
        { grams: 9000, quantity: 1, requires_shipping: false },
      ]),
    );
    expect(rates[0].total_price).toBe("100");
  });

  it("zero total weight returns the minimum charge and a warning", () => {
    const { rates, diagnostics } = calculateRates(request("ES", [{ grams: 0, quantity: 3 }]));
    expect(rates[0].total_price).toBe("0");
    expect(diagnostics.warnings.length).toBeGreaterThan(0);
  });

  it("missing destination country falls back to the default rate with a warning", () => {
    const { rates, diagnostics } = calculateRates({ items: [{ grams: 1000, quantity: 1 }] });
    expect(rates[0].total_price).toBe("400");
    expect(diagnostics.warnings.length).toBeGreaterThan(0);
  });
});
