import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname, basename } from "node:path";
import { createSign } from "node:crypto";
import { digest, decodeFirestore, type LegacyRecord } from "./legacy-storage";
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
try {
  const sqlite = option("--sqlite"),
    serviceAccount = option("--firestore-service-account");
  if (!!sqlite === !!serviceAccount)
    throw new Error(
      "Choose exactly one: --sqlite PATH or --firestore-service-account PATH",
    );
  const output = resolve(
    option("--output") || ".temp/legacy-storage/export.json",
  );
  const rel = relative(resolve(".temp/legacy-storage"), output);
  if (
    rel.startsWith("..") ||
    resolve(output) === resolve(".temp/legacy-storage") ||
    rel.includes(":")
  )
    throw new Error(
      "Export output must be inside ignored .temp/legacy-storage",
    );
  const records: LegacyRecord[] = [];
  let source = "";
  if (sqlite) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(resolve(sqlite), { readOnly: true });
    try {
      source = `sqlite:${basename(sqlite)}`;
      for (const row of db
        .prepare("select id,value from records order by id")
        .all() as { id: string; value: string }[]) {
        const value = JSON.parse(row.value);
        records.push({ id: row.id, value, hash: digest(value) });
      }
    } finally {
      db.close();
    }
  } else {
    const credential = JSON.parse(
      readFileSync(resolve(serviceAccount!), "utf8"),
    );
    if (
      !/^[a-z][a-z0-9-]{4,62}$/.test(credential.project_id) ||
      !credential.client_email ||
      !credential.private_key
    )
      throw new Error("Invalid legacy service account file");
    source = `firestore:${credential.project_id}/(default)/walletwise`;
    const now = Math.floor(Date.now() / 1000);
    const encoded = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const input = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({ iss: credential.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256")
      .update(input)
      .sign(credential.private_key)
      .toString("base64url");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${input}.${signature}`,
      }),
    });
    if (!tokenResponse.ok)
      throw new Error("Legacy Google authentication unavailable");
    const token = (await tokenResponse.json()).access_token;
    if (typeof token !== "string")
      throw new Error("Legacy Google authentication unavailable");
    let page = "";
    do {
      const url = new URL(
        `https://firestore.googleapis.com/v1/projects/${credential.project_id}/databases/(default)/documents/walletwise`,
      );
      url.searchParams.set("pageSize", "100");
      if (page) url.searchParams.set("pageToken", page);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404)
        throw new Error(
          "Legacy database/collection unavailable; do not interpret this as an empty export",
        );
      if (!response.ok) throw new Error("Legacy Firestore read unavailable");
      const body = await response.json();
      for (const doc of body.documents ?? []) {
        const id = String(doc.name).split("/").at(-1)!;
        if (!doc.fields?.value)
          throw new Error("Unexpected legacy document shape");
        const value = decodeFirestore(doc.fields.value);
        records.push({ id, value, hash: digest(value) });
      }
      page = body.nextPageToken || "";
      if (records.length > 10000)
        throw new Error(
          "Export exceeds 10000 records; use a reviewed paginated export",
        );
    } while (page);
  }
  const contents = JSON.stringify({
    format: 1,
    source,
    exportedAt: new Date().toISOString(),
    records,
  });
  if (records.length > 10000 || Buffer.byteLength(contents) > 50_000_000)
    throw new Error(
      "Export exceeds safe size; use a reviewed paginated export",
    );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, contents, { flag: "wx" });
  console.log(
    JSON.stringify({
      readOnly: true,
      source,
      records: records.length,
      empty: records.length === 0,
      exported: true,
    }),
  );
} catch (error) {
  // Parsing/provider errors may include private payload fragments; never echo them.
  console.error(
    error instanceof Error &&
      /^(Choose exactly|Export output|Export exceeds|Legacy |Unexpected legacy|Invalid legacy|Unsupported Firestore|Unsafe exported)/.test(
        error.message,
      )
      ? error.message
      : "Legacy export failed; verify source/read permissions/output path. Nothing was deleted.",
  );
  process.exitCode = 1;
}
