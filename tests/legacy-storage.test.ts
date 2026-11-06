import { expect, it } from "vitest";
import { initialUser } from "../shared/ledger";
import {
  decodeFirestore,
  digest,
  planImport,
  reconcileLegacy,
} from "../scripts/legacy-storage";
const snapshot = {
  id: "old-rate",
  source: "PMA",
  fetchedAt: "2026-10-31T10:00:00.123Z",
  publishedAt: null,
  ils: { ILS: 1000000, USD: 3500123, JOD: 5000456 },
  quotes: [],
};
const exported = (values: { id: string; value: unknown }[]) => ({
  format: 1,
  source: "fixture",
  exportedAt: "2026-11-01T00:00:00.000Z",
  records: values.map((r) => ({ ...r, hash: digest(r.value) })),
});
it("validates exports, deduplicates observations and preserves timestamp/precision/legacy accounts", () => {
  const account = initialUser();
  const input = exported([
    { id: "rates", value: [snapshot, snapshot] },
    { id: "user_auth0_legacy", value: account },
    { id: "cache_transient", value: {} },
    { id: "lease_transient", value: {} },
  ]);
  const plan = planImport(input);
  expect(plan.observations).toEqual([{ provider: "pma", snapshot }]);
  expect(plan.records[0].value).toEqual(account);
  expect(plan.skippedTransient).toBe(2);
  expect(plan.conflicts).toEqual([]);
  input.records[0].hash = "a".repeat(64);
  expect(() => planImport(input)).toThrow("integrity");
});
it("rejects conflicting IDs, unsafe rates, unsupported records and incomplete account shapes", () => {
  expect(
    planImport(
      exported([
        {
          id: "rates",
          value: [snapshot, { ...snapshot, ils: { ...snapshot.ils, USD: 1 } }],
        },
      ]),
    ).conflicts,
  ).toEqual(["observation:old-rate"]);
  expect(() =>
    planImport(
      exported([
        {
          id: "rates",
          value: [{ ...snapshot, ils: { ...snapshot.ils, JOD: -1 } }],
        },
      ]),
    ),
  ).toThrow();
  expect(() => planImport(exported([{ id: "user_alice", value: {} }]))).toThrow(
    "account shape",
  );
  expect(
    planImport(exported([{ id: "unrecognized", value: {} }])).unsupported,
  ).toEqual(["unrecognized"]);
});
it("decodes Firestore JSON without losing numeric precision or accepting unsupported types", () => {
  expect(
    decodeFirestore({
      mapValue: {
        fields: {
          value: {
            arrayValue: {
              values: [
                { integerValue: "3500123" },
                { nullValue: null },
                { stringValue: "original" },
              ],
            },
          },
        },
      },
    }),
  ).toEqual({ value: [3500123, null, "original"] });
  expect(() => decodeFirestore({ integerValue: "9007199254740993" })).toThrow(
    "Unsafe",
  );
  expect(() => decodeFirestore({ referenceValue: "unhandled" })).toThrow(
    "Unsupported",
  );
});
it("performs a read-only reconciliation, and handles empty exports without touching a destination", async () => {
  let writes = 0;
  const dest = {
    read: async () => undefined,
    cas: async () => {
      writes++;
      return true;
    },
    observation: async () => {
      writes++;
      return true;
    },
    readObservation: async () => null,
  };
  const plan = planImport(exported([{ id: "rates", value: [snapshot] }]));
  expect(await reconcileLegacy(plan, dest, false)).toMatchObject({
    missing: 1,
    inserted: 0,
    complete: false,
  });
  expect(writes).toBe(0);
  expect(
    await reconcileLegacy(planImport(exported([])), dest, true),
  ).toMatchObject({ complete: true, inserted: 0 });
  expect(writes).toBe(0);
});
