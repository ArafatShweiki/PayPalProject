import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { reportContentSchema } from "./report-schema";
import { REPORT_SYSTEM_PROMPT } from "./report-prompt";
import { setting, consumeLimit } from "./reliability";

export const reportModel = () =>
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export class ReportAIError extends Error {
  constructor(
    public reason:
      | "configuration"
      | "quota"
      | "timeout"
      | "invalid_response"
      | "unavailable",
    public providerStatus?: number,
  ) {
    super(reason);
  }
}

// Keep the application deadline authoritative even if an SDK transport delays
// propagating cancellation. The same signal still aborts the underlying request.
async function beforeDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort!: () => void;
  const expired = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new ReportAIError("timeout"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function generateReportContent(facts: unknown): Promise<unknown> {
  if (!process.env.GEMINI_API_KEY) throw new ReportAIError("configuration");
  const input = JSON.stringify(facts);
  if (Buffer.byteLength(input) > 32000)
    throw new ReportAIError("invalid_response");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const signal = AbortSignal.timeout(
    Math.min(setting("GEMINI_REPORT_TIMEOUT_MS", 20000), 25000),
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      const quota = await consumeLimit(
        "gemini-provider",
        "shared",
        setting("GEMINI_REQUESTS_PER_MINUTE", 30),
      );
      if (!quota.allowed) throw new ReportAIError("quota");
    }
    try {
      const result = await beforeDeadline(
        client.interactions.create(
          {
            model: reportModel(),
            input,
            store: false,
            automatic_continuation: false,
            system_instruction: REPORT_SYSTEM_PROMPT,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: z.toJSONSchema(reportContentSchema),
            },
            generation_config: { max_output_tokens: 1800, temperature: 0.2 },
          },
          { signal, maxRetries: 0 },
        ),
        signal,
      );
      if (
        result.status !== "completed" ||
        !result.output_text ||
        result.output_text.length > 12000
      )
        throw new ReportAIError("invalid_response");
      // Usage only: no prompt, user identifiers, financial data or provider error bodies.
      console.info(
        JSON.stringify({
          event: "report_ai_usage",
          model: reportModel(),
          usage: result.usage,
        }),
      );
      return JSON.parse(result.output_text);
    } catch (error) {
      if (error instanceof ReportAIError) throw error;
      if (signal.aborted) throw new ReportAIError("timeout");
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0;
      // Retry only explicit transient server failures, never quota/auth/schema errors.
      if ([500, 502, 503, 504].includes(status) && attempt === 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, 250 + Math.random() * 150),
        );
        continue;
      }
      throw new ReportAIError(
        status === 429
          ? "quota"
          : [400, 401, 403, 404].includes(status)
            ? "configuration"
            : error instanceof SyntaxError
              ? "invalid_response"
              : "unavailable",
        status || undefined,
      );
    }
  }
  throw new ReportAIError("unavailable");
}
