// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { App } from "../src/App";
import { initialUser } from "../shared/ledger";
import type { State } from "../shared/types";
import { bootstrapFixture, loadingResponse } from "./fixtures/loading";
vi.mock("../src/api", () => ({ api: vi.fn(), logout: vi.fn() }));
vi.mock("../src/useMarketFeed", () => ({ useMarketFeed: () => undefined }));
import { api } from "../src/api";
import { ApiError } from "../src/errors";
const fixture = (): State => ({
  ...initialUser(),
  balances: { USD: 12345, ILS: 0, JOD: 0 },
  savingsBalances: { USD: 0, ILS: 0, JOD: 0 },
  snapshots: [],
  authMode: "auth0",
  capabilities: { firebase: false, paypal: false, gemini: false },
  progressive: true,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  location.hash = "";
});
it("keeps an insufficient-funds rejection in the purchase dialog and clears it on close", async () => {
  location.hash = "#My%20Wallet";
  const state = fixture();
  state.balances = { USD: 0, ILS: 0, JOD: 0 };
  state.preferences.savings = "disabled";
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/savings/options") return { options: [] };
    if (path === "/savings/preview") return { quote: null, saved: 0 };
    if (path === "/purchases")
      throw new ApiError("Insufficient wallet balance for this operation.", 409);
    return loadingResponse(path, state);
  });
  render(<App initial={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Simulate purchase" }));
  fireEvent.change(screen.getByLabelText("Merchant or description"), {
    target: { value: "Coffee" },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", {
        name: "Complete simulated purchase",
      }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Complete simulated purchase" }),
  );
  expect(await screen.findByText(/Insufficient wallet balance/)).toBeTruthy();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText("Something went wrong")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/Insufficient wallet balance/)).toBeNull();
  expect(screen.queryByText("Something went wrong")).toBeNull();
  expect(screen.getByText("Wallet activity")).toBeTruthy();
  expect(state.balances).toEqual({ USD: 0, ILS: 0, JOD: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Simulate purchase" }));
  expect(screen.queryByText(/Insufficient wallet balance/)).toBeNull();
});
it("shows no substitute balances before essential initialization, then makes the wallet usable while independent sections load", async () => {
  const state = fixture(),
    essential = deferred<unknown>(),
    overview = deferred<unknown>(),
    activity = deferred<unknown>();
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/bootstrap"
      ? essential.promise
      : path.startsWith("/dashboard")
        ? overview.promise
        : path.startsWith("/activity")
          ? activity.promise
          : { available: false, currencies: [], maxMinor: 500000, orders: [] },
  );
  render(<App />);
  expect(screen.queryByText("$0.00")).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
  await act(async () => essential.resolve(bootstrapFixture(state)));
  expect(await screen.findByText("$123.45")).toBeTruthy();
  expect(screen.getByLabelText("Loading recent activity")).toBeTruthy();
  expect(screen.getByLabelText("Loading monthly spending")).toBeTruthy();
  expect(screen.getByLabelText("Loading currency trends")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Add Funds$/ }));
  expect(
    await screen.findByText(/Adding funds is currently unavailable/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  await act(async () => {
    overview.resolve(loadingResponse("/dashboard", state));
    activity.resolve(loadingResponse("/activity", state));
  });
  expect(
    await screen.findByText("No transactions yet. Add funds to get started."),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Loading monthly spending")).toBeNull();
});
it("keeps verified balances and navigation when background data fails and retries only the failed section", async () => {
  const state = fixture();
  let fail = true;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/dashboard") && fail) throw new Error("offline");
    return loadingResponse(path, state);
  });
  render(<App initial={state} />);
  await screen.findByText(/We couldn't load monthly spending/);
  expect(screen.getByText("$123.45")).toBeTruthy();
  const bootstrapCalls = vi
    .mocked(api)
    .mock.calls.filter(([path]) => path === "/bootstrap").length;
  fail = false;
  fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
  await waitFor(() =>
    expect(screen.queryByText(/We couldn't load monthly spending/)).toBeNull(),
  );
  expect(
    vi.mocked(api).mock.calls.filter(([path]) => path === "/bootstrap"),
  ).toHaveLength(bootstrapCalls);
});
it("ignores a previous account response after its protected view unmounts", async () => {
  const old = fixture(),
    pending = deferred<unknown>();
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/dashboard")
      ? pending.promise
      : loadingResponse(path, old),
  );
  const first = render(<App initial={old} />);
  first.unmount();
  const next = { ...fixture(), balances: { USD: 45678, ILS: 0, JOD: 0 } };
  vi.mocked(api).mockImplementation(async (path) =>
    loadingResponse(path, next),
  );
  render(<App initial={next} />);
  await screen.findByText("$456.78");
  await act(async () =>
    pending.resolve({
      balances: old.balances,
      notices: [{ title: "Old account" }],
    }),
  );
  expect(screen.queryByText("$123.45")).toBeNull();
  expect(screen.queryByText("Old account")).toBeNull();
});
