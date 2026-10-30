import { publicRequests } from "./requestCache";
import { ApiError } from "./errors";
import type { HistoryPeriod } from "../shared/market";
import type { MarketFeed, Snapshot } from "../shared/types";
let retryAt = 0;
export async function publicMarketRead(kind: "live"): Promise<MarketFeed>;
export async function publicMarketRead(
  kind: "history",
  period: HistoryPeriod,
): Promise<{ snapshots: Snapshot[] }>;
export async function publicMarketRead(
  kind: "live" | "history",
  period?: HistoryPeriod,
): Promise<MarketFeed | { snapshots: Snapshot[] }> {
  if (retryAt > Date.now())
    throw new ApiError(
      "Please wait before checking rates again.",
      429,
      Math.ceil((retryAt - Date.now()) / 1000),
    );
  const path =
    kind === "live"
      ? "/api/market-data/live"
      : `/api/market-data/history?period=${encodeURIComponent(period!)}`;
  return publicRequests.get(`public-market:${path}`, 1000, async (signal) => {
    const response = await fetch(path, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (response.status === 429) {
      const seconds = Math.max(
        1,
        Number(response.headers.get("retry-after")) || 60,
      );
      retryAt = Date.now() + seconds * 1000;
      throw new ApiError(
        "Rates have been checked too often. Please try again shortly.",
        429,
        seconds,
      );
    }
    if (!response.ok)
      throw new ApiError(
        "Currency rates are currently unavailable. No sample rates have been substituted.",
        response.status,
      );
    return response.json();
  });
}
