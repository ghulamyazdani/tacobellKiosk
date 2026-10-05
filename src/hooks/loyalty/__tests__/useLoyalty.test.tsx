import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  resetLoyaltySession,
  setClaimedCoupon,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../utils/useIdleTimeout";
import useLoyalty from "../useLoyalty";
import "../../../i18n";

/*
  P9a: the two idle-facing edges of the shared loyalty hook.
  - It holds idle while a loyalty call is in flight (D5 — at the SHARED hook,
    so /phone, the login modal and the rewards sheet are all covered).
  - A check_loyalty_balance lookup that resolves after the asking screen
    unmounted writes NOTHING and returns undefined: RTK's unmount reset does
    not abort, so the late {data} would otherwise land in whoever is at the
    kiosk by then (Rule 3).
  Mocked at the RTK layer (LoyaltyLoginModal.test precedent) so the real hook
  runs; `isLoading` is driven by the test.
*/

const transport = vi.hoisted(() => ({
  executeEvent: vi.fn(),
  isLoading: false,
}));

const mockCapture = vi.hoisted(() => vi.fn());

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("@cx-sdk/ordering/services/loyaltyApi", () => ({
  useExecuteLoyaltyEventMutation: () => [
    transport.executeEvent,
    { isLoading: transport.isLoading, reset: () => {} },
  ],
  useGetLoyaltyPartnerMutation: () => [vi.fn(), { isLoading: false }],
}));

const PARTNER = {
  partner: {
    partner_name: "Xeno",
    customer_key: "xeno-customer-key-1",
    partner_merchant_id: "xeno-merchant-uuid-1",
  },
  partnerDetails: { client_id: "xeno-client-1", partner_name: "Xeno" },
};

/** check_loyalty_balance, as the RTK trigger resolves it. */
const BALANCE = {
  data: {
    status_code: 200,
    response: {
      coupons: [{ coupon_code: "static6562", products: [] }],
      loyalty_points: 3000,
      total_redeemable_points: 3000,
      min_bill_for_redemption: 0,
    },
  },
};

const hold = vi.fn<(delta: 1 | -1) => void>();

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter>
      <IdleHoldContext.Provider value={hold}>{children}</IdleHoldContext.Provider>
    </MemoryRouter>
  </Provider>
);

const loyalty = () =>
  (store.getState() as { loyalty: { totalLoyaltyPoints: number; coupons: unknown[] } })
    .loyalty;

/** A lookup whose network answer the test releases by hand. */
const startLookup = (api: ReturnType<typeof useLoyalty>) => {
  let answer!: (value: typeof BALANCE) => void;
  transport.executeEvent.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  let result!: Promise<unknown>;
  act(() => {
    result = api.executeLoyalty({ phoneNumber: "9953833675", countryCode: "+91" });
  });
  return { answer, result };
};

describe("useLoyalty — idle-facing edges (P9a)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setLoyaltyPartner(PARTNER));
    // A loaded menu, as on /phone (the reward join walks its categories).
    store.dispatch(setMenuData({ menu: { categories: [] } }));
    transport.executeEvent.mockReset();
    transport.isLoading = false;
    hold.mockReset();
  });

  it("holds idle exactly while a loyalty call is in flight", () => {
    const { rerender } = renderHook(() => useLoyalty(), { wrapper });
    expect(hold).not.toHaveBeenCalled();

    transport.isLoading = true;
    rerender();
    expect(hold.mock.calls).toEqual([[1]]);

    transport.isLoading = false;
    rerender();
    expect(hold.mock.calls).toEqual([[1], [-1]]);
  });

  it("a lookup answered while the screen is up writes the balance and returns it", async () => {
    const { result } = renderHook(() => useLoyalty(), { wrapper });
    const lookup = startLookup(result.current);

    await act(async () => {
      lookup.answer(BALANCE);
      await lookup.result;
    });

    await expect(lookup.result).resolves.toEqual(BALANCE.data);
    expect(loyalty().totalLoyaltyPoints).toBe(3000);
    expect(loyalty().coupons).toHaveLength(1);
  });

  it("a lookup answered AFTER the screen unmounted writes nothing and returns undefined", async () => {
    const { result, unmount } = renderHook(() => useLoyalty(), { wrapper });
    const lookup = startLookup(result.current);

    // The customer left (Back / Skip / Cancel / idle) mid-lookup.
    unmount();
    await act(async () => {
      lookup.answer(BALANCE);
      await lookup.result;
    });

    // undefined, not the body: callers then take their no-lookup path, so
    // nothing can open the rewards sheet for the next customer either.
    await expect(lookup.result).resolves.toBeUndefined();
    expect(loyalty().totalLoyaltyPoints).toBe(0);
    expect(loyalty().coupons).toEqual([]);
  });
});

/*
  P9b R1 — redeem_coupon over a failed transport. RTK resolves a failed
  mutation trigger as `{ error }` with NO `data`; wrapping infoForClaim
  around that nothing used to read as a SUCCESS downstream (free reward row +
  claim + points deducted with no Xeno confirmation).
*/
describe("useLoyalty.finalLoyaltyRedemption — a transport failure is never a redemption (P9b R1)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setLoyaltyPartner(PARTNER));
    transport.executeEvent.mockReset();
    transport.isLoading = false;
  });

  it.each([
    ["a timeout", { error: { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" } }],
    [
      "a body that ran past the budget",
      {
        error: {
          status: "PARSING_ERROR",
          originalStatus: 200,
          data: "",
          error: "TimeoutError: signal timed out",
        },
      },
    ],
    ["a network failure", { error: { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" } }],
    ["an HTTP 502", { error: { status: 502, data: "Bad Gateway" } }],
  ])("%s → undefined (no infoForClaim to claim with)", async (_label, rtkResult) => {
    transport.executeEvent.mockResolvedValue(rtkResult);
    const { result } = renderHook(() => useLoyalty(), { wrapper });

    let redemption: unknown = "unset";
    await act(async () => {
      redemption = await result.current.finalLoyaltyRedemption("static6562", "1234");
    });

    expect(redemption).toBeUndefined();
    expect(transport.executeEvent).toHaveBeenCalledTimes(1);
    expect(transport.executeEvent.mock.calls[0][0].event_name).toBe("redeem_coupon");
  });

  it("an answered redemption keeps the partner body and gains the claim ledger (unchanged path)", async () => {
    const body = { status_code: 200, response: { success: true, points_redeemed: 3000 } };
    transport.executeEvent.mockResolvedValue({ data: body });
    const { result } = renderHook(() => useLoyalty(), { wrapper });

    let redemption: Record<string, unknown> | undefined;
    await act(async () => {
      redemption = await result.current.finalLoyaltyRedemption("static6562", "1234");
    });

    expect(redemption).toMatchObject(body);
    expect(redemption?.infoForClaim).toMatchObject({
      coupon_code: "static6562",
      merchant_id: "xeno-merchant-uuid-1",
      otp: "1234",
      datetime: expect.any(String),
    });
  });
});

/*
  P9b R5 — the Xeno undo (undoRewardRedemption). A raw cross-origin GET kept
  off the kiosk transport (its credentials must not go to a third party), now
  bounded by AbortSignal.timeout(10 s) and NEVER retried: it carries a
  client-supplied points amount and is not known to be idempotent. On any
  failure the claim is kept (fork parity) and the caller — always
  fire-and-forget — gets no rejection. Fake clocks cannot drive
  AbortSignal.timeout, so the bound is a spy that hands back a signal the test
  aborts with the reason a real timeout carries.
*/
describe("useLoyalty.checkAndRevokeLoyaltyReward — bounded, never retried, never throws (P9b R5)", () => {
  /** The ledger the revoke reads (BagSheetLoyalty fixture). */
  const CLAIMED = {
    couponCode: "static6562",
    claimedPoints: 3000,
    availedCouponCode: "static6562",
    datetime: "2026-09-30%2010%3A00%3A00",
    phoneNumber: "9953833675",
    merchantId: "xeno-merchant-uuid-1",
  };

  const fetchMock = vi.fn();
  let bound: AbortController;
  const timeoutSpy = vi.fn();

  const isClaimed = () =>
    (store.getState() as { loyalty: { claimedCoupon: { isClaimed: boolean } } })
      .loyalty.claimedCoupon.isClaimed;

  /** A Xeno that never answers; rejects once the request's signal aborts. */
  const hangUntilAborted = (_url: string, init: RequestInit) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    });

  /** What a real AbortSignal.timeout(10 s) aborts with when it fires. */
  const fireTheBound = () =>
    act(() => {
      bound.abort(new DOMException("signal timed out", "TimeoutError"));
    });

  const revokeEvents = () =>
    mockCapture.mock.calls
      .map(([, props]) => props as Record<string, unknown> | undefined)
      .filter((props) => props?.source === "xeno_revoke");

  const renderClaimed = () => {
    store.dispatch(setClaimedCoupon(CLAIMED));
    return renderHook(() => useLoyalty(), { wrapper });
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setLoyaltyPartner(PARTNER));
    mockCapture.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ status: "success" }) });
    vi.stubGlobal("fetch", fetchMock);
    bound = new AbortController();
    timeoutSpy.mockReset();
    timeoutSpy.mockImplementation(() => bound.signal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(timeoutSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a revoke that lands: ONE GET to xeno.in on a 10 s signal, then the claim is cleared", async () => {
    const { result } = renderClaimed();

    await act(async () => {
      await result.current.checkAndRevokeLoyaltyReward();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://xeno.in:2223/api/xeno/loyalty/undoRewardRedemption?");
    expect(url).toContain("pointsToBeReturned=3000");
    expect(init.method).toBe("GET");
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(init.signal).toBe(bound.signal);
    expect(isClaimed()).toBe(false);
    expect(revokeEvents()).toEqual([]);
  });

  it("a hung Xeno is cut at the bound: resolves (never throws), keeps the claim, and is NOT re-sent", async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    const { result } = renderClaimed();

    let revoke!: Promise<void>;
    act(() => {
      revoke = result.current.checkAndRevokeLoyaltyReward();
    });
    await fireTheBound();

    await expect(revoke).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isClaimed()).toBe(true);
  });

  it("the timeout is reported with the claim ids to reconcile — never the phone or the apikey", async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    const { result } = renderClaimed();

    let revoke!: Promise<void>;
    act(() => {
      revoke = result.current.checkAndRevokeLoyaltyReward();
    });
    await fireTheBound();
    await act(async () => {
      await revoke;
    });

    expect(revokeEvents()).toEqual([
      {
        source: "xeno_revoke",
        timed_out: true,
        reward_id: "static6562",
        claim_datetime: CLAIMED.datetime,
        points: 3000,
      },
    ]);
    const sent = JSON.stringify(mockCapture.mock.calls);
    expect(sent).not.toContain(CLAIMED.phoneNumber);
    expect(sent).not.toContain(CLAIMED.merchantId);
  });

  it.each([
    ["xeno.in unreachable", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "a non-JSON answer",
      () => Promise.resolve({ json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
    ],
  ])("%s: claim kept, reported as not-a-timeout, nothing thrown", async (_label, impl) => {
    fetchMock.mockImplementation(impl);
    const { result } = renderClaimed();

    await act(async () => {
      await expect(result.current.checkAndRevokeLoyaltyReward()).resolves.toBeUndefined();
    });

    expect(isClaimed()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(revokeEvents()).toEqual([
      expect.objectContaining({ source: "xeno_revoke", timed_out: false }),
    ]);
  });

  it("one undo in flight per claim, across hook instances (bag auto-reversal + Cancel order): the second sends nothing", async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    const bag = renderClaimed();
    const cancel = renderHook(() => useLoyalty(), { wrapper });

    let first!: Promise<void>;
    act(() => {
      first = bag.result.current.checkAndRevokeLoyaltyReward();
    });
    await act(async () => {
      await cancel.result.current.checkAndRevokeLoyaltyReward();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The first one settles (timed out, claim kept): the latch is released,
    // so a LATER teardown may try again — one request at a time, never two.
    await fireTheBound();
    await act(async () => {
      await first;
    });
    bound = new AbortController();
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ status: "success" }) });
    await act(async () => {
      await cancel.result.current.checkAndRevokeLoyaltyReward();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isClaimed()).toBe(false);
  });

  /*
    P9d S7 (user decision 2026-10-01): usePayAtCounter MARKS a claim whose
    order's push ended outcome-unknown — that order, reward included, may
    exist. Such a claim is never auto-refunded: no undo, one
    xeno_revoke_skipped event with the non-PII ids for staff, and the claim
    is dropped so no later caller reports it again.
  */
  describe("a claim marked orderOutcomeUnknown (P9d S7)", () => {
    const MARKED = { ...CLAIMED, orderOutcomeUnknown: true };

    const skipEvents = () =>
      mockCapture.mock.calls
        .map(([, props]) => props as Record<string, unknown> | undefined)
        .filter((props) => props?.source === "xeno_revoke_skipped");

    const revokeOnce = async (api: ReturnType<typeof useLoyalty>) => {
      await act(async () => {
        await api.checkAndRevokeLoyaltyReward();
      });
    };

    it("S5: sends NO undo, reports the ids once (no phone, no apikey), drops the claim; a second call is a no-op", async () => {
      store.dispatch(setClaimedCoupon(MARKED));
      const { result } = renderHook(() => useLoyalty(), { wrapper });

      await revokeOnce(result.current);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(skipEvents()).toEqual([
        {
          source: "xeno_revoke_skipped",
          reason: "order_outcome_unknown",
          reward_id: "static6562",
          claim_datetime: CLAIMED.datetime,
          points: 3000,
        },
      ]);
      // Staff find it under error_occurred.
      expect(mockCapture).toHaveBeenCalledWith("error_occurred", skipEvents()[0]);
      const sent = JSON.stringify(mockCapture.mock.calls);
      expect(sent).not.toContain(CLAIMED.phoneNumber);
      expect(sent).not.toContain(CLAIMED.merchantId);
      expect(isClaimed()).toBe(false);

      await revokeOnce(result.current);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    it("S6: an unmarked claim still takes the real undo, and is not reported as skipped", async () => {
      const { result } = renderClaimed();

      await revokeOnce(result.current);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("undoRewardRedemption?");
      expect(skipEvents()).toEqual([]);
      expect(isClaimed()).toBe(false);
    });

    it("S7: the session reset drops the claim with its mark — nothing left to refund or report", async () => {
      store.dispatch(setClaimedCoupon(MARKED));
      store.dispatch(resetLoyaltySession());

      const { claimedCoupon } = (
        store.getState() as {
          loyalty: { claimedCoupon: { isClaimed: boolean; couponData: object } };
        }
      ).loyalty;
      expect(claimedCoupon.isClaimed).toBe(false);
      expect(claimedCoupon.couponData).not.toHaveProperty("orderOutcomeUnknown");

      const { result } = renderHook(() => useLoyalty(), { wrapper });
      await revokeOnce(result.current);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockCapture).not.toHaveBeenCalled();
    });
  });
});
