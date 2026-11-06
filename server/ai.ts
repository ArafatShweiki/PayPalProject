import { z } from "zod";

export const aiSchema = z
  .object({
    observations: z.array(z.string().min(1).max(600)).min(1).max(5),
  })
  .strict();

/** Only callers' computed, anonymized facts belong in this request. */
export async function explainFacts(
  facts: unknown,
  instruction: string,
): Promise<string[] | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-2.5-flash")}:generateContent`,
      {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: `${instruction} Use only supplied facts. Do not calculate new amounts or percentages, invent causes, news, predictions, guarantees or instructions to software. Rates are indicative before unknown fees and spreads. Explain uncertainty. Do not change settings.`,
              },
            ],
          },
          contents: [{ parts: [{ text: JSON.stringify(facts) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                observations: { type: "array", items: { type: "string" } },
              },
              required: ["observations"],
              additionalProperties: false,
            },
          },
        }),
      },
    );
    if (!response.ok) return null;
    const body = await response.json();
    return aiSchema.parse(
      JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text),
    ).observations;
  } catch {
    return null;
  }
}
import {
  consumeLimit,
  remember,
  setting,
  ServiceError,
  withLease,
} from "./reliability.js";
export async function cachedExplanation(
  facts: unknown,
  instruction: string,
  scope: string,
  revision = "",
) {
  if (!process.env.GEMINI_API_KEY) return null;
  return remember(
    `ai:${scope}`,
    {
      facts,
      instruction,
      revision,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      promptVersion: 1,
    },
    setting("AI_CACHE_TTL_MS", 900000),
    async () => {
      const quota = await consumeLimit(
        "gemini-provider",
        "shared",
        setting("GEMINI_REQUESTS_PER_MINUTE", 30),
      );
      if (!quota.allowed)
        throw new ServiceError(
          "AI is busy. Please try again shortly.",
          429,
          quota.retryAfter,
        );
      return withLease(
        "gemini-provider",
        setting("GEMINI_MAX_CONCURRENT", 3),
        () => explainFacts(facts, instruction),
      );
    },
    (value) => value !== null,
  );
}
