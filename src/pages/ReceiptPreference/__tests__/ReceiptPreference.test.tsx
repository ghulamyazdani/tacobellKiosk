import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { toggleAccessibilityMode } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
import ReceiptPreferenceScreen from "../index";
import i18n from "../../../i18n";

/*
  P9b R4 (U2) at the screen: /receipt runs the REAL usePayAtCounter; only
  useOrderHook (its network edge) and useNavigate are mocked. pushOrder
  rejects the way the real one rethrows an RTK error — Error(err, { cause }).
  A push that TIMED OUT may have reached the restaurant, so the order-error
  panel must not say it didn't.
*/

const { mockPushOrder, mockNavigate } = vi.hoisted(() => ({
  mockPushOrder: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("../../../hooks/menuHooks/useOrderHook", () => ({
  default: () => ({
    pushOrder: (...args: unknown[]) => mockPushOrder(...args),
    generateQROrderId: () => Promise.resolve("TB-ORDER-ABCDE12345"),
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

const TIMED_OUT = { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" };
const SERVER_ERROR = { status: 500, data: { message: "placeOrder failed" } };
/** useOrderHook.pushOrder's rethrow. */
const rejectWith = (rtkError: unknown) => () =>
  Promise.reject(new Error("[object Object]", { cause: rtkError }));

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/receipt"]}>
        <ReceiptPreferenceScreen />
      </MemoryRouter>
    </Provider>
  );

/** Move the fake clock; each step renders before the next (the hook's effects re-arm on render). */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Tap "no receipt" and run what is due now: the 0 ms buffer hop, then the push. */
const placeOrder = async () => {
  fireEvent.click(screen.getByTestId("receipt-none"));
  await advance(0);
  await advance(0);
};

const panel = () => screen.getByTestId("order-error");

describe("/receipt order-error panel after a failed push (P9b R4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPushOrder.mockReset();
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setCartItems([
        { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 5 },
      ])
    );
    store.dispatch(setAmount(5));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("a TIMED-OUT push: ONE attempt and the UNCERTAIN copy — never 'didn't reach the restaurant'", async () => {
    mockPushOrder.mockImplementation(rejectWith(TIMED_OUT));
    mount();
    await placeOrder();
    await advance(60_000);

    expect(mockPushOrder).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.uncertainTitle"),
        description: i18n.t("orderError.uncertainMessage"),
      })
    ).toBe(panel());
    expect(panel()).toHaveTextContent(i18n.t("orderError.uncertainTitle"));
    expect(panel()).toHaveTextContent(i18n.t("orderError.uncertainMessage"));
    expect(panel()).not.toHaveTextContent(i18n.t("orderError.message"));
    expect(panel()).not.toHaveTextContent(/didn't reach the restaurant/i);
  });

  it("an exhausted clean ladder keeps the ordinary copy (the order provably never landed)", async () => {
    mockPushOrder.mockImplementation(rejectWith(SERVER_ERROR));
    mount();
    await placeOrder();
    await advance(1_000);
    await advance(2_000);
    await advance(3_000);

    expect(mockPushOrder).toHaveBeenCalledTimes(4);
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.title"),
        description: i18n.t("orderError.message"),
      })
    ).toBe(panel());
    expect(panel()).toHaveTextContent(i18n.t("orderError.title"));
    expect(panel()).toHaveTextContent(i18n.t("orderError.message"));
    expect(panel()).not.toHaveTextContent(i18n.t("orderError.uncertainTitle"));
  });

  it("Retry after a timeout resends the SAME order id and lands on /orderSuccess", async () => {
    mockPushOrder.mockImplementationOnce(rejectWith(TIMED_OUT));
    mount();
    await placeOrder();

    mockPushOrder.mockResolvedValueOnce({});
    fireEvent.click(screen.getByTestId("order-error-retry"));
    await advance(0);

    expect(mockPushOrder).toHaveBeenCalledTimes(2);
    expect(mockPushOrder.mock.calls[1][0]).toBe(mockPushOrder.mock.calls[0][0]);
    expect(mockPushOrder.mock.calls[1][0]).toBe("TB-ORDER-ABCDE12345");
    expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
      state: { receipt: "none" },
    });
  });

  it("Back to bag leaves for /cart and sends nothing more", async () => {
    mockPushOrder.mockImplementation(rejectWith(TIMED_OUT));
    mount();
    await placeOrder();

    fireEvent.click(screen.getByTestId("order-error-back"));

    expect(mockNavigate).toHaveBeenCalledWith("/cart");
    expect(mockPushOrder).toHaveBeenCalledTimes(1);
  });

  it("the uncertain copy is translated (AR)", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mockPushOrder.mockImplementation(rejectWith(TIMED_OUT));
    mount();
    await placeOrder();

    // Key-driven (P9f: AR copy renders inside FSI…PDI isolates).
    const title = i18n.t("orderError.uncertainTitle");
    expect(title).toMatch(/\p{Script=Arabic}/u);
    expect(screen.getByRole("alertdialog", { name: title })).toBe(panel());
  });
});

/*
  Lane figma-polish S4 #3/#4 (1:3377 / 1:3382): the headline is Title/H2
  (Exp Bl 64/54.4, −3) in the 856 px block (top 666 unchanged), the two CTA
  Cards are the frame's 416 × 416, and the bell sits at 128. ADA keeps its
  P9c tops (title 120, tiles 292) and drops the bell.
*/
describe("/receipt — the Figma geometry (S4)", () => {
  const headline = () => screen.getByRole("heading", { level: 1 });
  const H2 = ["text-[64px]", "leading-[54.4px]", "tracking-[-3px]", "w-[856px]"];

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setCartItems([
        { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 5 },
      ])
    );
    store.dispatch(setAmount(5));
  });

  it("the headline is Title/H2 in the 856 px block at 666; both tiles are 416 × 416 at 838; the bell at 128", () => {
    mount();

    expect(headline()).toHaveTextContent(i18n.t("receipt.title"));
    expect(headline()).toHaveClass(...H2, "top-[666px]");
    expect(headline().className).not.toMatch(/text-\[58px\]|w-\[880px\]/);
    for (const id of ["receipt-print", "receipt-email"]) {
      expect(screen.getByTestId(id)).toHaveClass("h-[416px]", "w-[416px]");
    }
    expect(screen.getByTestId("receipt-print").parentElement).toHaveClass("top-[838px]", "gap-[24px]");
    expect(screen.getByAltText("Taco Bell")).toHaveClass("top-[128px]");
  });

  it("ADA keeps its tops (title 120, tiles 292) with the same 416 tiles, and drops the bell", () => {
    store.dispatch(toggleAccessibilityMode());
    mount();

    expect(headline()).toHaveClass(...H2, "top-[120px]");
    expect(screen.getByTestId("receipt-print").parentElement).toHaveClass("top-[292px]");
    expect(screen.getByTestId("receipt-print")).toHaveClass("h-[416px]", "w-[416px]");
    expect(screen.queryByAltText("Taco Bell")).not.toBeInTheDocument();
  });
});

/*
  Lane motion (§2.3 / §2.7). The root's data-enter is latched at mount: none
  on a page load (POP), fwd on a PUSH, back on a PUSH to a screen already on
  the session trail (AppRoutes' notePath; seeded here). Only the title and
  the tile row carry tb-enter [--i]; BACK, the bell and NONE never move.
*/
describe("/receipt — the route entrance (lane motion)", () => {
  /** A PUSH from another route: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/receipt" />} />
            <Route path="/receipt" element={<ReceiptPreferenceScreen />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("receipt-screen");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setCartItems([
        { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 5 },
      ])
    );
    store.dispatch(setAmount(5));
    notePath("/start");
  });

  it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /receipt arrives back", () => {
    const pop = mount();
    expect(root()).not.toHaveAttribute("data-enter");
    pop.unmount();

    const pushed = mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
    pushed.unmount();

    notePath("/receipt");
    notePath("/paymentPolling");
    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "back");
  });

  it("tb-enter [--i] on the title (0) and the tile row (1) — never BACK, the bell or NONE", () => {
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1"]);
    expect(blocks[0]).toBe(screen.getByRole("heading", { level: 1 }));
    expect(blocks[1]).toContainElement(screen.getByTestId("receipt-print"));
    for (const element of [screen.getByTestId("receipt-back"), screen.getByAltText("Taco Bell"), screen.getByTestId("receipt-none")]) {
      expect(element.closest(".tb-enter")).toBeNull();
    }
  });
});
