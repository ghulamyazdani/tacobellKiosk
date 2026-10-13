import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, NavigationType } from "react-router-dom";
import { KioskEventName } from "@cx-sdk/core";
import { setBillPaymentInfo, setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { store } from "../../redux/app/store";
import { AppRoutes } from "../AppRoutes";
import { notePath, pageEnterDirection } from "../../hooks/utils/usePageEnter";

/*
  CartRehydratedContext is the "the cart rows are real now" signal BagSheet's
  empty-cart exit waits for after a crash-reload on /cart. It must stay false
  while the Dexie rehydrate is in flight (an early true drops the customer's
  saved reward on the transient empty cart) and must settle true once the
  rehydrate is done, whether it resolved OR failed (Rule 2: a broken Dexie
  must not leave a stale reward on a bag that can never exit). Mutation
  verifier: "never true on a Dexie failure" survived every other test.
*/

const { syncCartOnReLoad } = vi.hoisted(() => ({
  syncCartOnReLoad: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../hooks/menuHooks/useCartHook", () => ({
  default: () => ({ syncCartOnReLoad }),
}));

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const rehydrateReports = () =>
  mockCapture.mock.calls.filter(
    ([event, props]) =>
      event === KioskEventName.ErrorOccurred &&
      (props as { error_source?: string })?.error_source === "dexie"
  );

// An unregistered device renders Registration at "/": probe the signal there.
vi.mock("../../pages/Registration", async () => {
  const { useCartRehydrated } = await import("../../hooks/utils/useCartRehydrated");
  return {
    default: function RehydratedProbe() {
      return <p data-testid="cart-rehydrated">{String(useCartRehydrated())}</p>;
    },
  };
});

// The resume-guard wiring block (last describe): the in-session chrome renders
// nothing, and the three Paytm screens are probes that report what mounted.
const { pageMounts, pageProbe } = vi.hoisted(() => {
  const mounts: string[] = [];
  return {
    pageMounts: mounts,
    pageProbe: (name: string) => ({
      default: function PageProbe() {
        mounts.push(name);
        return <p data-testid="page-probe">{name}</p>;
      },
    }),
  };
});
vi.mock("../IdleGuard", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <Outlet /> };
});
vi.mock("../../components/makeItAMeal/MakeItAMealPrompt", () => ({ default: () => null }));
vi.mock("../../components/cart/RepeatItemSheet", () => ({ default: () => null }));
vi.mock("../../components/menu/DetourTapGuard", () => ({ default: () => null }));
vi.mock("../../pages/PaymentSelection", () => pageProbe("payment"));
vi.mock("../../pages/ReceiptPreference", () => pageProbe("receipt"));
vi.mock("../PaytmPaymentRoute", () => pageProbe("polling"));

const renderAt = (path: string) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Provider>
  );
const renderRoutes = () => renderAt("/");

const signal = () => screen.getByTestId("cart-rehydrated");

describe("AppRoutes — the cart-rehydrated signal (crash-reload on /cart)", () => {
  beforeEach(() => {
    syncCartOnReLoad.mockReset();
    mockCapture.mockReset();
  });

  it("stays false while the Dexie rehydrate is in flight, turns true once it lands, and the rehydrate runs once", async () => {
    let land: () => void = () => {};
    syncCartOnReLoad.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        land = resolve;
      })
    );
    renderRoutes();
    expect(signal()).toHaveTextContent("false");
    await act(async () => {
      await Promise.resolve();
    });
    expect(signal()).toHaveTextContent("false");

    await act(async () => {
      land();
    });
    expect(signal()).toHaveTextContent("true");
    expect(syncCartOnReLoad).toHaveBeenCalledTimes(1);
    expect(rehydrateReports()).toEqual([]);
  });

  it("settles true when the rehydrate FAILS (Dexie unavailable): the empty-cart exit is never left waiting — and the loss is reported once (audit-fixes C5)", async () => {
    syncCartOnReLoad.mockRejectedValueOnce(new Error("dexie unavailable"));
    renderRoutes();
    await waitFor(() => expect(signal()).toHaveTextContent("true"));
    expect(rehydrateReports()).toEqual([
      [
        KioskEventName.ErrorOccurred,
        { error_source: "dexie", stage: "rehydrate", error_message: "dexie unavailable" },
      ],
    ]);
  });

  it("reports the ROOT cause syncCartOnReLoad wraps (its own console line is gone)", async () => {
    syncCartOnReLoad.mockRejectedValueOnce(
      new Error("Error syncing cart from Dexie", {
        cause: new Error("DatabaseClosedError: Database has been closed"),
      })
    );
    renderRoutes();
    await waitFor(() => expect(signal()).toHaveTextContent("true"));
    expect(rehydrateReports()).toEqual([
      [
        KioskEventName.ErrorOccurred,
        {
          error_source: "dexie",
          stage: "rehydrate",
          error_message: "DatabaseClosedError: Database has been closed",
        },
      ],
    ]);
  });
});

/*
  Motion contract §2.3: AppRoutes writes the session trail usePageEnter reads,
  once per COMMITTED pathname. Here an unregistered device's /second commits,
  the guard bounces it to / (REPLACE), and both land on the trail — so a later
  PUSH to /second reads as a return ("back").
*/
describe("AppRoutes — the motion session trail", () => {
  beforeEach(() => {
    syncCartOnReLoad.mockReset();
    syncCartOnReLoad.mockResolvedValue(undefined);
    notePath("/start"); // a fresh, empty trail
  });

  it("notes each committed pathname: a PUSH back to one of them is back, anything else fwd", async () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/second"]}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>
    );
    await waitFor(() => expect(signal()).toHaveTextContent("true")); // the guard landed on /
    expect(pageEnterDirection("/second", NavigationType.Push)).toBe("back");
    expect(pageEnterDirection("/menu", NavigationType.Push)).toBe("fwd");
  });
});

/*
  P8b F1 wiring: /payment AND /receipt mount under PaytmResumeGuard. Since the
  receipt question follows the payment (2026-10-13) no flow of this build
  reaches /receipt with a session open, but the guard there is the backstop
  that keeps an UNPAID open session off the post-payment question: a crash-
  reload of an older build mid-initiate on /receipt (autoUpdate's one-time
  deploy edge), or a paid tail's unflushed write. Without it /receipt would
  mount in paid mode over an armed terminal (mutation verifier: "drop the
  guard around /receipt" survived every other test).
*/
describe("AppRoutes — /payment and /receipt sit under the Paytm resume guard", () => {
  beforeEach(() => {
    syncCartOnReLoad.mockReset();
    syncCartOnReLoad.mockResolvedValue(undefined);
    pageMounts.length = 0;
    document.cookie = "token=abc123; path=/";
  });
  afterEach(() => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    store.dispatch({ type: "RESET_STATE" });
  });

  it.each(["/payment", "/receipt"])("a Paytm session open when %s mounts resumes on /paymentPolling — the page never mounts", (path) => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: "17280000000012345", posBillTime: 1_728_000_000_000 }));
    renderAt(path);

    expect(screen.getByTestId("page-probe")).toHaveTextContent("polling");
    expect(pageMounts).toEqual(["polling"]);
  });

  it("pin: a settled session (the paid tail's clear — type kept, ids blank) renders the post-payment /receipt", () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    renderAt("/receipt");

    expect(screen.getByTestId("page-probe")).toHaveTextContent("receipt");
    expect(pageMounts).toEqual(["receipt"]);
  });
});
