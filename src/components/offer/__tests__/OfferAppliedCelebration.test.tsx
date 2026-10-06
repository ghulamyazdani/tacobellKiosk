/**
 * OfferAppliedCelebration (lane "offers", item 33; design language, no
 * Figma frame). A NON-blocking 2.2 s status card driven by cart.offerModal,
 * which only customer applies open as {id, name}. It never outlives the bag
 * (unmount closes it) and a crash inside it renders nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  applyOffer,
  emptyCart,
  openOfferModal,
  removeCartOffer,
  setCartItems,
  swapCartOffer,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  setCurrency,
  setDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { resetAppliedBarCelebration } from "../../../utils/offerCelebration";
import OfferAppliedCelebration from "../OfferAppliedCelebration";
import BagSheet from "../../cart/BagSheet";
import "../../../i18n";

const mockCapture = vi.fn();
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "ITEM",
  price: 8,
  total_price: 8,
  customizations: {},
};

const FLAT_OFFER = {
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
  isAvailable: true,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null,
  minItemCount: null,
  maxDiscount: null,
  applicable: { on: "complete", isExclude: false, isInclude: false, rawItems: [] },
  getItems: {},
};

const CLOSE = "cart/closeOfferModal";

const card = () => screen.queryByTestId("offer-applied-celebration");
const region = () => screen.getByRole("status");
const modalOpen = () =>
  (store.getState() as unknown as { cart: { offerModal: { isOpen: boolean } } }).cart
    .offerModal.isOpen;

/** What a customer apply does: the slot takes the offer, the card opens. */
const customerApply = (name: unknown = FLAT_OFFER.name) =>
  act(() => {
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    store.dispatch(openOfferModal({ id: FLAT_OFFER._id, name }));
  });

const renderCard = (discount = 2, reactStrictMode = false) =>
  render(
    <Provider store={store}>
      <OfferAppliedCelebration discount={discount} currency="£" sheetHeight={1676} />
    </Provider>,
    { reactStrictMode }
  );

const closeCount = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([action]) => (action as { type?: string })?.type === CLOSE).length;

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  resetAppliedBarCelebration();
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  mockCapture.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OfferAppliedCelebration", () => {
  it("shows the title, the offer name and 'You save £2.00', with the CSS confetti burst", () => {
    renderCard(2);
    customerApply();
    const shown = card();
    expect(shown).not.toBeNull();
    const scoped = within(shown as HTMLElement);
    expect(scoped.getByText("Reward applied!")).toBeInTheDocument();
    expect(scoped.getByText("£2 off your order")).toBeInTheDocument();
    expect(scoped.getByText("You save £2.00")).toBeInTheDocument();
    expect((shown as HTMLElement).querySelectorAll(".tb-confetti-piece")).toHaveLength(28);
  });

  it("no saving line for a £0 discount", () => {
    renderCard(0);
    customerApply();
    expect(card()).not.toHaveTextContent("You save");
  });

  it("is a PERSISTENT polite status region, pointer-events-none, at z-[86] — mounted before and after the card", () => {
    renderCard();
    const live = region();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live.className).toContain("pointer-events-none");
    expect(live.className).toContain("z-[86]");
    expect(live).toBeEmptyDOMElement();

    customerApply();
    expect(region()).toBe(live);
    expect(live).toContainElement(card());
  });

  it("auto-closes at 2200 ms (still up at 2199)", () => {
    vi.useFakeTimers();
    renderCard();
    customerApply();

    act(() => void vi.advanceTimersByTime(2199));
    expect(card()).not.toBeNull();
    expect(modalOpen()).toBe(true);

    act(() => void vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
    expect(modalOpen()).toBe(false);
  });

  it("a second apply (a swap) inside the window restarts the 2.2 s clock for the NEW offer", () => {
    vi.useFakeTimers();
    const swapped = { ...FLAT_OFFER, _id: "offer-flat-3", name: "£3 off your order" };
    renderCard();
    customerApply();
    act(() => void vi.advanceTimersByTime(1500));

    act(() => {
      store.dispatch(swapCartOffer({ next: swapped, source: "offer" }));
      store.dispatch(openOfferModal({ id: swapped._id, name: swapped.name }));
    });
    // 2500 ms after the FIRST apply: the first clock would have closed it.
    act(() => void vi.advanceTimersByTime(1000));
    expect(within(card() as HTMLElement).getByText("£3 off your order")).toBeInTheDocument();
    expect(modalOpen()).toBe(true);

    act(() => void vi.advanceTimersByTime(1199)); // 2199 ms after the swap
    expect(card()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
    expect(modalOpen()).toBe(false);
  });

  it("unmount before 2200 ms: the cleanup closes the modal ONCE and the timer is cleared (no late dispatch)", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(store, "dispatch");
    const view = renderCard();
    customerApply();
    act(() => void vi.advanceTimersByTime(1000));
    spy.mockClear();

    view.unmount();
    expect(closeCount(spy)).toBe(1);
    expect(modalOpen()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    act(() => void vi.advanceTimersByTime(5000));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("emptyCart closes it", () => {
    renderCard();
    customerApply();
    act(() => void store.dispatch(emptyCart()));
    expect(card()).toBeNull();
    expect(modalOpen()).toBe(false);
  });

  it("a Remove inside the window hides it at once — never 'Reward applied!' over 'Reward removed'", () => {
    renderCard();
    customerApply();
    act(() => void store.dispatch(removeCartOffer()));
    expect(card()).toBeNull();
  });

  it("StrictMode does not close it early: the mount-time double effects run before any apply", () => {
    vi.useFakeTimers();
    renderCard(2, true);
    customerApply();

    expect(card()).not.toBeNull();
    expect(modalOpen()).toBe(true);
    act(() => void vi.advanceTimersByTime(2199));
    expect(card()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(card()).toBeNull();
  });

  it("a throwing child renders nothing (local ErrorBoundary) while the bag survives", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <BagSheet open onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );
    // A non-renderable name makes the card itself throw mid-render.
    customerApply({ not: "a string" });

    expect(card()).toBeNull();
    expect(screen.getByTestId("bag-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("bag-rewards-applied")).toHaveTextContent("£2 off your order");
    expect(screen.getByTestId("bag-pay")).toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({ recovery_path: "local_fallback" })
    );
    errorSpy.mockRestore();
  });
});
