import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  closeTier2Modal,
  MIAMTier2Open,
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setEntityMenuObject, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

/*
  Lane figma-polish G2(c) — the PDP's lazy parts (the completion warning, the
  tier-2 CUSTOMIZE page, the split-edit planner) load at PDP MOUNT through
  loadPdpLazyParts, never at a tap — so a dead chunk is discovered before the
  guest has picked anything, and the PDP never loses a customisation to it:
  - without the parts an incomplete ADD TO BAG shows the ring (+ AutoScroll)
    alone — no warning, picks intact, no navigation;
  - tier-2 opened while the parts are pending or failed is a NAMED scrim
    (z-60) that closes tier-2 and keeps the tier-1 picks; once they arrive
    the page replaces it;
  - a failed load is retried only by the next PDP mount.
  The loader is the seam (a controllable stand-in); the real chunk supplies
  the parts on resolve. CustomizationChunkFail.test covers a REAL rejection.
*/

const lazy = vi.hoisted(() => ({
  calls: 0,
  next: null as null | Promise<unknown>,
  /** What an earlier PDP's load already kept (loadedPdpParts). */
  loaded: null as unknown,
}));

vi.mock("../loadPdpLazyParts", () => ({
  loadedPdpParts: () => lazy.loaded,
  loadPdpLazyParts: () => {
    lazy.calls += 1;
    return lazy.next ?? Promise.resolve(null);
  },
}));

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), autoScroll: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../utils/autoScroll", () => ({ default: mocks.autoScroll }));

/** Optional nested group on the fries — CUSTOMIZE-able, and still pre-selected (D5). */
const SALT = {
  _id: "fries_addons",
  name: "Salt",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "no-salt", name: "No Salt", price: 0, isActive: true }],
};
/** A one-option slot → FIXED, pre-selected, with CUSTOMIZE. */
const SIDES = {
  _id: "pk_2_combo",
  name: "Sides",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "fries", name: "Large Fries", price: 0.5, isActive: true }],
};
/** A CHOICE slot left empty → ADD TO BAG is incomplete. */
const DRINK = {
  _id: "pk_3_combo",
  name: "Drink",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    { id: "cola", name: "Cola", price: 0, isActive: true },
    { id: "lemonade", name: "Lemonade", price: 0, isActive: true },
  ],
};
const PACK = { id: "pk", name: "Pack", price: 9, applyAddonsPrice: true, modifiers: [SIDES._id, DRINK._id] };

const seed = () => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [SALT._id]: SALT, [SIDES._id]: SIDES, [DRINK._id]: DRINK } }));
  store.dispatch(
    setEntityMenuObject({
      menuEntityObject: {
        fries: { id: "fries", name: "Large Fries", price: 0.5, isActive: true, outOfStock: false, modifiers: [SALT._id] },
      },
    })
  );
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: PACK,
    })
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>
  );

const tap = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};
/** Let the loader's promise settle (it is not on React's clock). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const picks = () => tier1SelectedCustomization(store.getState()) as Record<string, Array<{ id: string }>>;
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => (resolve = res));
  return { promise, resolve };
};

describe("PDP lazy parts: warmed at mount, never at a tap; the PDP works without them (G2c)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    lazy.calls = 0;
    lazy.next = null;
    lazy.loaded = null;
    mocks.navigate.mockReset();
    mocks.autoScroll.mockReset();
    seed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the loader runs ONCE, at mount — never on ADD TO BAG or CUSTOMIZE", async () => {
    lazy.next = new Promise(() => {}); // still loading
    renderPdp();
    expect(lazy.calls).toBe(1);

    await tap("pdp-add-to-bag");
    await tap(`pack-slot-customize-${SIDES._id}`);
    await tap("tier2-loading");
    await tap(`pack-slot-customize-${SIDES._id}`);
    await settle();

    expect(lazy.calls).toBe(1);
  });

  it("failed load: an incomplete ADD TO BAG shows the ring + AutoScroll, no warning; the picks stay and nothing navigates", async () => {
    renderPdp();
    await settle(); // the mount's load answered null
    const before = structuredClone(picks());
    expect(before[SIDES._id].map((pick) => pick.id)).toEqual(["fries"]); // D5 seed

    await tap("pdp-add-to-bag");

    expect(screen.getByTestId(`pack-slot-${DRINK._id}`)).toHaveClass("ring-4", "ring-red-500");
    expect(mocks.autoScroll).toHaveBeenCalledWith(
      document.getElementById("scrollCustomizableItem"),
      expect.anything(),
      450
    );
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(picks()).toEqual(before);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
  });

  it.each([
    ["pending", () => new Promise(() => {})],
    ["failed", () => Promise.resolve(null)],
  ])("tier-2 opened while the load is %s: the NAMED tier2-loading scrim (z-60) closes tier-2 and keeps the tier-1 picks", async (_state, next) => {
    lazy.next = next();
    const dispatched = vi.spyOn(store, "dispatch");
    renderPdp();
    await settle();
    const before = structuredClone(picks());

    await tap(`pack-slot-customize-${SIDES._id}`);
    expect(MIAMTier2Open(store.getState())).toBe(true);
    const scrim = screen.getByTestId("tier2-loading");
    expect(scrim).toHaveAccessibleName("Close");
    expect(scrim).toHaveClass("absolute", "inset-0", "z-[60]");
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();

    dispatched.mockClear();
    await tap("tier2-loading");

    expect((dispatched.mock.calls as Array<[UnknownAction]>).map(([action]) => action.type)).toEqual([
      closeTier2Modal.type,
    ]);
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(screen.queryByTestId("tier2-loading")).not.toBeInTheDocument();
    expect(picks()).toEqual(before);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("when the load resolves, the tier-2 page replaces the scrim (the same open session)", async () => {
    const parts = await import("../../../components/cart/bagLazyParts");
    const gate = deferred();
    lazy.next = gate.promise;
    renderPdp();

    await tap(`pack-slot-customize-${SIDES._id}`);
    expect(screen.getByTestId("tier2-loading")).toBeInTheDocument();

    await act(async () => {
      gate.resolve({
        PdpIncompleteWarning: parts.PdpIncompleteWarning,
        Tier2CustomizationSheet: parts.Tier2CustomizationSheet,
        planSplitEditCommit: parts.planSplitEditCommit,
      });
    });

    expect(await screen.findByTestId(`tier2-group-${SALT._id}`)).toBeInTheDocument();
    expect(screen.getByTestId("tier2-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("tier2-loading")).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);
    expect(lazy.calls).toBe(1);
  }, 60_000);

  it("parts an earlier PDP already loaded: the FIRST commit has them — no load at mount, the warning at an immediate tap", async () => {
    const parts = await import("../../../components/cart/bagLazyParts");
    lazy.loaded = {
      PdpIncompleteWarning: parts.PdpIncompleteWarning,
      Tier2CustomizationSheet: parts.Tier2CustomizationSheet,
      planSplitEditCommit: parts.planSplitEditCommit,
    };
    renderPdp();
    expect(lazy.calls).toBe(0);

    // No settle: an incomplete ADD TO BAG in the first commit gets the warning, not just the ring.
    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));
    expect(screen.getByTestId("pdp-incomplete")).toBeInTheDocument();
  }, 60_000);

  it("a tier-2 page that THROWS while rendering degrades to the same named scrim, whose tap closes tier-2 (the tier-1 picks stay)", async () => {
    const parts = await import("../../../components/cart/bagLazyParts");
    lazy.loaded = {
      PdpIncompleteWarning: parts.PdpIncompleteWarning,
      Tier2CustomizationSheet: () => {
        throw new Error("tier-2 render failed");
      },
      planSplitEditCommit: parts.planSplitEditCommit,
    };
    vi.spyOn(console, "error").mockImplementation(() => {}); // React reports the caught render error
    renderPdp();
    const before = structuredClone(picks());

    await tap(`pack-slot-customize-${SIDES._id}`);
    expect(MIAMTier2Open(store.getState())).toBe(true);
    expect(screen.getByTestId("tier2-loading")).toHaveAccessibleName("Close");

    await tap("tier2-loading");
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(screen.queryByTestId("tier2-loading")).not.toBeInTheDocument();
    expect(picks()).toEqual(before);
  }, 60_000);

  it("a failed load is retried only at the NEXT mount", async () => {
    const first = renderPdp();
    await settle();
    expect(lazy.calls).toBe(1);

    await tap("pdp-add-to-bag");
    await tap(`pack-slot-customize-${SIDES._id}`);
    await tap("tier2-loading");
    await settle();
    expect(lazy.calls).toBe(1);

    first.unmount();
    renderPdp();
    expect(lazy.calls).toBe(2);
  });
});
