import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, NavigationType } from "react-router-dom";
import { KioskEventName } from "@cx-sdk/core";
import { store } from "../../redux/app/store";
import { AppRoutes } from "../AppRoutes";
import { notePath, pageEnterDirection } from "../../hooks/utils/usePageEnter";

/*
  CartRehydratedContext is the "the cart rows are real now" signal BagSheet's
  empty-cart exit waits for after a crash-reload on /cart. It must stay false
  while the Dexie rehydrate is in flight (an early true drops the customer's
  saved reward on the transient empty cart) and must settle true once the
  rehydrate is done, whether it resolved OR failed (Rule 2: a broken Dexie
  must not leave a stale reward on a bag that can never exit). Mutation
  verifier: "never true on a Dexie failure" survived every other test.
*/

const { syncCartOnReLoad } = vi.hoisted(() => ({
  syncCartOnReLoad: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../hooks/menuHooks/useCartHook", () => ({
  default: () => ({ syncCartOnReLoad }),
}));

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const rehydrateReports = () =>
  mockCapture.mock.calls.filter(
    ([event, props]) =>
      event === KioskEventName.ErrorOccurred &&
      (props as { error_source?: string })?.error_source === "dexie"
  );

// An unregistered device renders Registration at "/": probe the signal there.
vi.mock("../../pages/Registration", async () => {
  const { useCartRehydrated } = await import("../../hooks/utils/useCartRehydrated");
  return {
    default: function RehydratedProbe() {
      return <p data-testid="cart-rehydrated">{String(useCartRehydrated())}</p>;
    },
  };
});

const renderRoutes = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>
    </Provider>
  );

const signal = () => screen.getByTestId("cart-rehydrated");

describe("AppRoutes — the cart-rehydrated signal (crash-reload on /cart)", () => {
  beforeEach(() => {
    syncCartOnReLoad.mockReset();
    mockCapture.mockReset();
  });

  it("stays false while the Dexie rehydrate is in flight, turns true once it lands, and the rehydrate runs once", async () => {
    let land: () => void = () => {};
    syncCartOnReLoad.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        land = resolve;
      })
    );
    renderRoutes();
    expect(signal()).toHaveTextContent("false");
    await act(async () => {
      await Promise.resolve();
    });
    expect(signal()).toHaveTextContent("false");

    await act(async () => {
      land();
    });
    expect(signal()).toHaveTextContent("true");
    expect(syncCartOnReLoad).toHaveBeenCalledTimes(1);
    expect(rehydrateReports()).toEqual([]);
  });

  it("settles true when the rehydrate FAILS (Dexie unavailable): the empty-cart exit is never left waiting — and the loss is reported once (audit-fixes C5)", async () => {
    syncCartOnReLoad.mockRejectedValueOnce(new Error("dexie unavailable"));
    renderRoutes();
    await waitFor(() => expect(signal()).toHaveTextContent("true"));
    expect(rehydrateReports()).toEqual([
      [
        KioskEventName.ErrorOccurred,
        { error_source: "dexie", stage: "rehydrate", error_message: "dexie unavailable" },
      ],
    ]);
  });

  it("reports the ROOT cause syncCartOnReLoad wraps (its own console line is gone)", async () => {
    syncCartOnReLoad.mockRejectedValueOnce(
      new Error("Error syncing cart from Dexie", {
        cause: new Error("DatabaseClosedError: Database has been closed"),
      })
    );
    renderRoutes();
    await waitFor(() => expect(signal()).toHaveTextContent("true"));
    expect(rehydrateReports()).toEqual([
      [
        KioskEventName.ErrorOccurred,
        {
          error_source: "dexie",
          stage: "rehydrate",
          error_message: "DatabaseClosedError: Database has been closed",
        },
      ],
    ]);
  });
});

/*
  Motion contract §2.3: AppRoutes writes the session trail usePageEnter reads,
  once per COMMITTED pathname. Here an unregistered device's /second commits,
  the guard bounces it to / (REPLACE), and both land on the trail — so a later
  PUSH to /second reads as a return ("back").
*/
describe("AppRoutes — the motion session trail", () => {
  beforeEach(() => {
    syncCartOnReLoad.mockReset();
    syncCartOnReLoad.mockResolvedValue(undefined);
    notePath("/start"); // a fresh, empty trail
  });

  it("notes each committed pathname: a PUSH back to one of them is back, anything else fwd", async () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/second"]}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>
    );
    await waitFor(() => expect(signal()).toHaveTextContent("true")); // the guard landed on /
    expect(pageEnterDirection("/second", NavigationType.Push)).toBe("back");
    expect(pageEnterDirection("/menu", NavigationType.Push)).toBe("fwd");
  });
});
