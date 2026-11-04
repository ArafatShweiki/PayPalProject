import { afterEach, it, expect, vi } from "vitest";
import { generateReportContent, ReportAIError } from "../server/gemini-reports";
const valid = {
  summary: "Review recorded spending.",
  spendingInsights: [],
  savingsInsights: [],
  recommendations: [],
  nextSteps: [],
};
function response(text = JSON.stringify(valid), status = "completed") {
  return new Response(
    JSON.stringify({
      id: "test",
      status,
      steps: [{ type: "model_output", content: [{ type: "text", text }] }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("sends server-only structured stateless requests with hard output bounds", async () => {
  vi.stubEnv("GEMINI_API_KEY", "private-test-key");
  const mock = vi.fn(async () => response());
  vi.stubGlobal("fetch", mock);
  expect(await generateReportContent({ spending: 2340 })).toEqual(valid);
  const request = mock.mock.calls[0] as unknown as [Request];
  const body = await request[0].clone().json();
  expect(body).toMatchObject({
    store: false,
    model: "gemini-3.5-flash-lite",
    response_format: { mime_type: "application/json" },
    generation_config: { max_output_tokens: 1800 },
  });
  expect(body.input).not.toContain("private-test-key");
});
it("handles missing credentials without a provider request", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  const mock = vi.fn();
  vi.stubGlobal("fetch", mock);
  await expect(generateReportContent({})).rejects.toMatchObject({
    reason: "configuration",
  });
  expect(mock).not.toHaveBeenCalled();
});
it.each([400, 401, 403, 404, 429])(
  "does not retry provider status %i",
  async (status) => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "private provider detail" } }),
          { status, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", mock);
    await expect(generateReportContent({})).rejects.toBeInstanceOf(
      ReportAIError,
    );
    expect(mock).toHaveBeenCalledTimes(1);
  },
);
it("retries an explicit transient server failure only once", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test");
  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(response());
  vi.stubGlobal("fetch", mock);
  expect(await generateReportContent({})).toEqual(valid);
  expect(mock).toHaveBeenCalledTimes(2);
});
it.each(["{invalid", "x".repeat(12001)])(
  "rejects invalid or oversized output",
  async (text) => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(text)),
    );
    await expect(generateReportContent({})).rejects.toMatchObject({
      reason: "invalid_response",
    });
  },
);
it("rejects incomplete responses and oversized input", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test");
  const mock = vi.fn(async () => response("{}", "incomplete"));
  vi.stubGlobal("fetch", mock);
  await expect(generateReportContent({})).rejects.toMatchObject({
    reason: "invalid_response",
  });
  await expect(
    generateReportContent({ label: "x".repeat(33000) }),
  ).rejects.toMatchObject({ reason: "invalid_response" });
  expect(mock).toHaveBeenCalledTimes(1);
});

it("bounds stalled network calls with an abort timeout", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test");
  vi.stubEnv("GEMINI_REPORT_TIMEOUT_MS", "20");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (request: Request) =>
        new Promise((_resolve, reject) => {
          if (request.signal.aborted) reject(new Error("aborted"));
          else
            request.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
        }),
    ),
  );
  await expect(generateReportContent({})).rejects.toMatchObject({
    reason: "timeout",
  });
});
