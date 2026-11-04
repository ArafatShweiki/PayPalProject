import { describe, it, expect } from "vitest";
import { fundedUser } from "./fixtures/user";
import { purchase, refund } from "../shared/ledger";
import { buildReport } from "../shared/reports";
import { reportPeriod } from "../shared/report-period";
import { validateReportContent } from "../server/report-schema";
const now = Date.parse("2026-10-30T12:00:00Z");
const content = {
  summary: "Review the recorded spending categories.",
  spendingInsights: [],
  savingsInsights: [],
  recommendations: [],
  nextSteps: [],
};
function fixture() {
  const d = fundedUser();
  d.createdAt = "2026-01-01T00:00:00Z";
  d.preferences.savings = "enabled";
  return d;
}
describe("report financial calculations", () => {
  it("uses complete calendar months, exclusive boundaries and separate precise currencies", () => {
    const d = fixture();
    for (const [currency, amount, at] of [
      ["ILS", 2340, "2026-09-01T00:00:00Z"],
      ["JOD", 7351, "2026-09-30T23:59:59Z"],
      ["USD", 1235, "2026-08-31T23:59:59Z"],
      ["ILS", 1000, "2026-10-01T00:00:00Z"],
    ] as const)
      purchase(d, currency, amount, "Private merchant", "Other").at = at;
    const { report } = buildReport(d, "monthly", now, "2026-09-15");
    expect(report.since).toBe("2026-09-01T00:00:00.000Z");
    expect(report.until).toBe("2026-10-01T00:00:00.000Z");
    expect(report.complete).toBe(true);
    expect(report.summaries.map((s) => [s.spending, s.savings])).toEqual([
      [2340, 160],
      [0, 0],
      [7351, 649],
    ]);
    expect(report.summaries[0].categories).toEqual({ Other: 2340 });
    expect(report.summaries[1].previousSpending).toBe(1235);
  });
  it("matches elapsed monthly comparisons and handles a shorter previous month", () => {
    const d = fixture();
    purchase(d, "ILS", 1000, "Earlier", "Other").at = "2026-09-05T00:00:00Z";
    purchase(d, "ILS", 5000, "Later", "Other").at = "2026-09-20T00:00:00Z";
    purchase(d, "ILS", 2000, "Current", "Other").at = "2026-10-05T00:00:00Z";
    const r = buildReport(
      d,
      "monthly",
      Date.parse("2026-10-10T12:00:00Z"),
    ).report;
    expect(r.summaries[0].previousSpending).toBe(1000);
    expect(r.summaries[0].spendingChangePercent).toBe(100);
    expect(
      reportPeriod("monthly", Date.parse("2026-03-31T12:00:00Z")).previousEnd,
    ).toBe(Date.parse("2026-03-01T00:00:00Z"));
  });
  it("uses local calendar boundaries across DST and rejects invalid dates and zones", () => {
    const p = reportPeriod(
      "weekly",
      Date.parse("2026-11-03T12:00:00Z"),
      "2026-11-02",
      "America/New_York",
    );
    expect(p.start).toBe(Date.parse("2026-10-27T04:00:00Z"));
    expect(p.end).toBe(Date.parse("2026-11-03T05:00:00Z"));
    expect(() => reportPeriod("monthly", now, "2026-02-30")).toThrow();
    expect(() => reportPeriod("weekly", now, "2026-12-01")).toThrow();
    expect(() =>
      reportPeriod("weekly", now, undefined, "Invalid/Zone"),
    ).toThrow();
  });
  it("uses actual recorded allocations for alternative rules and honors refunds, caps and exact boundaries", () => {
    const d = fixture();
    const a = purchase(d, "ILS", 2340, "Private", "Other");
    a.at = "2026-10-25T12:00:00Z";
    a.saved = 60;
    purchase(d, "ILS", 2000, "Boundary", "Other").at = "2026-10-26T12:00:00Z";
    const refunded = purchase(d, "ILS", 1234, "Refunded", "Other");
    refunded.at = "2026-10-26T12:00:00Z";
    refund(d, refunded.id).at = "2026-10-27T12:00:00Z";
    d.preferences.caps.ILS = 400;
    const before = structuredClone(d.preferences);
    const { report, recommendations } = buildReport(d, "weekly", now);
    expect(report.summaries[0].spending).toBe(4340);
    expect(report.summaries[0].savings).toBe(60);
    expect(recommendations[0]).toMatchObject({
      current: 500,
      suggested: 1000,
      recordedSavings: 60,
      estimatedSavings: 400,
      additional: 340,
    });
    expect(d.preferences).toEqual(before);
    d.preferences.caps.ILS = 0;
    expect(buildReport(d, "weekly", now).recommendations).toEqual([]);
  });
  it("does not let refunds after a historical cutoff rewrite that report", () => {
    const d = fixture();
    const p = purchase(d, "ILS", 2340, "Private", "Other");
    p.at = "2026-09-05T00:00:00Z";
    refund(d, p.id).at = "2026-10-05T00:00:00Z";
    expect(
      buildReport(d, "monthly", now, "2026-09-01").report.summaries[0].spending,
    ).toBe(2340);
  });
  it("does not invent previous history or recommendations on empty accounts", () => {
    const d = fixture();
    d.createdAt = "2026-10-28T00:00:00Z";
    const { report, recommendations } = buildReport(d, "weekly", now);
    expect(
      report.summaries.every(
        (s) => s.spending === 0 && s.previousSpending === null,
      ),
    ).toBe(true);
    expect(recommendations).toEqual([]);
  });
  it("rejects fabricated amounts, unsafe claims, extra fields and unsupported rule IDs", () => {
    expect(validateReportContent(content, [])).toEqual(content);
    for (const bad of [
      { ...content, summary: "Save 100 USD." },
      { ...content, summary: "Guaranteed savings." },
      { ...content, summary: "Save five dollars." },
      { ...content, balance: 100 },
      {
        ...content,
        recommendations: [{ id: "forged", description: "Increase the rule." }],
      },
    ])
      expect(() => validateReportContent(bad, [])).toThrow();
  });
});

it("calculates goal progress and rounded averages on the server", () => {
  const d = fixture();
  d.goals = [
    {
      id: "goal",
      name: "Private goal",
      currency: "ILS",
      target: 400,
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];
  d.preferences.goalIds.ILS = "goal";
  purchase(d, "ILS", 2340, "Private", "Other").at = "2026-10-25T12:00:00Z";
  const report = buildReport(d, "weekly", now).report;
  expect(report.goals[0]).toMatchObject({ saved: 160, progressPercent: 40 });
  expect(report.summaries[0]).toMatchObject({
    averageSpending: 2340,
    previousSavings: 0,
    savingsChange: 160,
  });
});
it("rejects a written trend that contradicts computed comparisons", () => {
  const d = fixture();
  purchase(d, "ILS", 2340, "Private", "Other").at = "2026-10-25T12:00:00Z";
  const report = buildReport(d, "weekly", now).report;
  expect(() =>
    validateReportContent(
      { ...content, summary: "ILS spending decreased." },
      [],
      report,
    ),
  ).toThrow("Contradictory");
  expect(
    validateReportContent(
      { ...content, summary: "ILS spending increased." },
      [],
      report,
    ).summary,
  ).toBe("ILS spending increased.");
});
