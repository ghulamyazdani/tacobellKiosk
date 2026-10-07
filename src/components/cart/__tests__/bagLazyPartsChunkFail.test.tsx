import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  setPipelines,
  setSelectedPipeline,
  setTabType,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { store } from "../../../redux/app/store";
import { setOrderTypeSwitchNotice } from "../../../redux/features/menuSelections/menuSelections.slice";
import BagSheet from "../BagSheet";
import "../../../i18n";

/*
  Lane bag-pdp — a lane part of the ONE lazy bag chunk that throws while it
  renders must leave the guest a working bag: the switch flow and the "how
  many" numpad degrade to their scrim, which closes them; the removal notice
  renders nothing and blocks nothing. Each fallback is a LOCAL boundary
  (reported, never a reload). A chunk that fails to LOAD never reaches them in
  the app: the bag's rail and rewards sheets load the same chunk on open with
  no local boundary, so chunkRecovery reloads (cart kept) or, on a page under
  60 s old, the crash screen shows (main's design, loadActivityModal.ts). The
  PDP's half is pages/Customization/__tests__/CustomizationChunkFail.test.tsx.
*/

const mocks = vi.hoisted(() => ({ capture: vi.fn(), navigate: vi.fn() }));

// The lane's parts inside the real bagLazyParts fail: React throws a lazy
// rejection at render into the nearest boundary — a part that throws at
// render takes the same path. The chunk's older parts load as usual.
const chunkFailed = vi.hoisted(() => () => {
  throw new TypeError("Failed to fetch dynamically imported module: /assets/bagLazyParts-0ld.js");
});
vi.mock("../OrderTypeSwitchFlow", () => ({ default: chunkFailed }));
vi.mock("../OrderTypeSwitchNotice", () => ({ default: chunkFailed }));
vi.mock("../EditHowManyModal", () => ({ default: chunkFailed }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

type Row = Record<string, unknown>;
const cartItems = () => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems;

const BURGER = (quantity: number): Row => ({
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1",
  name: "Cheese Burger",
  quantity,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 9,
  customizations: { burger_addons: [{ id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 }] },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: ["burger_addons"] },
});

const P1 = { _id: "p1", tab_id: "t1", tab_type: "dine_in" };
const P2 = { _id: "p2", tab_id: "t2", tab_type: "take_away" };

const renderBag = (open = true) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open={open} onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );

/** Click inside act, so the lazy part settles in scope. */
const tap = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/** The local boundary caught the failure and reported it (never a reload). */
const reportedLocally = () =>
  waitFor(() =>
    expect(mocks.capture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({ error_source: "react_boundary", recovery_path: "local_fallback" }),
    ),
  );

describe("a failed lazy bag part leaves a working bag (lane bag-pdp)", () => {
  beforeAll(async () => {
    await import("../bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setPipelines([P1, P2]));
    store.dispatch(setSelectedPipeline(P1));
    store.dispatch(setTabType("dine_in"));
    mocks.capture.mockReset();
    mocks.navigate.mockReset();
    // React reports every boundary-caught error on the console.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the switch flow degrades to its scrim, which closes it — again on a second tap; the bag keeps working", async () => {
    store.dispatch(setCartItems([BURGER(2)]));
    renderBag();
    await tap("bag-ordertype-takeout");
    await reportedLocally();
    expect(screen.queryByTestId("bag-ordertype-confirm")).not.toBeInTheDocument();
    const scrim = screen.getByTestId("bag-ordertype-loading");
    expect(scrim).toHaveClass("absolute", "inset-0", "z-[80]");
    expect(scrim).toHaveAccessibleName("Close");

    await tap("bag-ordertype-loading");
    expect(screen.queryByTestId("bag-ordertype-loading")).not.toBeInTheDocument();
    await tap("bag-ordertype-takeout");
    await tap("bag-ordertype-loading");
    expect(screen.queryByTestId("bag-ordertype-loading")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("bag-dec-cb-1"));
    expect(cartItems()[0]).toMatchObject({ itemId: "cb-1", quantity: 1 });
    expect(screen.getByTestId("bag-sheet")).toBeInTheDocument();
  });

  it("the 'how many' numpad degrades to its scrim; a one-unit row still edits straight away", async () => {
    store.dispatch(setCartItems([BURGER(3)]));
    renderBag();
    await tap("bag-edit-cb-1");
    await reportedLocally();
    expect(screen.queryByTestId("edit-how-many")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-how-many-loading")).toHaveClass("absolute", "inset-0", "z-50");
    await tap("edit-how-many-loading");
    expect(screen.queryByTestId("edit-how-many-loading")).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("bag-dec-cb-1"));
    fireEvent.click(screen.getByTestId("bag-dec-cb-1"));
    expect(cartItems()[0]).toMatchObject({ quantity: 1 });
    await tap("bag-edit-cb-1");
    expect(mocks.navigate).toHaveBeenCalledWith("/customization", { state: { direction: "cart" } });
  });

  it("the bag closed: a removal notice whose part failed renders nothing and blocks nothing", async () => {
    store.dispatch(setOrderTypeSwitchNotice({ removed: [BURGER(1)] }));
    const view = renderBag(false);
    await reportedLocally();
    expect(screen.queryByTestId("bag-ordertype-notice")).not.toBeInTheDocument();
    expect(view.container.querySelector(".fixed")).toBeNull();
  });
});
