import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setGeneralSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { store } from "../../../redux/app/store";
import usePrintUtility, {
  PRINT_AGENT_TIMEOUT_MS,
  type PrintOrderTicketArgs,
  type UsePrintUtility,
} from "../usePrintUtility";
import type { ReceiptPreference } from "../../paymentsHooks/usePayAtCounter";
import "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  ⛔ SAFETY: `fetch` is replaced with a vi.stubGlobal spy for EVERY test in
  this file, in beforeEach, before anything is rendered. No test in here can
  reach https://localhost:65505 (or any other URL) even if the gate breaks —
  and the spy is what lets us assert the exact request the print agent would
  have received.

  Nothing else is mocked. The gate runs through the REAL settingsEngine
  lookups over the REAL appSettings slice, and the ticket is built by the REAL
  SDK `buildPrintTicket`, so a fixture whose shape the builder rejects fails
  the test instead of quietly passing.
*/

type FetchCall = [input: unknown, init: RequestInit | undefined];

let mockFetch: ReturnType<typeof vi.fn>;

/** The hook's surface, captured from a render. */
let api: UsePrintUtility | null = null;

function Harness() {
  const hook = usePrintUtility();
  // Published from an EFFECT, not during render: the harness must obey the
  // same purity rule as the app (react-hooks/globals), and after-render is
  // exactly when the tests reach for it.
  useEffect(() => {
    api = hook;
  });
  return <div data-testid="print-harness" />;
}

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/orderSuccess"]}>
        <Harness />
      </MemoryRouter>
    </Provider>
  );

const ORDER_ID = "TB-ORDER-ABCDE12345";

/** A pushed order in the shape `buildPrintTicket` destructures. */
const TICKET_ARGS: PrintOrderTicketArgs = {
  order: {
    orderId: ORDER_ID,
    orderInfo: {
      source: { name: "Kiosk" },
      tabType: "table",
      tableNumber: "12",
      items: [{ name: "Crunchwrap Supreme", quantity: 1 }],
    },
  },
  orderId: ORDER_ID,
  totalAmount: 24.5,
};

/** One `generalSettings` row in the `value.value` shape the device sends. */
const settingRow = (settingId: string, value: unknown) => ({
  setting_id: settingId,
  value: { value },
});

const setPrintSettings = (printBill: boolean, printOnPos: boolean) => {
  store.dispatch(
    setGeneralSettings([
      settingRow("print_bill", printBill),
      settingRow("enable_printing_via_pos", printOnPos),
    ])
  );
};

const print = (
  receipt: ReceiptPreference,
  args: PrintOrderTicketArgs = TICKET_ARGS
) => {
  let result = false;
  act(() => {
    result = api!.printOrderTicket(receipt, args);
  });
  return result;
};

const calls = () => mockFetch.mock.calls as unknown as FetchCall[];

describe("usePrintUtility — the receipt, printed at most once", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    api = null;
    // ⛔ Stubbed before any render: no test here can touch a real URL.
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    // Default deployment: kiosk prints, POS does not.
    setPrintSettings(true, false);
    store.dispatch(setKioskPaymentType({ type: "PAY_AT_RESTAURANT" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("the truth table", () => {
    it("prints when the customer chose PRINT and print_bill is on", () => {
      mount();

      expect(api!.shouldPrintReceipt("print")).toBe(true);
      expect(print("print")).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not print when the customer chose NO THANKS", () => {
      mount();

      expect(api!.shouldPrintReceipt("none")).toBe(false);
      expect(print("none")).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not print for the (inert) EMAIL choice", () => {
      // The email tile collects nothing and there is no data contract for it;
      // if it ever became reachable it must still not print paper.
      mount();

      expect(api!.shouldPrintReceipt("email")).toBe(false);
      expect(print("email")).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not print when print_bill is off", () => {
      setPrintSettings(false, false);
      mount();

      expect(api!.shouldPrintReceipt("print")).toBe(false);
      expect(print("print")).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not print when the general settings never arrived", () => {
      store.dispatch(setGeneralSettings([]));
      mount();

      expect(api!.shouldPrintReceipt("print")).toBe(false);
      expect(print("print")).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("prints the pay-at-counter ticket even when the POS prints", () => {
      // POS printing on + pay-at-counter: the kiosk still prints, because
      // the POS does not own this one.
      setPrintSettings(true, true);
      store.dispatch(setKioskPaymentType({ type: "PAY_AT_RESTAURANT" }));
      mount();

      expect(api!.shouldPrintReceipt("print")).toBe(true);
      expect(print("print")).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("leaves the receipt to the POS for a non pay-at-counter order", () => {
      // PRESERVED QUIRK: the zero-bill loyalty path leaves paymentType "",
      // so with POS printing on that order prints on neither. Flagged, not
      // fixed — this test pins the current behaviour so the fix is deliberate.
      setPrintSettings(true, true);
      store.dispatch(setKioskPaymentType({ type: "" }));
      mount();

      expect(api!.shouldPrintReceipt("print")).toBe(false);
      expect(print("print")).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("what the print agent receives", () => {
    it("POSTs a JSON ticket to the local agent", () => {
      mount();
      print("print");

      const [url, init] = calls()[0];
      expect(url).toBe("https://localhost:65505/api/printer");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });

      const ticket = JSON.parse(String(init?.body));
      expect(ticket.copies).toBe(1);
      expect(ticket.printers).toBeNull();
      // The ticket leads with the same last-5 the screen shows.
      expect(ticket.data).toContain("12345");
      expect(ticket.data).toContain(ORDER_ID);
      expect(ticket.data).toContain("Crunchwrap Supreme");
    });

    it("bounds the request with an abort signal", () => {
      mount();
      print("print");

      const [, init] = calls()[0];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
    });
  });

  describe("exactly once", () => {
    it("refuses a second print of the same order", () => {
      mount();

      expect(print("print")).toBe(true);
      expect(print("print")).toBe(false);
      expect(print("print")).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("keeps the latch even when the ticket could not be built", () => {
      // An order whose orderInfo carries no `items` makes the SDK builder
      // throw (it maps that array unguarded). The latch is taken BEFORE the
      // build, so a re-render cannot retry into a half-printed ticket.
      const broken: PrintOrderTicketArgs = {
        order: { orderId: ORDER_ID, orderInfo: { source: { name: "Kiosk" } } },
        orderId: ORDER_ID,
        totalAmount: 1,
      };
      mount();

      expect(print("print", broken)).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(print("print", broken)).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does nothing at all without a pushed order", () => {
      mount();

      expect(
        print("print", { order: null, orderId: ORDER_ID, totalAmount: 1 })
      ).toBe(false);
      expect(
        print("print", { order: TICKET_ARGS.order, orderId: "", totalAmount: 1 })
      ).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("a dead print agent must never reach the screen (Rule 2)", () => {
    it("survives a rejecting fetch", async () => {
      // The suite itself is the assertion for "no unhandled rejection":
      // an escaped rejection fails the vitest run.
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      mount();

      expect(() => print("print")).not.toThrow();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("survives a fetch that rejects with a DOMException-style abort", async () => {
      mockFetch.mockRejectedValue(
        new DOMException("The operation was aborted.", "AbortError")
      );
      mount();

      expect(print("print")).toBe(true);
      await act(async () => {
        await Promise.resolve();
      });
    });

    it("aborts a hanging request once the timeout elapses", async () => {
      vi.useFakeTimers();
      // Never settles — a print agent that accepted the socket and went away.
      mockFetch.mockImplementation(() => new Promise(() => {}));
      mount();

      expect(print("print")).toBe(true);
      const signal = calls()[0][1]?.signal;
      expect(signal?.aborted).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PRINT_AGENT_TIMEOUT_MS);
      });

      expect(signal?.aborted).toBe(true);
    });

    it("aborts an in-flight request when the screen unmounts (Rule 5)", () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));
      const view = mount();

      print("print");
      const signal = calls()[0][1]?.signal;
      expect(signal?.aborted).toBe(false);

      view.unmount();

      expect(signal?.aborted).toBe(true);
    });

    it("returns synchronously — nothing on screen waits for the printer", () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));
      mount();

      // A hanging agent still returns true immediately: fire-and-forget.
      expect(print("print")).toBe(true);
    });
  });
});
