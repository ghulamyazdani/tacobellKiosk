import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { buildOrderTypeSelectionActions } from "@cx-sdk/ordering/cart/orderTypeSwitch";
import type { SwitchablePipeline } from "@cx-sdk/ordering/cart/orderTypeTarget";
import { store } from "../../../redux/app/store";
import {
  setLanguages,
  setSelectedLanguage,
} from "../../../redux/features/multiLanguage/multiLanguage.slice";
import SecondLayout from "../../../pages/SecondLayout";
import useOrderTypeSwitch from "../useOrderTypeSwitch";
import "../../../i18n";

/*
  Item 19 (lane bag-pdp): the in-bag switch must leave the store exactly as a
  /second tap on the same pipeline does. Pinned against the REAL SecondLayout
  (not a transcription of it): its four selection dispatches equal
  buildOrderTypeSelectionActions, and the executor's commit opens with the
  same four, read from the same language selectors.

  Seams: the menu fetch (staged when the switch passes opts) and the charges
  fetch.
*/

type Staging = { apply?: (action: UnknownAction) => unknown };

vi.mock("../../menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: (_tab: unknown, _redux: unknown, _rerun: unknown, _pipeline: unknown, opts?: Staging) => {
      opts?.apply?.(setEntityMap({ entityMap: {} }));
      opts?.apply?.(setModifiersMap({ modifiersMap: {} }));
      opts?.apply?.(setFilteredOffers([]));
      return Promise.resolve({ categories: [{ id: "c1" }] });
    },
  }),
}));

vi.mock("../../utils/useAppSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/useAppSettings")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      getChargesCountryDataApi: () => Promise.resolve({ ok: true, deploymentCharges: [] }),
    }),
  };
});

const DINE: SwitchablePipeline = { _id: "p-dine", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" };
const TAKE: SwitchablePipeline = { _id: "p-take", tab_id: "t2", tab_type: "take_away", primary_name: "Take Out" };
const SELECTION_TYPES = new Set([
  "pipeline/setSelectedPipeline",
  "auth/setSelectedTabId",
  "pipeline/setTabType",
  "menu/resetCategorySelection",
]);
const SESSIONS = {
  en: { name: "English", code: "en", dir: "ltr", type: "primary_language" },
  ar: { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" },
} as const;

const seed = (code: keyof typeof SESSIONS) => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setPipelines([DINE, TAKE]));
  store.dispatch(
    setLanguages({
      primary_language: { name: "English", code: "en" },
      secondary_language: { name: "العربية", code: "ar" },
    }),
  );
  store.dispatch(setSelectedLanguage(SESSIONS[code]));
};

const selectionOf = (calls: unknown[][]) =>
  calls
    .map(([action]) => action as UnknownAction)
    .filter((action) => SELECTION_TYPES.has(String(action?.type)));

/** The four actions a real /second tap on TAKE dispatches. */
const tapSecondLayout = async () => {
  const dispatch = vi.spyOn(store, "dispatch");
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/second"]}>
        <Routes>
          <Route path="/second" element={<SecondLayout />} />
          <Route path="/menu" element={<p>menu-screen</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  dispatch.mockClear();
  await userEvent.click(screen.getByTestId("pipeline-p-take"));
  await screen.findByText("menu-screen");
  const actions = selectionOf(dispatch.mock.calls);
  view.unmount();
  dispatch.mockRestore();
  return actions;
};

/** The executor's commit, from the same seeded store. */
const switchInBag = async () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>{children}</MemoryRouter>
    </Provider>
  );
  const dispatch = vi.spyOn(store, "dispatch");
  const hook = renderHook(() => useOrderTypeSwitch({ onRemoveLoyaltyRow: vi.fn() }), { wrapper });
  dispatch.mockClear();
  let outcome: unknown;
  await act(async () => {
    outcome = await hook.result.current.switchTo(TAKE);
  });
  const calls = dispatch.mock.calls.map(([action]) => action as UnknownAction);
  hook.unmount();
  dispatch.mockRestore();
  return { outcome, calls };
};

describe("order-type switch ↔ /second parity (item 19)", () => {
  beforeEach(() => seed("en"));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["en", "ar"] as const)(
    "%s session: SecondLayout's selection dispatches ARE buildOrderTypeSelectionActions, and the switch commits them first, in order",
    async (code) => {
      seed(code);
      const second = await tapSecondLayout();
      const expected = buildOrderTypeSelectionActions(TAKE, {
        primaryCode: SESSIONS[code].code,
        secondaryCode: "ar",
      });
      expect(second).toEqual(expected);

      seed(code);
      const { outcome, calls } = await switchInBag();
      expect(outcome).toMatchObject({ ok: true });
      expect(calls.slice(0, 4)).toEqual(second);
    },
  );
});
