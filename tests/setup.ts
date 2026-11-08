import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Private fixture caches must not share a SQLite WAL across parallel workers
// or depend on a cloud-synced workspace directory. No application data is used.
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "dream-piggy-tests-")),
  "cache.db",
);

// jsdom does not implement native dialog methods; browser coverage verifies actual focus behavior.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
