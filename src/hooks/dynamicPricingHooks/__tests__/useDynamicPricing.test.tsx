import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { KioskEventName } from "@cx-sdk/core";
import { store } from "../../../redux/app/store";
import useDynamicPricing from "../useDynamicPricing";

/*
  audit-fixes C5 — a failed dynamic-pricing fetch still resolves undefined
  (the menu carries on at base prices), but it changes what the guest pays,
  so it is reported as ErrorOccurred instead of a console line. Mocked at the
  RTK layer (useLoyalty.test precedent) so the real hook runs.
*/

const transport = vi.hoisted(() => ({
  getDpSessions: vi.fn(),
  getDpItems: vi.fn(),
  getServerTime: vi.fn(),
}));

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("@cx-sdk/catalog/services/dynamicPricingApi", () => ({
  useGetDpSessionsMutation: () => [transport.getDpSessions],
  useGetDpItemsMutation: () => [transport.getDpItems],
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", () => ({
  useLazyGetServerTimeQuery: () => [transport.getServerTime],
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

/** RTK's lazy query result: `.unwrap()` resolves the body or rejects. */
const serverTime = (outcome: Promise<unknown>) => ({ unwrap: () => outcome });

const dpReports = () =>
  mockCapture.mock.calls.filter(
    ([event, props]) =>
      event === KioskEventName.ErrorOccurred &&
      (props as { error_source?: string })?.error_source === "dynamic_pricing"
  );

describe("useDynamicPricing — failures are reported, never thrown (audit-fixes C5)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mockCapture.mockReset();
    transport.getDpSessions.mockReset();
    transport.getDpItems.mockReset();
    transport.getServerTime.mockReset();
  });

  it("sessions: a failed server-time read resolves undefined and reports stage 'sessions'", async () => {
    transport.getDpSessions.mockResolvedValue({ data: [{ _id: "s1" }] });
    transport.getServerTime.mockReturnValue(serverTime(Promise.reject(new Error("server time unavailable"))));
    const { result } = renderHook(() => useDynamicPricing(), { wrapper });

    let sessions: unknown = "unset";
    await act(async () => {
      sessions = await result.current.fetchDpSessions();
    });

    expect(sessions).toBeUndefined();
    expect(dpReports()).toEqual([
      [
        KioskEventName.ErrorOccurred,
        { error_source: "dynamic_pricing", stage: "sessions", error_message: "server time unavailable" },
      ],
    ]);
  });

  it("items: a failed items request resolves undefined and reports stage 'items'", async () => {
    transport.getDpItems.mockRejectedValue(new Error("dp items down"));
    const { result } = renderHook(() => useDynamicPricing(), { wrapper });

    let items: unknown = "unset";
    await act(async () => {
      items = await result.current.fetchDpItems("pipeline-1", [{ _id: "s1" }]);
    });

    expect(items).toBeUndefined();
    expect(transport.getDpItems).toHaveBeenCalledWith({
      session_id: "s1",
      app: "kiosk",
      pipeline_id: "pipeline-1",
    });
    expect(dpReports()).toEqual([
      [
        KioskEventName.ErrorOccurred,
        { error_source: "dynamic_pricing", stage: "items", error_message: "dp items down" },
      ],
    ]);
  });

  it("the paths that succeed report nothing (no session: an empty map; one session: its prices)", async () => {
    transport.getDpSessions.mockResolvedValue({ data: [] });
    transport.getServerTime.mockReturnValue(serverTime(Promise.resolve({ serverTime: "2026-10-08T10:00:00Z" })));
    transport.getDpItems.mockResolvedValue({
      data: [{ baseItemId: "item-1", session: { modifiedRate: 7 } }],
    });
    const { result } = renderHook(() => useDynamicPricing(), { wrapper });

    let empty: unknown;
    let priced: unknown;
    await act(async () => {
      await result.current.fetchDpSessions();
      empty = await result.current.fetchDpItems("pipeline-1", []);
      priced = await result.current.fetchDpItems("pipeline-1", [{ _id: "s1" }]);
    });

    expect(empty).toEqual({});
    expect(priced).toEqual({ "item-1": { modifiedRate: 7 } });
    expect(dpReports()).toEqual([]);
  });
});
