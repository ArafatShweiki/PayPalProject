import { beforeEach, it, expect, vi } from "vitest";
import { initialUser } from "../shared/ledger";
import type { UserData } from "../shared/types";
type Row = {
  user_id: string;
  auth0_sub: string;
  version: number;
  state: UserData;
};
const fixture = vi.hoisted(() => ({
  enabled: true,
  rows: new Map<string, Row>(),
}));
vi.mock("../server/supabase", () => ({
  supabaseEnabled: () => fixture.enabled,
  readProfile: async () => null,
  getServerSupabase: () => ({
    from: () => ({
      select: () => {
        let uid = "";
        const query = {
          eq: (_key: string, value: string) => {
            uid = value;
            return query;
          },
          maybeSingle: async () => ({
            data: fixture.rows.has(uid)
              ? structuredClone(fixture.rows.get(uid))
              : null,
            error: null,
          }),
        };
        return query;
      },
      insert: (value: Row) => write(value, true),
      update: (value: Partial<Row>) => write(value, false),
    }),
  }),
}));
function write(patch: Partial<Row>, insert: boolean) {
  const filters: Record<string, unknown> = {};
  const query = {
    eq: (key: string, value: unknown) => {
      filters[key] = value;
      return query;
    },
    select: async () => {
      const uid = (patch.user_id || filters.user_id) as string;
      const current = fixture.rows.get(uid);
      if (insert && current) return { data: null, error: { code: "23505" } };
      if (!insert && (!current || current.version !== filters.version))
        return { data: [], error: null };
      fixture.rows.set(
        uid,
        structuredClone({
          ...current,
          ...patch,
          version: patch.version ?? 0,
        }) as Row,
      );
      return { data: [{ user_id: uid }], error: null };
    },
  };
  return query;
}
import {
  registerUserIdentity,
  userUpdate,
  userRead,
  read,
  update,
} from "../server/store";
beforeEach(() => {
  fixture.enabled = true;
  fixture.rows.clear();
});
it("persists zero-state accounts and retries concurrent auxiliary writes without lost updates", async () => {
  registerUserIdentity("alice", "auth0|alice");
  await userRead("alice");
  await Promise.all(
    Array.from({ length: 10 }, () =>
      userUpdate("alice", (data) => {
        data.preferences.name = String(Number(data.preferences.name || 0) + 1);
      }),
    ),
  );
  const saved = await userRead("alice");
  expect(saved.preferences.name).toBe("10");
  expect(saved.ledger).toEqual([]);
  expect(fixture.rows.get("alice")?.auth0_sub).toBe("auth0|alice");
});
it("copies only the verified account legacy auxiliary state and keeps the original", async () => {
  await update("user_legacy", initialUser, (data) => {
    data.preferences.name = "Imported";
  });
  registerUserIdentity("legacy", "auth0|legacy");
  expect((await userRead("legacy")).preferences.name).toBe("Imported");
  await userUpdate("legacy", (data) => {
    data.preferences.name = "Persisted";
  });
  expect((await userRead("legacy")).preferences.name).toBe("Persisted");
  expect(fixture.rows.has("legacy")).toBe(true);
  expect((await read<UserData>("user_legacy"))?.preferences.name).toBe(
    "Imported",
  );
});
it("rejects a mismatched stored account owner", async () => {
  registerUserIdentity("mismatch", "auth0|alice");
  fixture.rows.set("mismatch", {
    user_id: "mismatch",
    auth0_sub: "auth0|bob",
    version: 0,
    state: initialUser(),
  });
  await expect(userRead("mismatch")).rejects.toThrow("Verified account");
  expect(fixture.rows.get("mismatch")?.auth0_sub).toBe("auth0|bob");
});
it("never falls back to a local account when Supabase is disabled", async () => {
  await update("user_disabled", initialUser, (data) => {
    data.preferences.name = "Legacy";
  });
  fixture.enabled = false;
  registerUserIdentity("disabled", "auth0|disabled");
  await expect(userRead("disabled")).rejects.toThrow("unavailable");
  expect(fixture.rows.size).toBe(0);
});
