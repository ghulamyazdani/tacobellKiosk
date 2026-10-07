import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import { setBillPaymentInfo, setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { store } from "../../../redux/app/store";
import { reloadTo } from "../../../utils/chunkRecovery";
import usePaytmSessionRelease from "../usePaytmSessionRelease";

/*
  P8b-12 × chunkRecovery — no reload cuts the splash's Paytm session release:
  its one EDC void is never retried, and the reset right after it has
  already wiped the session from disk. A reload asked mid-release (the
  splash's whole-app update, chunk recovery, crash recovery) waits for it.
  Its own file: the reload hold is module state, and usePaytmSessionRelease
  .test's hung release would hold it for the 20 s cap.
*/

const h = vi.hoisted(() => ({
  calls: [] as string[],
  replies: {} as Record<string, () => Promise<unknown>>,
}));

vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => {
  const trigger = (endpoint: string) => () => {
    h.calls.push(endpoint);
    return h.replies[endpoint]();
  };
  const edc = [trigger("edcStatus")];
  const cancel = [trigger("edcVoid")];
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useCheckPaytmEdcKioskStatusMutation: () => edc,
    useCancelPaytmEdcKioskMutation: () => cancel,
  };
});

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePaytmSessionRelease × reloads", () => {
  it("a reload asked mid-release waits until the void has answered, then runs once", async () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { replace });
    store.dispatch(
      setPaymentSettings([
        {
          _id: "pay_edc",
          setting_label: "PaytmEdc",
          value: [
            { id: "activate", value: true },
            { id: "paytm_device_id", value: "EDC-DEVICE-1" },
          ],
        },
      ]),
    );
    store.dispatch(setAutenticationDetails({ deploymentDetails: { _id: "dep1" }, licenseDetails: {} }));
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: "1700000000123", posBillTime: 1_700_000_000_000 }));
    const status = deferred();
    const cancel = deferred();
    h.replies.edcStatus = () => status.promise;
    h.replies.edcVoid = () => cancel.promise;

    const { result } = renderHook(() => usePaytmSessionRelease(), {
      wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
    });
    result.current();
    reloadTo("/start");
    await flush();
    expect(h.calls).toEqual(["edcStatus"]);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => status.resolve({ data: { status: "pending" } }));
    await flush();
    expect(h.calls).toEqual(["edcStatus", "edcVoid"]);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => cancel.resolve({ data: { success: true } }));
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/start");
  });
});
