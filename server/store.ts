import "./env";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { UserData, Snapshot } from "../shared/types";
import { initialUser } from "./ledger";
export const firebaseEnabled = !!process.env.FIREBASE_SERVICE_ACCOUNT;
if (firebaseEnabled && !getApps().length)
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)),
  });
export const cloud = process.env.STORAGE === "firestore";
if (cloud && !firebaseEnabled)
  throw new Error(
    "STORAGE=firestore requires FIREBASE_SERVICE_ACCOUNT for auxiliary data and rate history.",
  );
if (process.env.VERCEL && !cloud)
  throw new Error(
    "Vercel requires STORAGE=firestore and FIREBASE_SERVICE_ACCOUNT for durable auxiliary data and rate history, including when Supabase stores wallet balances.",
  );
const db = cloud
  ? null
  : await (async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const path = process.env.DATABASE_PATH || "data/walletwise.db";
      mkdirSync(dirname(path), { recursive: true });
      const db = new DatabaseSync(path);
      db.exec("PRAGMA busy_timeout=5000");
      db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      return db;
    })();
export async function read<T>(id: string): Promise<T | undefined> {
  if (cloud) {
    return (await getFirestore().collection("walletwise").doc(id).get()).data()
      ?.value as T | undefined;
  }
  const row = db!.prepare("SELECT value FROM records WHERE id=?").get(id) as
    { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}
export async function update<T, R>(
  id: string,
  initial: () => T,
  fn: (data: T) => R,
): Promise<R> {
  if (cloud)
    return getFirestore().runTransaction(async (tx) => {
      const ref = getFirestore().collection("walletwise").doc(id);
      const doc = await tx.get(ref);
      const data = (doc.data()?.value ?? initial()) as T;
      const result = fn(data);
      tx.set(ref, { value: JSON.parse(JSON.stringify(data)) });
      return result;
    });
  db!.exec("BEGIN IMMEDIATE");
  try {
    const row = db!.prepare("SELECT value FROM records WHERE id=?").get(id) as
      { value: string } | undefined;
    const data: T = row ? JSON.parse(row.value) : initial();
    const result = fn(data);
    db!
      .prepare(
        "INSERT INTO records(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(data));
    db!.exec("COMMIT");
    return result;
  } catch (e) {
    db!.exec("ROLLBACK");
    throw e;
  }
}
export const userUpdate = <R>(uid: string, fn: (data: UserData) => R) =>
  update(`user_${uid}`, () => initialUser(uid.startsWith("demo_")), fn);
export const userRead = (uid: string) => userUpdate(uid, (data) => data);
export const snapshots = async (): Promise<Snapshot[]> =>
  process.env.MARKET_DATA_PROVIDER === "twelve"
    ? (await import("./forex-store")).readForexSnapshots()
    : ((await read<Snapshot[]>("rates")) ?? []);
export async function users(): Promise<string[]> {
  if (cloud) {
    return (await getFirestore().collection("walletwise").select().get()).docs
      .map((d) => d.id)
      .filter((id) => id.startsWith("user_"))
      .map((id) => id.slice(5));
  }
  return (
    db!.prepare("SELECT id FROM records WHERE id LIKE 'user_%'").all() as {
      id: string;
    }[]
  ).map((r) => r.id.slice(5));
}
