// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Circles } from "../src/Circles";
import { Activity } from "../src/Wallet";
import { api } from "../src/api";
import { initialUser } from "../shared/ledger";
import type { State } from "../shared/types";
import type { CircleDetail } from "../shared/circles";
vi.mock("../src/api", () => ({ api: vi.fn() }));
const state = (): State => ({
  ...initialUser(),
  balances: { USD: 0, ILS: 0, JOD: 0 },
  savingsBalances: { USD: 0, ILS: 0, JOD: 0 },
  snapshots: [],
  authMode: "auth0",
  capabilities: { firebase: false, paypal: false, gemini: false },
});
const circle: CircleDetail = {
  id: "circle-1",
  name: "Trip",
  description: "",
  currency: "USD",
  target: "10000",
  balance: "0",
  owner: false,
  archived: false,
  reached: false,
  members: [],
  entries: [],
  activity: [],
  proposals: [],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  sessionStorage.clear();
});
it("retains cross-currency savings activity when filtering by the credited wallet", () => {
  const data = state();
  data.ledger = [
    {
      id: "purchase",
      at: new Date().toISOString(),
      kind: "purchase",
      currency: "ILS",
      amount: 2340,
      saved: 160,
      description: "School supplies",
      category: "Education",
      postings: [{ currency: "USD", account: "savings", amount: 45 }],
    },
  ];
  const onFilter = vi.fn();
  render(<Activity state={data} onSelect={vi.fn()} onFilter={onFilter} />);
  fireEvent.change(screen.getByLabelText("Currency"), {
    target: { value: "USD" },
  });
  expect(screen.getByRole("button", { name: /School supplies/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "Food & drink" },
  });
  expect(onFilter).toHaveBeenLastCalledWith("USD", "Food & drink", "", "");
  expect(screen.queryByRole("option", { name: "Food & Drink" })).toBeNull();
});
it("recovers an initial Circle read failure and removes the stale error", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValue([circle]);
  render(
    <Circles
      state={state()}
      onUpdated={vi.fn()}
      onDestinationSaved={vi.fn()}
    />,
  );
  expect(await screen.findByText("Temporary failure")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading Circles" }),
  );
  expect(await screen.findByRole("button", { name: /Trip/ })).toBeTruthy();
  expect(screen.queryByText("Temporary failure")).toBeNull();
});
it("ignores a stale Circle refresh after navigating back to the list", async () => {
  let resolve!: (value: CircleDetail) => void;
  let delay = false;
  const second = { ...circle, id: "circle-2", name: "Beach" };
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/circles"
      ? [circle, second]
      : path === "/circles/circle-2"
        ? second
        : delay
          ? new Promise<CircleDetail>((done) => {
              resolve = done;
            })
          : circle,
  );
  render(
    <Circles
      state={state()}
      onUpdated={vi.fn()}
      onDestinationSaved={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Trip/ }));
  await screen.findByRole("heading", { name: "Trip" });
  delay = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh Circle" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: /All Circles/i }));
  await screen.findByRole("button", { name: "Create Circle" });
  fireEvent.click(screen.getByRole("button", { name: /Beach/ }));
  await screen.findByRole("heading", { name: "Beach" });
  await act(async () => resolve({ ...circle, name: "Stale Trip" }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Stale Trip" })).toBeNull(),
  );
  expect(screen.getByRole("heading", { name: "Beach" })).toBeTruthy();
});
