import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { safePath } from "./safety";

// Allowlist, rather than attempting to find every possible secret spelling.
// Request/response bodies, headers, cookies, action parameters/results, DOM
// snapshots, source resources and screenshots never enter the shared trace.
export function sanitizeTrace(input: Uint8Array) {
  const clean: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(unzipSync(input))) {
    if (!/^[A-Za-z0-9_-]+\.(?:trace|network)$/.test(name)) continue;
    const lines: string[] = [];
    for (const line of strFromU8(bytes).split("\n")) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.type === "context-options") {
        lines.push(
          JSON.stringify({
            type: item.type,
            version: item.version,
            origin: "library",
            browserName: item.browserName,
            platform: item.platform,
            sdkLanguage: item.sdkLanguage,
            contextId: item.contextId,
            wallTime: item.wallTime,
            monotonicTime: item.monotonicTime,
            options: {},
          }),
        );
      } else if (item.type === "before" || item.type === "after") {
        const row: Record<string, unknown> = {};
        for (const key of [
          "type",
          "callId",
          "parentId",
          "startTime",
          "endTime",
          "apiName",
          "class",
          "method",
          "pageId",
          "beforeSnapshot",
          "afterSnapshot",
        ])
          if (
            item[key] !== undefined &&
            key !== "beforeSnapshot" &&
            key !== "afterSnapshot"
          )
            row[key] = item[key];
        row.params = {};
        row.result = undefined;
        if (item.error)
          row.error = {
            name: "Error",
            message: "Operation failed; sensitive details withheld.",
          };
        lines.push(JSON.stringify(row));
      } else if (item.type === "resource-snapshot") {
        const snapshot = item.snapshot;
        lines.push(
          JSON.stringify({
            type: item.type,
            snapshot: {
              _frameref: snapshot._frameref,
              _monotonicTime: snapshot._monotonicTime,
              startedDateTime: snapshot.startedDateTime,
              time: snapshot.time,
              request: {
                method: snapshot.request.method,
                url: `https://redacted.invalid${safePath(snapshot.request.url)}`,
                headers: [],
                cookies: [],
                queryString: [],
                headersSize: -1,
                bodySize: -1,
                httpVersion: "HTTP/1.1",
              },
              response: {
                status: snapshot.response.status,
                statusText: "",
                headers: [],
                cookies: [],
                content: { size: 0, mimeType: "[redacted]" },
                redirectURL: "",
                headersSize: -1,
                bodySize: -1,
                httpVersion: "HTTP/1.1",
              },
              cache: {},
              timings: { send: 0, wait: 0, receive: 0 },
            },
          }),
        );
      }
    }
    clean[name] = strToU8(lines.join("\n") + "\n");
  }
  return zipSync(clean);
}
export function saveSanitizedTrace(raw: string, output: string) {
  try {
    writeFileSync(output, sanitizeTrace(readFileSync(raw)));
  } finally {
    unlinkSync(raw);
  }
}
export function suspiciousPublicText(
  text: string,
  privateValues: string[] = [],
) {
  return (
    privateValues.some((value) => value.length >= 12 && text.includes(value)) ||
    /sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\\nrt]*[A-Za-z0-9+/=]{64,}|AIza[A-Za-z0-9_-]{30,}/.test(
      text,
    )
  );
}
