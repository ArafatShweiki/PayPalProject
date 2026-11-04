import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ApiError } from "./errors";
import type {
  MarketFeed,
  MarketStatus,
  Notice,
  Snapshot,
  State,
} from "../shared/types";
export function useMarketFeed(
  mode: State["authMode"] | undefined,
  onData: (snapshots: Snapshot[], staleMs: number, notices?: Notice[]) => void,
  version = 0,
) {
  const [status, setStatus] = useState<MarketStatus>();
  const callback = useRef(onData);
  useEffect(() => {
    callback.current = onData;
  }, [onData]);
  useEffect(() => {
    if (!mode) return;
    setStatus(undefined);
    const controller = new AbortController();
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0,
      running = false;
    const tick = async () => {
      clearTimeout(timer);
      if (!active || running) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(() => void tick(), 30000);
        return;
      }
      running = true;
      let delay = 30000;
      try {
        const feed = await api<MarketFeed>("/rates/live", undefined, "GET", {
          signal: controller.signal,
        });
        if (!active) return;
        failures = 0;
        setStatus(feed.status);
        callback.current(feed.snapshots, feed.status.staleMs, feed.notices);
        delay = feed.status.provider === "PMA" ? 300000 : 30000;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        failures++;
        delay = Math.max(
          Math.min(120000, 30000 * 2 ** Math.min(failures, 2)),
          error instanceof ApiError ? error.retryAfter * 1000 : 0,
        );
        if (active)
          setStatus((current) =>
            current
              ? {
                  ...current,
                  connection: "unavailable",
                  error:
                    "Market connection unavailable. Retaining the last recorded observations.",
                }
              : {
                  provider: "Unknown",
                  configured: false,
                  transport: "polling",
                  pollMs: 30000,
                  staleMs: 180000,
                  connection: "unavailable",
                  error:
                    "Market connection unavailable. Retaining recorded observations.",
                },
          );
      } finally {
        running = false;
        if (active) timer = setTimeout(() => void tick(), delay);
      }
    };
    const resume = () => {
      if (document.visibilityState !== "hidden") void tick();
    };
    void tick();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [mode, version]);
  return status;
}
