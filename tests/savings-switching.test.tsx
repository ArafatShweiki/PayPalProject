// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { SavingsSetup, SavingsDestinationPanel } from "../src/SavingsSetup";
import { api } from "../src/api";
import { initialUser } from "../shared/ledger";
import type { State } from "../shared/types";
import type { SavingsDestination, SavingsOptions } from "../shared/circles";
vi.mock("../src/api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const personal: SavingsDestination = {
  kind: "goal",
  id: "11111111-1111-4111-8111-111111111111",
  currency: "USD",
};
const circle: SavingsDestination = {
  kind: "circle",
  id: "22222222-2222-4222-8222-222222222222",
  currency: "JOD",
};
function options(): SavingsOptions {
  return {
    destination: circle,
    options: [
      { ...personal, name: "New Laptop", target: "10000", saved: "0" },
      { ...circle, name: "Family Vacation", target: "10000", saved: "0" },
    ],
    historical: { ILS: "0", USD: "0", JOD: "0" },
    reconciliationRequired: false,
  };
}
it("keeps personal goals and Circles available and submits a replacement once", async () => {
  let finish!: (v: SavingsDestination) => void;
  vi.mocked(api)
    .mockResolvedValueOnce(options())
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const done = vi.fn();
  render(<SavingsSetup onDone={done} />);
  const choice = await screen.findByRole("radio", { name: "New Laptop USD" });
  expect(
    screen.getByRole("region", { name: "Personal savings goals" }),
  ).toBeTruthy();
  expect(screen.getByRole("region", { name: "Savings Circles" })).toBeTruthy();
  expect(
    screen.getByRole("radio", { name: "Family Vacation JOD" }),
  ).toHaveProperty("checked", true);
  fireEvent.click(choice);
  const save = screen.getByRole("button", { name: "Use this goal" });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(api).toHaveBeenCalledTimes(2);
  expect(api).toHaveBeenLastCalledWith(
    "/savings/destination",
    { kind: "goal", id: personal.id, enable: true },
    "PUT",
  );
  await act(async () => finish(personal));
  expect(done).toHaveBeenCalledExactlyOnceWith(personal);
});
it("keeps the previous confirmed destination when saving fails", async () => {
  const choices = options();
  vi.mocked(api)
    .mockResolvedValueOnce(choices)
    .mockRejectedValueOnce(new Error("Unable to save. Please try again."));
  const done = vi.fn();
  render(<SavingsSetup onDone={done} />);
  fireEvent.click(await screen.findByRole("radio", { name: "New Laptop USD" }));
  fireEvent.click(screen.getByRole("button", { name: "Use this goal" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Unable to save",
  );
  expect(done).not.toHaveBeenCalled();
  expect(choices.destination).toEqual(circle);
  expect(screen.getByRole("button", { name: "Use this goal" })).toHaveProperty(
    "disabled",
    false,
  );
});
it("displays the newly confirmed profile default immediately while options refresh", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(options())
    .mockImplementationOnce(() => new Promise(() => {}));
  const state = {
    ...initialUser(),
    preferences: {
      ...initialUser().preferences,
      savings: "enabled",
      savingsDestination: circle,
    },
  } as State;
  const { rerender } = render(
    <SavingsDestinationPanel state={state} onChoose={() => {}} />,
  );
  await screen.findByText(/Family Vacation · JOD/);
  rerender(
    <SavingsDestinationPanel
      state={{
        ...state,
        preferences: { ...state.preferences, savingsDestination: personal },
      }}
      onChoose={() => {}}
    />,
  );
  expect(screen.getByText(/New Laptop · USD/)).toBeTruthy();
  expect(screen.queryByText(/Family Vacation · JOD/)).toBeNull();
});
it("does not retain an ineligible Circle as a selectable default", async () => {
  const choices = options();
  choices.options = choices.options.filter((o) => o.kind === "goal");
  vi.mocked(api).mockResolvedValueOnce(choices);
  render(<SavingsSetup onDone={() => {}} />);
  const choice = await screen.findByRole("radio", { name: "New Laptop USD" });
  expect(choice).toHaveProperty("checked", false);
  expect(screen.queryByRole("radio", { name: /Family Vacation/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Use this goal" })).toHaveProperty(
    "disabled",
    true,
  );
});
it("offers explicit goal creation when there are no eligible destinations", async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...options(), options: [] });
  render(<SavingsSetup onDone={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText("Goal name")).toBeTruthy());
  expect(
    screen.queryByRole("group", { name: "Default savings destination" }),
  ).toBeNull();
});
