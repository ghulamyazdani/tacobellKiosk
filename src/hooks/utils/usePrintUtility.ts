import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import dayjs from "dayjs";
import { selectKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { buildPrintTicket } from "@cx-sdk/devices/printer/ticketFormat";
import useAppSettings from "./useAppSettings";
import type { ReceiptPreference } from "../paymentsHooks/usePayAtCounter";

/**
 * usePrintUtility — the customer receipt, printed at most once, on the local
 * print agent only.
 *
 * Ticket LAYOUT is the SDK's (`buildPrintTicket` from
 * @cx-sdk/devices/printer/ticketFormat, moved verbatim from the fork). This
 * hook owns only what a hook must own: the redux read, the wall-clock stamp,
 * the once-per-order latch, the gate, and the transport — a POST to the
 * agent on https://localhost:65505. It talks to no gateway and no terminal.
 *
 * ── THE GATE (brief "PRINTING" truth table) ─────────────────────────────
 * Print iff ALL of:
 *   - the customer chose PRINT on /receipt          (`receipt === "print"`)
 *   - the `print_bill` device setting is on         (`getPrintBillSetting()`)
 *   - the POS is not printing this one instead:
 *       `enable_printing_via_pos` OFF               -> kiosk prints, or
 *       `enable_printing_via_pos` ON *and* the order is pay-at-counter
 *       (`payment.paymentType === "PAY_AT_RESTAURANT"`) -> kiosk prints
 *   - this orderId has not been printed already
 * and only AFTER the push resolved — the ticket reads `order.currentOrder`,
 * which `pushOrder` populates.
 *
 * ── DIVERGENCES FROM THE FORK (deliberate) ──────────────────────────────
 * 1. The fork's once-guard is broken: OrderSucces.tsx keeps a
 *    `currentCount` ref that it increments on EVERY run of an effect whose
 *    deps are `[currentOrderRdx, currentStep]`. The first run happens on
 *    mount, before `currentOrder` is populated, so the counter is already 1
 *    by the time the real step-3 run arrives and the ticket is silently
 *    skipped. Here the latch is keyed on the ORDER ID, so it means what it
 *    says: this order printed / did not print, regardless of render count.
 * 2. The fork's `printData` awaits a bare `fetch` with no timeout and no
 *    `.catch` (documented as intentionally unfixed at extraction time). A
 *    dead or absent print agent therefore throws an unhandled rejection into
 *    the success screen. Here the request is bounded by an AbortController
 *    ({@link PRINT_AGENT_TIMEOUT_MS}) and every failure — offline agent,
 *    self-signed cert, abort, malformed order — is swallowed. Rule 2: the
 *    receipt is a nice-to-have; the Order Complete screen is not.
 * 3. The transport is deliberately a raw `fetch`, not the RTK Query
 *    apiSlice: the print agent is a different origin on the LOCAL machine
 *    with its own (non-JSON-envelope) contract and must never inherit the
 *    kiosk's auth headers or base URL.
 *
 * ── PRESERVED QUIRK (flagged) ───────────────────────────────────────────
 * On the zero-bill loyalty path the payment type stays "" (see
 * usePayAtCounter), so with `enable_printing_via_pos` ON that order prints
 * on neither the POS's pay-at-counter branch nor the kiosk. Fork behaviour;
 * it needs the same product decision as the ONLINE payload quirk.
 */

/** Local print agent. Same origin/port as the fork — a desktop companion app. */
const PRINT_AGENT_URL = "https://localhost:65505/api/printer";

/**
 * Hard ceiling on the print POST (Rule 2 — every call is bounded). The agent
 * is on loopback; 5s is already an eternity for it, and anything longer
 * would keep a request alive past the success screen's countdown.
 */
export const PRINT_AGENT_TIMEOUT_MS = 5000;

/** Everything the ticket needs, captured BEFORE any session reset runs. */
export interface PrintOrderTicketArgs {
  /** `order.currentOrder` — the snapshot `pushOrder` stored. */
  order: unknown;
  /** The full order id (the ticket prints it whole and as its last 5). */
  orderId: string;
  /** Pre-formatted total; printed verbatim by the SDK builder. */
  totalAmount: number | string;
}

export interface UsePrintUtility {
  /**
   * The settings + choice half of the gate, without the latch — safe to call
   * during render to decide whether a "printing your receipt" line shows.
   */
  shouldPrintReceipt: (receipt: ReceiptPreference) => boolean;
  /**
   * Fire-and-forget print. Builds the ticket SYNCHRONOUSLY from the values
   * passed in (so the caller may reset the session immediately afterwards)
   * and posts it without the caller having to await anything.
   * Returns true when this call actually dispatched a ticket.
   */
  printOrderTicket: (
    receipt: ReceiptPreference,
    args: PrintOrderTicketArgs,
  ) => boolean;
}

function usePrintUtility(): UsePrintUtility {
  const kioskPaymentType = useSelector(selectKioskPaymentType);
  const { getPrintBillSetting, getIsPrintOnPos } = useAppSettings();

  /** Order ids already handed to the agent by THIS hook instance. */
  const printedOrderIdRef = useRef<string | null>(null);
  /** In-flight request, so an unmount cannot leave the fetch dangling. */
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const shouldPrintReceipt = useCallback(
    (receipt: ReceiptPreference): boolean => {
      if (receipt !== "print") return false;
      if (!getPrintBillSetting()) return false;
      if (!getIsPrintOnPos()) return true;
      // POS printing is on: the kiosk only prints the pay-at-counter ticket,
      // otherwise the customer would walk away with two receipts.
      return kioskPaymentType === "PAY_AT_RESTAURANT";
    },
    [getIsPrintOnPos, getPrintBillSetting, kioskPaymentType],
  );

  const printOrderTicket = useCallback(
    (receipt: ReceiptPreference, args: PrintOrderTicketArgs): boolean => {
      const { order, orderId, totalAmount } = args;

      // The ticket reads the pushed order; without one there is nothing to
      // print and the SDK builder would throw on the destructure.
      if (!order || !orderId) return false;
      if (printedOrderIdRef.current === orderId) return false;
      if (!shouldPrintReceipt(receipt)) return false;

      // Latch BEFORE the build: a builder throw must not leave the door open
      // for a second attempt on the next render.
      printedOrderIdRef.current = orderId;

      let body: string;
      try {
        // Synchronous, so the caller is free to reset the session (which
        // clears order/cart state) the moment this returns.
        const ticket = buildPrintTicket(
          order,
          orderId,
          totalAmount,
          kioskPaymentType,
          dayjs().format("YYYY-MM-DD HH:mm:ss"),
        );
        body = JSON.stringify(ticket);
      } catch {
        // Malformed order (missing items/source) — no receipt, no crash.
        return false;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        controller.abort();
      }, PRINT_AGENT_TIMEOUT_MS);

      // Fire-and-forget: nothing on screen waits for the printer. Raw fetch
      // on purpose (divergence 3) — the agent is a different, local origin
      // and must not inherit the kiosk apiSlice base URL or auth headers.
      void fetch(PRINT_AGENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      })
        .catch(() => {
          // Agent offline / self-signed cert rejected / timed out. The
          // customer's order is already placed; the screen must not care.
        })
        .finally(() => {
          if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          if (abortRef.current === controller) abortRef.current = null;
        });

      return true;
    },
    [kioskPaymentType, shouldPrintReceipt],
  );

  return { shouldPrintReceipt, printOrderTicket };
}

export default usePrintUtility;
