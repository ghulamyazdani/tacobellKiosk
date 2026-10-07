import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import {
  selectErrorMessage,
  selectShowErrorModal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import usePayAtCounter from "../../paymentsHooks/usePayAtCounter";
import useOrderHook from "../useOrderHook";

/*
  useOrderHook's order tail with the REAL payload builder; only the two RTK
  place triggers are stubbed (they record the body they would send).
  - P8b-09 recordOrderLocally: the Paytm success tail — the BACKEND placed
    the order, so it is bookkeeping only: never a place call, never the
    error modal, whatever payment.paymentType says.
  - pushOrder is unchanged for COD, and its Paytm branch places NOTHING —
    which is why usePayAtCounter's directOrder clears a stale Paytm type
    (P8b-11): the zero-bill loyalty order must take the pushOnlineOrder path.
*/

const h = vi.hoisted(() => ({
  placeOrder: vi.fn<(body: unknown) => Promise<unknown>>(),
  placeByBackend: vi.fn<(body: unknown) => Promise<unknown>>(),
  navigate: vi.fn(),
}));

vi.mock("@cx-sdk/ordering/services/orderApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePushOnlineOrderMutation: () => [(body: unknown) => ({ unwrap: () => h.placeOrder(body) })],
  usePlaceByBackendOrderingMutation: () => [(body: unknown) => ({ unwrap: () => h.placeByBackend(body) })],
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));

interface Slices {
  payment: { paymentType: string };
  order: { currentOrder: Record<string, unknown>; ongoingOrders: unknown[] };
  loyalty: { claimedCoupon: { isClaimed: boolean } };
}
const st = () => store.getState() as unknown as Slices;
interface PlacedBody {
  payments: { type: string };
  originalPayments?: unknown;
  source: { order_id: string };
}
const placed = (call = 0) => h.placeOrder.mock.calls[call]?.[0] as PlacedBody;

const CW = { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 9, price: 9 };
const REWARD = { id: "rw", itemId: "lr-1", name: "Salad", quantity: 1, type: "ITEM", isLoyaltyItem: true, total_price: 0, price: 0 };
const CLAIMED = { couponCode: "RW-1", datetime: "2026-10-06", claimedPoints: 50 };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter>{children}</MemoryRouter>
  </Provider>
);
const orderHook = () => renderHook(() => useOrderHook(), { wrapper }).result;

beforeEach(() => {
  h.placeOrder.mockReset();
  h.placeOrder.mockResolvedValue({ status: "success" });
  h.placeByBackend.mockReset();
  h.navigate.mockReset();
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCartItems([CW]));
  store.dispatch(setAmount(9));
  store.dispatch(setClaimedCoupon(CLAIMED));
});

describe("recordOrderLocally — the Paytm success tail (P8b-09)", () => {
  it.each(["PaytmEdc", "PaytmDynamicQr", "", "PAY_AT_RESTAURANT"])(
    "payment type %j: NO place call, the current order is recorded, the claim is consumed",
    async (type) => {
      store.dispatch(setKioskPaymentType({ type }));
      const result = orderHook();

      await act(async () => {
        await result.current.recordOrderLocally("PAYTM-ORDER-1", false, 0);
      });

      expect(h.placeOrder).not.toHaveBeenCalled();
      expect(h.placeByBackend).not.toHaveBeenCalled();
      // useIncomingNetAmount=false: the bag's own net amount, not the 0 passed in.
      expect(st().order.currentOrder).toMatchObject({ orderId: "PAYTM-ORDER-1", orderStatus: "PENDING", netAmount: 9 });
      expect(st().order.ongoingOrders).toHaveLength(1);
      expect(st().loyalty.claimedCoupon.isClaimed).toBe(false);
      expect(selectShowErrorModal(store.getState())).toBe(false);
    },
  );
});

describe("pushOrder — unchanged for COD", () => {
  it("PAY_AT_RESTAURANT: ONE place call (payments.type COD), then the same bookkeeping", async () => {
    store.dispatch(setKioskPaymentType({ type: "PAY_AT_RESTAURANT" }));
    const result = orderHook();

    await act(async () => {
      await result.current.pushOrder("COD-1", true, 9);
    });

    expect(h.placeOrder).toHaveBeenCalledTimes(1);
    expect(placed().payments.type).toBe("COD");
    expect(placed().originalPayments).toBeUndefined();
    expect(placed().source.order_id).toBe("COD-1");
    expect(h.placeByBackend).not.toHaveBeenCalled();
    expect(st().order.currentOrder).toMatchObject({ orderId: "COD-1", orderStatus: "PENDING" });
    expect(st().loyalty.claimedCoupon.isClaimed).toBe(false);
  });

  it("a failed COD place: the error modal and a rethrow — nothing recorded, the claim kept", async () => {
    store.dispatch(setKioskPaymentType({ type: "PAY_AT_RESTAURANT" }));
    h.placeOrder.mockRejectedValue({ status: 500, data: {} });
    const result = orderHook();

    await act(async () => {
      await expect(result.current.pushOrder("COD-2", true, 9)).rejects.toThrow();
    });

    expect(selectShowErrorModal(store.getState())).toBe(true);
    expect(selectErrorMessage(store.getState())).toBe("Order not placed, please try again");
    expect(st().order.ongoingOrders).toHaveLength(0);
    expect(st().loyalty.claimedCoupon.isClaimed).toBe(true);
  });

  it("a Paytm type places NOTHING (the backend already did) — the hazard directOrder guards against", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    const result = orderHook();

    await act(async () => {
      await result.current.pushOrder("X-1", true, 0);
    });

    expect(h.placeOrder).not.toHaveBeenCalled();
    expect(h.placeByBackend).not.toHaveBeenCalled();
  });
});

describe("usePayAtCounter directOrder after an abandoned Paytm arm (P8b-11)", () => {
  it.each(["PaytmEdc", "PaytmDynamicQr"])(
    "a stale %s is cleared: the zero-bill order takes pushOnlineOrder — ONLINE, no originalPayments",
    async (stale) => {
      store.dispatch(setCartItems([REWARD]));
      store.dispatch(setAmount(0));
      store.dispatch(setKioskPaymentType({ type: stale }));
      const { result } = renderHook(() => usePayAtCounter(), { wrapper });

      act(() => result.current.start({ mode: "directOrder" }));
      expect(st().payment.paymentType).toBe("");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // the 0 ms buffer hop
        for (let i = 0; i < 12; i += 1) await Promise.resolve(); // the push's promise chain
      });

      expect(h.placeOrder).toHaveBeenCalledTimes(1);
      expect(placed().payments.type).toBe("ONLINE");
      expect(placed().originalPayments).toBeUndefined();
      expect(h.placeByBackend).not.toHaveBeenCalled();
      expect(result.current.status).toBe("placed");
      expect(h.navigate).toHaveBeenCalledWith("/orderSuccess", { state: { receipt: "none" } });
    },
  );
});
