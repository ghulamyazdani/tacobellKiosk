import { describe, expect, it } from "vitest";
import {
  PAYTM_POLL_INTERVAL_MS,
  PAYTM_SETTLE_WINDOW_MS,
  isPaytmNotPaidDefinitive,
  paytmSessionEffects,
  reducePaytmSession,
  startPaytmSession,
  type PaytmSessionEvent,
  type PaytmSessionState,
} from "@cx-sdk/payments/settlement/paytmKioskSettlement";
import { paytmWindowMs, type PaytmKind } from "@cx-sdk/payments/gateways/paytmKiosk";
import type {
  PaytmEdcVoidOutcome,
  PaytmPollOutcome,
} from "@cx-sdk/payments/settlement/settlementRules";

/*
  P8b money logic, settlement half: the /paymentPolling reducer's transition
  table (contract §P8b-03 + planner refinements), row by row, for BOTH kinds.
  The invariants that keep money safe: "paid" always wins; an EDC void only
  follows a FRESH "pending" read (made after entering cancelling/settling) and
  at most once; an errored read never counts as pending; DQR expires only on a
  fresh pending read, anything less is "unknown" (staff panel).
*/

const T0 = 1_700_000_000_000; // posBillTime
const SETTLE = PAYTM_SETTLE_WINDOW_MS;
const KINDS: PaytmKind[] = ["paytmDqr", "paytmEdc"];
const deadline = (kind: PaytmKind) => T0 + paytmWindowMs(kind);

const poll = (outcome: PaytmPollOutcome | "error", now: number): PaytmSessionEvent => ({ type: "poll", outcome, now });
const tick = (now: number): PaytmSessionEvent => ({ type: "tick", now });
const cancel = (now: number): PaytmSessionEvent => ({ type: "cancel", now });
const VOID_SENT: PaytmSessionEvent = { type: "voidSent" };
const voidResult = (outcome: PaytmEdcVoidOutcome | "unknown", now: number): PaytmSessionEvent => ({
  type: "void", outcome, now,
});
const run = (s: PaytmSessionState, ...events: PaytmSessionEvent[]) => events.reduce(reducePaytmSession, s);

// One state per phase. awaiting has already seen a pending read, so every
// later "fresh read" assertion proves the pre-window read does NOT count.
const awaiting = (kind: PaytmKind) => run(startPaytmSession(kind, T0, T0 + 1_000), poll("pending", T0 + 3_000));
const CANCEL_AT = T0 + 10_000;
const cancelling = (kind: PaytmKind) => run(awaiting(kind), cancel(CANCEL_AT));
const settling = (kind: PaytmKind) => run(awaiting(kind), tick(deadline(kind)));
const unknown = (kind: PaytmKind) =>
  run(settling(kind), poll("error", deadline(kind) + 3_000), tick(deadline(kind) + SETTLE));
const paid = (kind: PaytmKind) => run(awaiting(kind), poll("paid", T0 + 6_000));
const notPaid = (kind: PaytmKind) => run(awaiting(kind), poll("cancelled", T0 + 6_000));

const EVERY_EVENT: PaytmSessionEvent[] = [
  poll("paid", T0 + 7_000), poll("cancelled", T0 + 7_000), poll("pending", T0 + 7_000), poll("error", T0 + 7_000),
  tick(T0 + 999_000), cancel(T0 + 7_000), VOID_SENT, voidResult("voided", T0 + 7_000),
  voidResult("voidInProgress", T0 + 7_000),
];

it("knobs: poll every 3 s (fork cadence), settle window 30 s", () => {
  expect(PAYTM_POLL_INTERVAL_MS).toBe(3000);
  expect(PAYTM_SETTLE_WINDOW_MS).toBe(30_000);
});

describe.each(KINDS)("%s", (kind) => {
  describe("row 10 · startPaytmSession", () => {
    it("inside the window → awaiting, deadline = posBillTime + window", () => {
      expect(startPaytmSession(kind, T0, T0 + 1_000)).toEqual({
        kind,
        phase: "awaiting",
        deadlineAt: deadline(kind),
        settleUntil: null,
        lastPoll: null,
        voidRequested: false,
        terminalPrompt: "none",
        reason: null,
      });
    });

    it("deadline reached or passed (resume after reload) → settling", () => {
      for (const now of [deadline(kind), deadline(kind) + 60_000]) {
        expect(startPaytmSession(kind, T0, now)).toMatchObject({
          phase: "settling", deadlineAt: deadline(kind), settleUntil: now + SETTLE,
        });
      }
    });

    it("unusable posBillTime → settling with a finite deadline of now", () => {
      const now = T0 + 5_000;
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(startPaytmSession(kind, bad, now)).toMatchObject({
          phase: "settling", deadlineAt: now, settleUntil: now + SETTLE,
        });
      }
    });
  });

  describe("row 1 · paid / notPaid are terminal; unknown still takes polls", () => {
    it("paid and notPaid ignore every event (same object back)", () => {
      for (const terminal of [paid(kind), notPaid(kind)]) {
        for (const event of EVERY_EVENT) expect(reducePaytmSession(terminal, event)).toBe(terminal);
      }
    });

    it("unknown: CHECK AGAIN reads resolve it; ticks, cancels never do", () => {
      const u = unknown(kind);
      expect(u.phase).toBe("unknown");
      expect(reducePaytmSession(u, poll("paid", deadline(kind) + 60_000)).phase).toBe("paid");
      expect(reducePaytmSession(u, poll("pending", deadline(kind) + 60_000))).toMatchObject({
        phase: "unknown", lastPoll: "pending",
      });
      expect(reducePaytmSession(u, poll("error", deadline(kind) + 60_000)).phase).toBe("unknown");
      expect(reducePaytmSession(u, tick(deadline(kind) + 999_000))).toBe(u);
      expect(reducePaytmSession(u, cancel(deadline(kind) + 60_000))).toBe(u);
    });
  });

  describe("row 2 · a paid read always wins", () => {
    it.each([
      ["awaiting", awaiting], ["cancelling", cancelling], ["settling", settling], ["unknown", unknown],
    ] as const)("in %s → paid", (_phase, from) => {
      expect(reducePaytmSession(from(kind), poll("paid", deadline(kind) + 40_000))).toMatchObject({
        phase: "paid", lastPoll: "paid", reason: null,
      });
    });

    it("cancel race: confirm then a paid read → paid, and no void was ever due", () => {
      const c = cancelling(kind);
      expect(paytmSessionEffects(c).sendVoid).toBe(false);
      expect(reducePaytmSession(c, poll("paid", CANCEL_AT + 1_000)).phase).toBe("paid");
    });
  });

  describe("row 3 · a cancelled read → notPaid (definitive)", () => {
    it("awaiting before the deadline → cancelled; at/after it → expired", () => {
      const before = reducePaytmSession(awaiting(kind), poll("cancelled", deadline(kind) - 1));
      expect(before).toMatchObject({ phase: "notPaid", reason: "cancelled", lastPoll: "cancelled" });
      const at = reducePaytmSession(awaiting(kind), poll("cancelled", deadline(kind)));
      expect(at).toMatchObject({ phase: "notPaid", reason: "expired" });
      expect(isPaytmNotPaidDefinitive(before)).toBe(true);
      expect(isPaytmNotPaidDefinitive(at)).toBe(true);
    });

    it("settling and unknown → expired", () => {
      for (const from of [settling(kind), unknown(kind)]) {
        expect(reducePaytmSession(from, poll("cancelled", deadline(kind) + 50_000))).toMatchObject({
          phase: "notPaid", reason: "expired", lastPoll: "cancelled",
        });
      }
    });

    it("unknown reached before the deadline (a cancel window ran out) → cancelled", () => {
      const early = run(cancelling(kind), poll("error", CANCEL_AT + 1_000), tick(CANCEL_AT + SETTLE));
      expect(early.phase).toBe("unknown");
      expect(reducePaytmSession(early, poll("cancelled", CANCEL_AT + SETTLE + 1_000)).reason).toBe("cancelled");
    });

    it("cancelling → cancelledByCustomer, even past the deadline", () => {
      const s = reducePaytmSession(cancelling(kind), poll("cancelled", deadline(kind) + 5_000));
      expect(s).toMatchObject({ phase: "notPaid", reason: "cancelledByCustomer", lastPoll: "cancelled" });
      expect(isPaytmNotPaidDefinitive(s)).toBe(true);
    });
  });

  describe("row 4 · pending / error reads are recorded", () => {
    it("awaiting: both recorded, phase unchanged; a repeated read returns the same object", () => {
      const a = awaiting(kind);
      expect(a).toMatchObject({ phase: "awaiting", lastPoll: "pending" });
      expect(reducePaytmSession(a, poll("pending", T0 + 6_000))).toBe(a);
      expect(reducePaytmSession(a, poll("error", T0 + 6_000))).toMatchObject({ phase: "awaiting", lastPoll: "error" });
    });

    it("cancelling + error stays cancelling (an errored re-check never leaves)", () => {
      expect(reducePaytmSession(cancelling(kind), poll("error", CANCEL_AT + 1_000))).toMatchObject({
        phase: "cancelling", lastPoll: "error",
      });
    });
  });

  describe("row 5 · the deadline moves awaiting → settling", () => {
    it("before the deadline nothing changes; at it → settling, a new window, the old read cleared", () => {
      const a = awaiting(kind);
      expect(reducePaytmSession(a, tick(deadline(kind) - 1))).toBe(a);
      expect(reducePaytmSession(a, tick(deadline(kind)))).toMatchObject({
        phase: "settling", settleUntil: deadline(kind) + SETTLE, lastPoll: null,
      });
    });

    it("the deadline does not pre-empt a cancel's own window", () => {
      const lateCancel = run(awaiting(kind), cancel(deadline(kind) - 5_000));
      expect(reducePaytmSession(lateCancel, tick(deadline(kind)))).toBe(lateCancel);
      expect(lateCancel.phase).toBe("cancelling");
    });
  });

  describe("row 6 · end of the settle window", () => {
    it("ticks before settleUntil change nothing", () => {
      const s = settling(kind);
      expect(reducePaytmSession(s, tick(deadline(kind) + SETTLE - 1))).toBe(s);
    });

    it("a window with no read at all → unknown (the pre-deadline pending does not count)", () => {
      expect(reducePaytmSession(settling(kind), tick(deadline(kind) + SETTLE))).toMatchObject({
        phase: "unknown", reason: null,
      });
    });

    it("a window whose last read errored → unknown", () => {
      const s = run(settling(kind), poll("pending", deadline(kind) + 3_000), poll("error", deadline(kind) + 6_000));
      expect(reducePaytmSession(s, tick(deadline(kind) + SETTLE)).phase).toBe("unknown");
    });

    it("cancelling that only saw errors → unknown", () => {
      const s = run(cancelling(kind), poll("error", CANCEL_AT + 1_000), tick(CANCEL_AT + SETTLE));
      expect(s.phase).toBe("unknown");
    });
  });

  describe("row 7 · cancel only from awaiting", () => {
    it("awaiting → cancelling with its own window and no prior read", () => {
      expect(cancelling(kind)).toMatchObject({
        phase: "cancelling", settleUntil: CANCEL_AT + SETTLE, lastPoll: null, reason: null,
      });
    });

    it("ignored everywhere else", () => {
      for (const s of [cancelling(kind), settling(kind), unknown(kind)]) {
        expect(reducePaytmSession(s, cancel(deadline(kind) + 1_000))).toBe(s);
      }
    });
  });

  describe("row 9 · effects per phase", () => {
    it.each([
      ["awaiting", awaiting, { poll: true, sendVoid: false, holdIdle: true, showCancel: true }],
      ["cancelling", cancelling, { poll: true, sendVoid: false, holdIdle: true, showCancel: false }],
      ["settling", settling, { poll: true, sendVoid: false, holdIdle: true, showCancel: false }],
      ["paid", paid, { poll: false, sendVoid: false, holdIdle: true, showCancel: false }],
      ["notPaid", notPaid, { poll: false, sendVoid: false, holdIdle: false, showCancel: false }],
      ["unknown", unknown, { poll: false, sendVoid: false, holdIdle: false, showCancel: false }],
    ] as const)("%s", (_phase, from, effects) => {
      expect(paytmSessionEffects(from(kind))).toEqual(effects);
    });

    it("an error read never licenses a void", () => {
      for (const s of [cancelling(kind), settling(kind)]) {
        expect(paytmSessionEffects(reducePaytmSession(s, poll("error", deadline(kind) + 1_000))).sendVoid).toBe(false);
      }
    });
  });

  it("isPaytmNotPaidDefinitive is false outside notPaid", () => {
    for (const s of [awaiting(kind), cancelling(kind), settling(kind), unknown(kind), paid(kind)]) {
      expect(isPaytmNotPaidDefinitive(s)).toBe(false);
    }
  });
});

describe("paytmDqr specifics", () => {
  const kind: PaytmKind = "paytmDqr";

  it("row 4 · cancel re-check reads pending → cancelledByCustomer, NOT definitive (QR may be live, D6)", () => {
    const s = reducePaytmSession(cancelling(kind), poll("pending", CANCEL_AT + 1_000));
    expect(s).toMatchObject({ phase: "notPaid", reason: "cancelledByCustomer", lastPoll: "pending" });
    expect(isPaytmNotPaidDefinitive(s)).toBe(false);
  });

  it("row 6 · still pending at the end of the settle window → expired, definitive (D5)", () => {
    const s = run(settling(kind), poll("pending", deadline(kind) + 3_000), tick(deadline(kind) + SETTLE));
    expect(s).toMatchObject({ phase: "notPaid", reason: "expired", lastPoll: "pending" });
    expect(isPaytmNotPaidDefinitive(s)).toBe(true);
  });

  it("row 9 · a DQR session never asks for a void", () => {
    const fresh = run(settling(kind), poll("pending", deadline(kind) + 3_000));
    expect(fresh.phase).toBe("settling");
    expect(paytmSessionEffects(fresh).sendVoid).toBe(false);
  });
});

describe("paytmEdc specifics", () => {
  const kind: PaytmKind = "paytmEdc";

  it("row 4 · a pending read while cancelling stays cancelling (the void handles it)", () => {
    expect(reducePaytmSession(cancelling(kind), poll("pending", CANCEL_AT + 1_000))).toMatchObject({
      phase: "cancelling", lastPoll: "pending",
    });
  });

  it("row 6 · never expires by the clock: pending at the end of the window → unknown", () => {
    const s = run(settling(kind), poll("pending", deadline(kind) + 3_000), tick(deadline(kind) + SETTLE));
    expect(s.phase).toBe("unknown");
  });

  it("row 9 · a void needs a FRESH pending read in cancelling / settling, never awaiting or unknown", () => {
    expect(paytmSessionEffects(awaiting(kind)).sendVoid).toBe(false);
    expect(paytmSessionEffects(cancelling(kind)).sendVoid).toBe(false); // pre-cancel read does not count
    expect(paytmSessionEffects(reducePaytmSession(cancelling(kind), poll("pending", CANCEL_AT + 1_000))).sendVoid).toBe(true);
    expect(paytmSessionEffects(reducePaytmSession(settling(kind), poll("pending", deadline(kind) + 1_000))).sendVoid).toBe(true);
    expect(paytmSessionEffects(reducePaytmSession(unknown(kind), poll("pending", deadline(kind) + 60_000))).sendVoid).toBe(false);
  });

  describe("row 8 · the void", () => {
    const pendingCancel = () => run(cancelling(kind), poll("pending", CANCEL_AT + 1_000));

    it("voidSent marks the one void; a second voidSent is a no-op; never due again", () => {
      const sent = reducePaytmSession(pendingCancel(), VOID_SENT);
      expect(sent.voidRequested).toBe(true);
      expect(reducePaytmSession(sent, VOID_SENT)).toBe(sent);
      const later = run(sent, voidResult("error", CANCEL_AT + 3_000), poll("pending", CANCEL_AT + 4_000));
      expect(paytmSessionEffects(later).sendVoid).toBe(false);
    });

    it("voided → pressYes; voidInProgress → approveOnMachine; both extend the window", () => {
      const sent = reducePaytmSession(pendingCancel(), VOID_SENT);
      expect(reducePaytmSession(sent, voidResult("voided", CANCEL_AT + 15_000))).toMatchObject({
        terminalPrompt: "pressYes", settleUntil: CANCEL_AT + 15_000 + SETTLE,
      });
      expect(reducePaytmSession(sent, voidResult("voidInProgress", CANCEL_AT + 15_000))).toMatchObject({
        terminalPrompt: "approveOnMachine", settleUntil: CANCEL_AT + 15_000 + SETTLE,
      });
    });

    it("void error / unknown change nothing (status may still settle)", () => {
      const sent = reducePaytmSession(pendingCancel(), VOID_SENT);
      expect(reducePaytmSession(sent, voidResult("error", CANCEL_AT + 2_000))).toBe(sent);
      expect(reducePaytmSession(sent, voidResult("unknown", CANCEL_AT + 2_000))).toBe(sent);
    });

    it("settleUntil only grows (a late void result never shortens the window)", () => {
      const extended = run(pendingCancel(), VOID_SENT, voidResult("voided", CANCEL_AT + 20_000));
      expect(extended.settleUntil).toBe(CANCEL_AT + 20_000 + SETTLE);
      expect(reducePaytmSession(extended, voidResult("voidInProgress", CANCEL_AT + 2_000)).settleUntil).toBe(
        CANCEL_AT + 20_000 + SETTLE,
      );
    });
  });

  it("E3 customer cancel: read → void → pressYes → cancelled → cancelledByCustomer", () => {
    let s = cancelling(kind);
    s = reducePaytmSession(s, poll("pending", CANCEL_AT + 1_000));
    expect(paytmSessionEffects(s).sendVoid).toBe(true);
    s = run(s, VOID_SENT, voidResult("voided", CANCEL_AT + 2_000));
    expect(s.terminalPrompt).toBe("pressYes");
    expect(paytmSessionEffects(s)).toMatchObject({ poll: true, sendVoid: false, holdIdle: true });
    s = reducePaytmSession(s, poll("cancelled", CANCEL_AT + 5_000));
    expect(s).toMatchObject({ phase: "notPaid", reason: "cancelledByCustomer" });
    expect(isPaytmNotPaidDefinitive(s)).toBe(true);
  });

  it("E5/E6 expiry: one void after a fresh read, then cancelled → expired, or no answer → unknown", () => {
    const d = deadline(kind);
    const voidedAtExpiry = run(settling(kind), poll("pending", d + 1_000), VOID_SENT, voidResult("voided", d + 3_000));
    expect(run(voidedAtExpiry, poll("cancelled", d + 6_000))).toMatchObject({ phase: "notPaid", reason: "expired" });

    const voidFailed = run(settling(kind), poll("pending", d + 1_000), VOID_SENT, voidResult("unknown", d + 11_000));
    const stillPending = run(voidFailed, poll("pending", d + 14_000), poll("pending", d + 17_000));
    expect(paytmSessionEffects(stillPending).sendVoid).toBe(false);
    expect(reducePaytmSession(stillPending, tick(d + SETTLE))).toMatchObject({
      phase: "unknown", voidRequested: true,
    });
  });
});

it("settleUntil is monotone across a long mixed script", () => {
  const d = deadline("paytmEdc");
  const script: PaytmSessionEvent[] = [
    poll("pending", T0 + 3_000), tick(d), poll("error", d + 2_000), poll("pending", d + 5_000), VOID_SENT,
    voidResult("voided", d + 9_000), tick(d + 20_000), voidResult("voidInProgress", d + 4_000),
    poll("pending", d + 25_000), tick(d + 38_000), voidResult("voided", d + 39_000), tick(d + 80_000),
  ];
  let s = startPaytmSession("paytmEdc", T0, T0 + 1_000);
  let previous = Number.NEGATIVE_INFINITY;
  for (const event of script) {
    s = reducePaytmSession(s, event);
    if (s.settleUntil !== null) {
      expect(s.settleUntil).toBeGreaterThanOrEqual(previous);
      previous = s.settleUntil;
    }
  }
  expect(s.phase).toBe("unknown");
});
