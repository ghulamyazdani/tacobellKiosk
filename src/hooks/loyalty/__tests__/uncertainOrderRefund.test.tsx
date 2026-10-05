import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { ORDER_PUSH_MAX_ATTEMPTS } from "@cx-sdk/payments/settlement/settlementRules";
import { store } from "../../../redux/app/store";
import usePayAtCounter from "../../paymentsHooks/usePayAtCounter";
import useLoyalty from "../useLoyalty";

/*
  P9d S7 end to end (user decision 2026-10-01: never auto-refund a Xeno
  reward whose order push ended outcome-unknown). The REAL usePayAtCounter
  pushes through the REAL useOrderHook.pushOrder — only its placeOrder RTK
  trigger is stubbed, so the rethrow the ladder classifies is the app's own
  — and /start's revoke is the REAL useLoyalty with only Xeno's fetch
  stubbed. Promoted from the pre-fix scratch check, updated for F1 (the
  reward row must be in the pushed cart) and F2 (order_push names the claim).
  The per-hook rules live in usePayAtCounter.test (S1–S4, S7) and
  useLoyalty.test (S5–S7); this file pins how they meet, and S8 — only the
  real pushOrder clears the claim on success.
*/

const mockCapture = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
/** placeOrder's RTK trigger: `pushOnlineOrder(body).unwrap()` settles like this. */
const placeOrder = vi.hoisted(() => vi.fn<(body: unknown) => Promise<unknown>>());

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("@cx-sdk/ordering/services/orderApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/ordering/services/orderApi")>()),
  usePushOnlineOrderMutation: () => [
    (body: unknown) => ({ unwrap: () => placeOrder(body) }),
  ],
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

/** BagSheetLoyalty's claim ledger and reward row, beside one paid row. */
const CLAIMED = {
  couponCode: "static6562",
  claimedPoints: 3000,
  availedCouponCode: "static6562",
  datetime: "2026-09-30%2010%3A00%3A00",
  phoneNumber: "9953833675",
  merchantId: "xeno-merchant-uuid-1",
};
const PAID_ROW = {
  id: "crunchwrap",
  itemId: "cw-1",
  name: "Crunchwrap Supreme",
  quantity: 1,
  type: "ITEM",
  price: 24.5,
  total_price: 24.5,
};
const REWARD_ROW = {
  id: "5dd1093829754a432f2c32e2",
  itemId: "lr-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  coupon_code: "static6562",
  price: 0,
  total_price: 0,
};
const RTK_TIMEOUT = { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" };
const RTK_500 = { status: 500, data: {} };

/** /receipt: the screen that owns the push. */
function Receipt() {
  const api = usePayAtCounter();
  return (
    <>
      <span data-testid="status">{api.status}</span>
      <button type="button" data-testid="confirm" onClick={() => api.confirmAndPush("none")}>
        confirm
      </button>
      <button type="button" data-testid="retry" onClick={() => api.retry()}>
        retry
      </button>
    </>
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter>{children}</MemoryRouter>
  </Provider>
);

const tap = (testId: string) => {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/** Run the zero buffer hop and the push's promise chain; the clock stays put. */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
};

const status = () => screen.getByTestId("status").textContent;

const claim = () =>
  (
    store.getState() as {
      loyalty: { claimedCoupon: { isClaimed: boolean; couponData: object } };
    }
  ).loyalty.claimedCoupon;

const eventsWhere = (key: string, value: string) =>
  mockCapture.mock.calls
    .map(([, props]) => props as Record<string, unknown> | undefined)
    .filter((props) => props?.[key] === value);

/** The order id each placeOrder request carried. */
const pushedOrderIds = () =>
  placeOrder.mock.calls.map(
    ([body]) => (body as { source: { order_id: string } }).source.order_id
  );

/** /start's teardown revoke — a fresh useLoyalty, as StartScreen mounts one. */
const revokeAtStart = async () => {
  const { result, unmount } = renderHook(() => useLoyalty(), { wrapper });
  await act(async () => {
    await result.current.checkAndRevokeLoyaltyReward();
  });
  unmount();
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCartItems([PAID_ROW, REWARD_ROW]));
  store.dispatch(setAmount(24.5));
  store.dispatch(setClaimedCoupon(CLAIMED));
  mockCapture.mockReset();
  mockNavigate.mockReset();
  placeOrder.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: () => Promise.resolve({ status: "success" }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a reward whose order may exist is never auto-refunded (P9d S7, end to end)", () => {
  it("timed-out push → claim marked → /start sends no undo, reports it once, clears it; a second caller no-ops", async () => {
    placeOrder.mockRejectedValue(RTK_TIMEOUT);
    const receipt = render(<Receipt />, { wrapper });
    tap("confirm");
    await settle();

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(status()).toBe("failed");
    expect(claim()).toEqual({
      isClaimed: true,
      couponData: { ...CLAIMED, orderOutcomeUnknown: true },
    });
    expect(eventsWhere("error_source", "order_push")).toEqual([
      expect.objectContaining({
        outcome_unknown: true,
        reward_id: "static6562",
        claim_datetime: CLAIMED.datetime,
        points: 3000,
      }),
    ]);

    receipt.unmount();
    await revokeAtStart();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(eventsWhere("source", "xeno_revoke_skipped")).toEqual([
      expect.objectContaining({ reason: "order_outcome_unknown", reward_id: "static6562" }),
    ]);
    expect(claim().isClaimed).toBe(false);

    await revokeAtStart();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(eventsWhere("source", "xeno_revoke_skipped")).toHaveLength(1);
  });

  it("S8: a successful Retry (same order id) clears the claim and its mark — nothing to refund or report", async () => {
    placeOrder
      .mockRejectedValueOnce(RTK_TIMEOUT)
      .mockResolvedValueOnce({ status: "success" });
    const receipt = render(<Receipt />, { wrapper });
    tap("confirm");
    await settle();
    expect(claim().couponData).toHaveProperty("orderOutcomeUnknown", true);

    tap("retry");
    await settle();

    expect(status()).toBe("placed");
    expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
      state: { receipt: "none" },
    });
    const [first, retried] = pushedOrderIds();
    expect(retried).toBe(first);
    expect(claim().isClaimed).toBe(false);
    expect(claim().couponData).not.toHaveProperty("orderOutcomeUnknown");

    receipt.unmount();
    await revokeAtStart();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(eventsWhere("source", "xeno_revoke_skipped")).toEqual([]);
  });

  it("a clean failure (5xx, ladder exhausted) leaves the claim unmarked — /start refunds it via the real undo", async () => {
    placeOrder.mockRejectedValue(RTK_500);
    const receipt = render(<Receipt />, { wrapper });
    tap("confirm");
    await settle();
    // Backoff 1 + 2 + 3 s between the four attempts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(placeOrder).toHaveBeenCalledTimes(ORDER_PUSH_MAX_ATTEMPTS);
    expect(new Set(pushedOrderIds()).size).toBe(1);
    expect(status()).toBe("failed");
    expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });

    receipt.unmount();
    await revokeAtStart();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("rewardId=static6562");
    expect(claim().isClaimed).toBe(false);
  });
});
