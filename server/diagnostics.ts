import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
const requests = new AsyncLocalStorage<{
  signal: AbortSignal;
  timings: { name: string; ms: number }[];
  enabled: boolean;
}>();
export const requestSignal = () => requests.getStore()?.signal;
export async function timed<T>(
  name: string,
  work: () => PromiseLike<T> | T,
): Promise<T> {
  const context = requests.getStore();
  if (!context?.enabled) return await work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    context.timings.push({ name, ms: performance.now() - start });
  }
}
export const diagnostics: RequestHandler = (req, res, next) => {
  const controller = new AbortController();
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.PERFORMANCE_DIAGNOSTICS === "true";
  req.once("aborted", () => controller.abort());
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const timings: { name: string; ms: number }[] = [];
  if (enabled) {
    const json = res.json.bind(res);
    res.json = (body) => {
      res.setHeader(
        "Server-Timing",
        timings
          .map((t, i) => `${t.name}_${i};dur=${t.ms.toFixed(1)}`)
          .join(", "),
      );
      return json(body);
    };
  }
  requests.run({ signal: controller.signal, timings, enabled }, next);
};
