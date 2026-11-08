import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  TestStep,
  TestError,
  FullConfig,
} from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { safePath } from "./safety";
import "./environment";
export function redactTitle(value: string) {
  let text = value;
  for (const [key, secret] of Object.entries(process.env))
    if (
      key.startsWith("LIVE_") &&
      /PASSWORD|SECRET|TOKEN|EMAIL|_SUB$/.test(key) &&
      secret &&
      secret.length > 3
    )
      text = text.split(secret).join("[redacted]");
  return text
    .replace(
      /https?:\/\/[^\s"'<>]+/g,
      (url) => `https://redacted.invalid${safePath(url)}`,
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(
      /Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
      "[token]",
    );
}
export function reportOutcome(
  blocked: boolean[],
  status: FullResult["status"],
) {
  return status === "passed" && blocked.length > 0 && blocked.every(Boolean)
    ? "blocked"
    : status;
}
function redactError(error: TestError) {
  const message = (error.message || "").replace(/^Error:\s*/, "");
  error.message = message.startsWith("BLOCKED:")
    ? redactTitle(message)
    : /SAFETY GUARD/.test(message)
      ? "LIVE SAFETY GUARD rejected an unauthorized action."
      : /^(Live API|Live Vercel|Public configuration|Cannot verify|Preview deployment|Test database)/.test(
            message,
          )
        ? redactTitle(message.split("\n")[0]).slice(0, 300)
        : /timed out|Timeout/i.test(message)
          ? "Live action timed out; private parameters, DOM and response values withheld."
          : "Live check failed; see the safe network/status summary. Private parameters, DOM and response values withheld.";
  error.stack = undefined;
  error.snippet = undefined;
}
export default class SafeLiveReporter implements Reporter {
  mode = "production-smoke";
  onBegin(config: FullConfig) {
    this.mode = config.projects[0]?.name || this.mode;
  }
  result?: FullResult;
  rows: {
    title: string;
    project: string;
    status: string;
    durationMs: number;
    blocked: boolean;
  }[] = [];
  onTestBegin(test: TestCase) {
    test.title = redactTitle(test.title);
  }
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    step.title = redactTitle(step.title);
  }
  onError(error: TestError) {
    redactError(error);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    result.errors.forEach(redactError);
    // Playwright writes a failure DOM/source context independently of tracing.
    // Replace it before the HTML reporter copies attachments into its bundle.
    for (const attachment of result.attachments)
      if (attachment.name === "error-context" && attachment.path)
        writeFileSync(
          attachment.path,
          "# Redacted live failure context\n\nDOM, source snippets, arguments and private values withheld. See redacted network/status evidence.\n",
        );
    this.rows.push({
      title: redactTitle(test.title),
      project: test.parent.project()?.name || "",
      status: result.status,
      durationMs: result.duration,
      blocked:
        result.status === "skipped" &&
        test.annotations.some(
          (a) =>
            a.type === "blocked" ||
            (a.type === "skip" && a.description?.startsWith("BLOCKED")),
        ),
    });
  }
  onEnd(result: FullResult) {
    this.result = result;
  }
  async onExit() {
    const mode = this.rows[0]?.project || this.mode;
    const folder = `playwright-report-live/${mode}`;
    mkdirSync(folder, { recursive: true });
    let commit = "unknown";
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
    } catch {
      /* optional */
    }
    writeFileSync(
      `${folder}/safe-results.json`,
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          localCommit: commit,
          deploymentCommit:
            "not exposed by deployment; do not equate local commit with hosted version",
          result: reportOutcome(
            this.rows.map((r) => r.blocked),
            this.result?.status || "failed",
          ),
          passed: this.rows.filter((r) => r.status === "passed").length,
          failed: this.rows.filter((r) =>
            ["failed", "timedOut"].includes(r.status),
          ).length,
          blocked: this.rows.filter((r) => r.blocked).length,
          tests: this.rows,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      "playwright-report-live/latest.json",
      JSON.stringify({ mode }),
    );
  }
}
