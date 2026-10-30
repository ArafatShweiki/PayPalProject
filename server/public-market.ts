import { Router } from "express";
import { z } from "zod";
import {
  forexEnabled,
  forexStatus,
  refreshForex,
  forexPollMs,
  forexStaleMs,
} from "./forex";
import { forexHistory, readForexSnapshots } from "./forex-store";
import { limitMiddleware } from "./reliability";
import type { MarketStatus, Snapshot } from "../shared/types";
export const publicMarketRouter = Router();
export const publicMarketEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  !process.env.VERCEL &&
  process.env.VITE_ENABLE_DEMO_MODE === "true";
publicMarketRouter.use((_req, res, next) => {
  if (!publicMarketEnabled()) {
    res.status(404).json({ error: "Market-data demo access is disabled." });
    return;
  }
  next();
});
publicMarketRouter.use(
  limitMiddleware("public-market", "RATE_LIMIT_PUBLIC_MARKET", 30),
);
publicMarketRouter.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Market data is read-only." });
    return;
  }
  next();
});
// A whitelist, never an auxiliary user record or an authenticated feed response.
function publicSnapshot(s: Snapshot): Snapshot {
  return {
    id: s.id,
    fetchedAt: s.fetchedAt,
    publishedAt: s.publishedAt,
    source: s.source,
    quotes: [],
    ils: { ILS: s.ils.ILS, USD: s.ils.USD, JOD: s.ils.JOD },
    ...(s.market
      ? {
          market: {
            provider: s.market.provider,
            timeKind: s.market.timeKind,
            legs: s.market.legs.map((q) => ({
              symbol: q.symbol,
              rate: q.rate,
              observedAt: q.observedAt,
              marketOpen: q.marketOpen,
            })),
          },
        }
      : {}),
  };
}
async function status(): Promise<MarketStatus> {
  const current = await forexStatus();
  if (!forexEnabled() || !current.configured)
    return {
      provider: "Twelve Data",
      configured: false,
      transport: "polling",
      pollMs: forexPollMs(),
      staleMs: forexStaleMs(),
      connection: "unavailable",
      error: !forexEnabled()
        ? "Set MARKET_DATA_PROVIDER=twelve to use real Forex in Demo Mode."
        : "Configure the server-side TWELVE_DATA_API_KEY. No sample rates have been substituted.",
    };
  return current;
}
publicMarketRouter.get("/live", async (_req, res) => {
  let current = await status();
  if (!current.configured) {
    res.json({ snapshots: [], status: current });
    return;
  }
  try {
    await refreshForex();
  } catch {
    /* Safe provider status and genuine retained observations only. */
  }
  current = await status();
  res.json({
    snapshots: (await readForexSnapshots()).map(publicSnapshot),
    status: current,
  });
});
publicMarketRouter.get("/history", async (req, res) => {
  const period = z
      .enum(["1h", "24h", "7d", "30d", "90d"])
      .parse(req.query.period),
    current = await status();
  res.json({
    snapshots: current.configured
      ? (await forexHistory(period)).map(publicSnapshot)
      : [],
    period,
    status: current,
  });
});
publicMarketRouter.use((_req, res) =>
  res.status(404).json({ error: "Market-data endpoint not found." }),
);
