import { afterEach, describe, expect, it, vi } from "vitest";
import { currencyFacts, currencyInsight } from "../server/currency-insights";
import { parsePma } from "../server/rates";
const snapshot = (rate: string) =>
  parsePma(
    `<tr><th>USD/ILS</th><td>${rate}</td><td>${rate}</td></tr><tr><th>JOD/ILS</th><td>5</td><td>5</td></tr>`,
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("personalized currency analysis", () => {
  it("selects an actual dated baseline for each period without fabricating missing history", () => {
    const now = Date.now();
    const points = [35, 8, 2, 0].map((days, i) => {
      const s = snapshot(["3.2", "3.3", "3.5", "3.6"][i]);
      s.fetchedAt = new Date(now - days * 86400000).toISOString();
      return s;
    });
    const day = currencyFacts(points, "USD", "ILS", 50000, 3600000, "24h");
    expect(day.referenceAt).toBe(points[2].fetchedAt);
    expect(day.difference).toBe(5000);
    expect(day.changePercent).toBeCloseTo(2.857142);
    expect(
      currencyFacts(points, "USD", "ILS", 50000, 3600000, "7d").referenceAt,
    ).toBe(points[1].fetchedAt);
    expect(
      currencyFacts(points, "USD", "ILS", 50000, 3600000, "30d").referenceAt,
    ).toBe(points[0].fetchedAt);
    const missing = currencyFacts(
      points.slice(2),
      "USD",
      "ILS",
      50000,
      3600000,
      "7d",
    );
    expect(missing.referenceRate).toBeNull();
    expect(missing.difference).toBeNull();
    expect(missing.earliestAt).toBe(points[2].fetchedAt);
    const inverse = currencyFacts(points, "ILS", "USD", 10000, 3600000, "24h");
    expect(inverse.difference).toBeLessThan(0);
    expect(inverse.changePercent).toBeLessThan(0);
  });
  it("computes the requested 500 USD example without AI arithmetic", () => {
    const facts = currencyFacts(
      [snapshot("3.5"), snapshot("3.6")],
      "USD",
      "ILS",
      50000,
    );
    expect(facts.received).toBe(180000);
    expect(facts.previousValue).toBe(175000);
    expect(facts.difference).toBe(5000);
    expect(facts.changePercent).toBeCloseTo(2.857142);
    expect(facts.observations.join(" ")).toContain("not guaranteed profit");
  });
  it("respects inverse direction and JOD precision", () => {
    const facts = currencyFacts(
      [snapshot("3.5"), snapshot("3.6")],
      "ILS",
      "JOD",
      10000,
    );
    expect(facts.received).toBe(20000);
    expect(facts.difference).toBe(0);
    expect(
      currencyFacts([snapshot("3.5"), snapshot("3.6")], "ILS", "USD", 10000)
        .changePercent,
    ).toBeLessThan(0);
  });
  it("does not invent historical comparisons; labels stale observations", () => {
    const s = snapshot("3.5");
    s.fetchedAt = "2020-01-01T00:00:00.000Z";
    const facts = currencyFacts([s], "USD", "ILS", 10000);
    expect(facts.referenceRate).toBeNull();
    expect(facts.difference).toBeNull();
    expect(facts.stale).toBe(true);
    expect(() => currencyFacts([], "USD", "ILS", 10000)).toThrow();
    expect(() => currencyFacts([s], "USD", "USD", 10000)).toThrow();
  });
  it("uses validated Gemini explanations while keeping immutable calculated facts", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    observations: [
                      "The selected dollars have a higher indicative shekel value.",
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mock);
    const result = await currencyInsight(
      [snapshot("3.5"), snapshot("3.6")],
      "USD",
      "ILS",
      50000,
    );
    expect(result.source).toBe("Gemini");
    expect(result.difference).toBe(5000);
    const sent = JSON.parse(mock.mock.calls[0][1].body);
    expect(
      JSON.parse(sent.contents[0].parts[0].text).indicativeValueChange,
    ).toBe("₪50.00");
    mock.mockRejectedValue(new Error("offline"));
    expect(
      (await currencyInsight([snapshot("3.5")], "USD", "ILS", 50000)).source,
    ).toBe("deterministic");
  });
});
