import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createMocks } from "react-idle-timer";
import type { UnknownAction } from "@reduxjs/toolkit";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { store } from "../../../redux/app/store";
import IdleGuard from "../../../routes/IdleGuard";
import useOrderTypeSwitch from "../useOrderTypeSwitch";
import "../../../i18n";

/*
  Item 19 (lane bag-pdp, D1) × Rule 1: the in-bag switch holds idle while its
  requests are in flight — through the REAL IdleGuard (react-idle-timer on a
  fake clock; createMocks() after every vi.useFakeTimers()) — and the hold is
  BOUNDED: a switch that never answers cannot park the kiosk. When idle then
  ends the session, the late answer writes nothing (the executor is gone).

  Seams: the two staged fetchers (held open by hand) and analytics.
*/

type Staging = { apply: (action: UnknownAction) => unknown };

const net = vi.hoisted(() => ({ release: [] as Array<() => void>, capture: vi.fn() }));

vi.mock("../../utils/useAppSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/useAppSettings")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      getChargesCountryDataApi: () =>
        new Promise((resolve) => {
          net.release.push(() => resolve({ ok: true, deploymentCharges: [] }));
        }),
    }),
  };
});

vi.mock("../../menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: (_tab: unknown, _redux: unknown, _rerun: unknown, _pipeline: unknown, opts: Staging) =>
      new Promise((resolve) => {
        net.release.push(() => {
          opts.apply(setEntityMap({ entityMap: {} }));
          opts.apply(setModifiersMap({ modifiersMap: {} }));
          opts.apply(setFilteredOffers([]));
          resolve({ categories: [{}] });
        });
      }),
  }),
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: net.capture,
}));

const TARGET = { _id: "p2", tab_id: "t2", tab_type: "take_away" };

/** The bag's seat of the executor (OrderTypeSwitchFlow's, minus the dialogs). */
function SwitchPage() {
  const { status, switchTo } = useOrderTypeSwitch({ onRemoveLoyaltyRow: () => {} });
  return (
    <div data-testid="page-cart">
      <span data-testid="status">{status}</span>
      <button type="button" data-testid="switch" onClick={() => void switchTo(TARGET)} />
    </div>
  );
}

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <Routes>
          <Route path="/start" element={<div data-testid="splash" />} />
          <Route element={<IdleGuard />}>
            <Route path="/cart" element={<SwitchPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const prompt = () => screen.queryByTestId("idle-modal");
const splash = () => screen.queryByTestId("splash");
const selectedPipeline = () =>
  (store.getState() as unknown as { pipeline: { selectedPipeline: { _id?: string } | null } }).pipeline
    .selectedPipeline;

/** Answer every held request. */
const answer = async () => {
  await act(async () => {
    net.release.splice(0).forEach((release) => release());
  });
};

describe("the order-type switch holds idle while in flight — bounded (item 19, Rule 1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createMocks();
    store.dispatch({ type: "RESET_STATE" });
    net.release.length = 0;
    net.capture.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no prompt and no reset while the switch runs; its commit starts a fresh FULL period", async () => {
    mount();
    advance(90_000);
    act(() => {
      fireEvent.click(screen.getByTestId("switch"));
    });
    expect(screen.getByTestId("status")).toHaveTextContent("switching");

    // Well past where the prompt (100 s) and the reset (120 s) would have been.
    advance(60_000);
    expect(prompt()).not.toBeInTheDocument();
    expect(splash()).not.toBeInTheDocument();

    await answer();
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(selectedPipeline()?._id).toBe("p2");

    advance(99_999);
    expect(prompt()).not.toBeInTheDocument();
    advance(1);
    expect(prompt()).toBeInTheDocument();
  });

  it("a switch that never answers is bounded by the 120 s cap; idle then ends the session and the late answer writes nothing", async () => {
    mount();
    act(() => {
      fireEvent.click(screen.getByTestId("switch"));
    });
    advance(119_999);
    expect(prompt()).not.toBeInTheDocument();

    advance(1); // the cap gives up on the hung switch — a fresh period starts
    advance(100_000);
    expect(prompt()).toBeInTheDocument();
    advance(20_000);
    expect(splash()).toBeInTheDocument();
    expect(screen.queryByTestId("page-cart")).not.toBeInTheDocument();

    const dispatch = vi.spyOn(store, "dispatch");
    await answer();
    expect(dispatch).not.toHaveBeenCalled();
    expect(selectedPipeline()?._id).toBeUndefined();
    expect(net.capture).not.toHaveBeenCalledWith("order_type_selected", expect.anything());
    dispatch.mockRestore();
  });
});
