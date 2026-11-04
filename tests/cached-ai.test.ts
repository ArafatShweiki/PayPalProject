import { fundedUser } from "./fixtures/user";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { explain, buildReport } from "../server/reports";
import { purchase } from "../shared/ledger";
import { fingerprint } from "../server/reliability";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("reuses account-specific Gemini output and invalidates financial/model input changes", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: "interaction-test",
          output_text: JSON.stringify({
            summary: "Review your recorded savings before changing a rule.",
            spendingInsights: [],
            savingsInsights: [],
            recommendations: [],
            nextSteps: [],
          }),
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    summary:
                      "Review your recorded savings before changing a rule.",
                    spendingInsights: [],
                    savingsInsights: [],
                    recommendations: [],
                    nextSteps: [],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const uid = randomUUID(),
    data = fundedUser();
  purchase(data, "USD", 1235, "Coffee", "Food & drink");
  const generate = (user = uid) =>
    explain(
      buildReport(data, "weekly", Date.now() + 1000).report,
      [],
      user,
      fingerprint({ ledger: data.ledger, preferences: data.preferences }),
    );
  const first = await generate();
  expect(first.source).toBe("Gemini");
  expect(first.explanationCache?.cached).toBe(false);
  expect((await generate()).explanationCache?.cached).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  purchase(data, "USD", 2100, "Books", "Education");
  const changed = await generate();
  expect(changed.summaries.find((s) => s.currency === "USD")?.spending).toBe(
    3335,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  await generate(randomUUID());
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.stubEnv("GEMINI_MODEL", "another-model");
  await generate();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("does not cache a failed AI response as a successful explanation", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const fetcher = vi.fn(async () => {
    throw new Error("provider timeout");
  });
  vi.stubGlobal("fetch", fetcher);
  const data = fundedUser(),
    uid = randomUUID();
  purchase(data, "USD", 1200, "Coffee", "Food & drink");
  for (let i = 0; i < 2; i++)
    expect(
      (
        await explain(
          buildReport(data, "monthly", Date.now() + 1000).report,
          [],
          uid,
        )
      ).source,
    ).toBe("deterministic");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
