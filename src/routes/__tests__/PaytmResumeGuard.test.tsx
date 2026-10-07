import { inspect } from "node:util";
import { useEffect, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { readOpenPaytmSession } from "@cx-sdk/payments/gateways/paytmKiosk";
import {
  emptyPayment,
  setBillPaymentInfo,
  setKioskPaymentType,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../redux/app/store";
import PaytmPayment from "../../pages/PaytmPayment";
import useSessionReset, { type SessionResetScope } from "../../hooks/utils/useSessionReset";
import PaytmResumeGuard from "../PaytmResumeGuard";
import "../../i18n";

/*
  P8b F1 — a reload mid-EDC-initiate keeps /receipt (or /payment) in the URL.
  A Paytm session still open when the guarded layout MOUNTS resumes on
  /paymentPolling with the SAME ids; everything else renders the page. The
  decision is latched per mount, so the initiate that opens a session under
  the layout is never bounced or swept. StrictMode throughout: once only.

  The loop / strand blocks mount the REAL /paymentPolling (PaytmPayment +
  usePaytmSettlement) beside the guard, so "cannot loop" is proven against
  the page's own no-session redirect and every exit it really takes. Mocked
  edges only: the three Paytm status/void triggers, useOrderHook and
  analytics (the guard itself touches none of them) — recorded, so the
  Rule 3 sweep reads every payload the resumed sessions sent.
*/

/** [key, value] of every leaf of every payload — a field nested anywhere still counts. */
const leaves = (node: unknown, key = ""): Array<[string, unknown]> =>
  node !== null && typeof node === "object"
    ? Object.entries(node).flatMap(([k, v]) => leaves(v, k))
    : [[key, node]];

type Envelope = { data?: unknown; error?: unknown };
const gw = vi.hoisted(() => ({
  status: [] as Record<string, unknown>[],
  voids: [] as Record<string, unknown>[],
  /** Every captureKioskEvent call: [name, props]. */
  events: [] as unknown[][],
  statusReply: (): Promise<Envelope> => Promise.resolve({ data: { status: "pending" } }),
  voidReply: (): Promise<Envelope> => Promise.resolve({ data: { success: true } }),
}));

vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => {
  // Stable per hook, like RTK's memoised trigger.
  const status = [
    (body: Record<string, unknown>) => {
      gw.status.push(body);
      return gw.statusReply();
    },
  ];
  const cancel = [
    (body: Record<string, unknown>) => {
      gw.voids.push(body);
      return gw.voidReply();
    },
  ];
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useCheckPaytmDqrKioskStatusMutation: () => status,
    useCheckPaytmEdcKioskStatusMutation: () => status,
    useCancelPaytmEdcKioskMutation: () => cancel,
  };
});
vi.mock("../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => {
    gw.events.push(args);
  },
}));
vi.mock("../../hooks/menuHooks/useOrderHook", () => ({
  default: () => ({ recordOrderLocally: () => Promise.resolve() }),
}));

const BILL = "17280000000012345";
const BILL_TIME = 1_728_000_000_000;
const mounted = vi.fn();

interface PaymentLike {
  posBillNo: string;
  posBillTime: number | string;
  paymentType: string;
}
const payment = () => (store.getState() as unknown as { payment: PaymentLike }).payment;

function Probe({ name }: { name: string }) {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  useEffect(() => {
    mounted(name);
  }, [name]);
  return (
    <>
      <div data-testid="probe">
        {JSON.stringify({ name, path: location.pathname, state: location.state, type })}
      </div>
      <button type="button" data-testid="to-payment" onClick={() => navigate("/payment")} />
    </>
  );
}

const renderAt = (path: string, receipt = <Probe name="receipt" />) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<PaytmResumeGuard />}>
            <Route path="/payment" element={<Probe name="payment" />} />
            <Route path="/receipt" element={receipt} />
          </Route>
          <Route path="/paymentPolling" element={<Probe name="polling" />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
    { reactStrictMode: true },
  );
const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}");

const arm = (type: string) => store.dispatch(setKioskPaymentType({ type }));
const ids = () => store.dispatch(setBillPaymentInfo({ posBillNo: BILL, posBillTime: BILL_TIME }));
const QR = "upi://pay?pa=tb@paytm";
const qr = () => store.dispatch(setPaytmQrCode(QR));

/** The app's own session end (StartScreen "full", Order Complete's NEW ORDER "nextCustomer"). */
const reset = (scope: SessionResetScope) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter>{children}</MemoryRouter>
    </Provider>
  );
  const { result, unmount } = renderHook(() => useSessionReset(), { wrapper });
  act(() => result.current.resetSession(scope));
  unmount();
};

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  mounted.mockReset();
});

describe("PaytmResumeGuard — /payment and /receipt", () => {
  it.each([
    ["/receipt", "EDC (the reload mid-initiate)", () => { arm("PaytmEdc"); ids(); }],
    ["/payment", "EDC", () => { arm("PaytmEdc"); ids(); }],
    ["/receipt", "DQR with its QR", () => { arm("PaytmDynamicQr"); ids(); qr(); }],
    ["/payment", "DQR with its QR", () => { arm("PaytmDynamicQr"); ids(); qr(); }],
  ])("%s, %s session open at mount → /paymentPolling (replace, receipt none), the page never mounts, the ids are kept", (path, _label, seed) => {
    seed();
    renderAt(path);

    expect(probe()).toEqual({ name: "polling", path: "/paymentPolling", state: { receipt: "none" }, type: "REPLACE" });
    expect(new Set(mounted.mock.calls.flat())).toEqual(new Set(["polling"]));
    expect(payment()).toMatchObject({ posBillNo: BILL, posBillTime: BILL_TIME });
  });

  // Every way a session is absent or already OVER — each through the app's
  // own reducer — on both guarded paths: never a redirect (no stale resume).
  const NOT_OPEN: Array<[string, () => void]> = [
    ["no session", () => undefined],
    ["COD armed", () => arm("PAY_AT_RESTAURANT")],
    ["an unported gateway type carrying ids", () => { arm("Geidea"); ids(); }],
    ["a refused initiate (ids cleared, EDC still armed)", () => {
      arm("PaytmEdc");
      store.dispatch(setBillPaymentInfo({ posBillNo: "", posBillTime: "" }));
    }],
    // /paymentPolling's exits (cancel, TRY AGAIN, BACK TO BAG) empty the
    // slice BEFORE navigating here: no loop.
    ["a session /paymentPolling already ended (emptyPayment)", () => { arm("PaytmEdc"); ids(); store.dispatch(emptyPayment()); }],
    // FINISH / idle on an end panel → /start, whose teardown resets.
    ["a session /start's teardown ended (resetSession full)", () => { arm("PaytmEdc"); ids(); reset("full"); }],
    // Paid → Order Complete → NEW ORDER: the fast path that skips /start.
    ["a paid session Order Complete's NEW ORDER ended (resetSession nextCustomer)", () => {
      arm("PaytmDynamicQr");
      ids();
      qr();
      reset("nextCustomer");
    }],
  ];
  it.each(
    ["/payment", "/receipt"].flatMap((path) =>
      NOT_OPEN.map(([label, seed]) => [path, label, seed] as const),
    ),
  )("%s, %s → the page renders and nothing navigates", (path, _label, seed) => {
    seed();
    expect(readOpenPaytmSession(payment())).toBeNull();
    renderAt(path);
    expect(probe()).toMatchObject({ name: path.slice(1), path, type: "POP" });
    expect(new Set(mounted.mock.calls.flat())).toEqual(new Set([path.slice(1)]));
  });

  it("LATCHED: a session the initiate opens under the mounted layout is never bounced or swept — not even on a later in-layout navigation", () => {
    arm("PaytmEdc");
    renderAt("/receipt");
    act(() => {
      ids(); // usePaytmCheckout stores the ids BEFORE its call
    });
    expect(probe()).toMatchObject({ name: "receipt" });

    fireEvent.click(screen.getByTestId("to-payment"));
    expect(probe()).toMatchObject({ name: "payment", path: "/payment" });
    expect(payment()).toMatchObject({ posBillNo: BILL, posBillTime: BILL_TIME });
  });

  it("an interrupted DQR initiate (ids, no QR — never shown, unpayable) is not open: the page renders and the dead ids are dropped, so re-arming EDC cannot read as a session", () => {
    arm("PaytmDynamicQr");
    ids();
    renderAt("/receipt");

    expect(probe()).toMatchObject({ name: "receipt" });
    expect(payment()).toMatchObject({ posBillNo: "", posBillTime: "" });
    arm("PaytmEdc");
    expect(readOpenPaytmSession(payment())).toBeNull();
  });

  it("only the ids seen dead at the first render are dropped: an initiate that beat the guard's effect keeps its FRESH ids", () => {
    const FRESH = "17280000000099999";
    arm("PaytmDynamicQr");
    ids(); // the interrupted DQR initiate's dead ids
    // A child's mount effect runs BEFORE the layout's — the tap that won the
    // race. Latched like the real initiate (StrictMode re-runs effects).
    function EdcInitiateFirst() {
      const startedRef = useRef(false);
      useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        arm("PaytmEdc");
        store.dispatch(setBillPaymentInfo({ posBillNo: FRESH, posBillTime: BILL_TIME + 1 }));
      }, []);
      return <Probe name="receipt" />;
    }
    renderAt("/receipt", <EdcInitiateFirst />);

    expect(probe()).toMatchObject({ name: "receipt", path: "/receipt" });
    expect(payment()).toMatchObject({ posBillNo: FRESH, posBillTime: BILL_TIME + 1, paymentType: "PaytmEdc" });
  });
});

/* ------------------------------------------------------------------ */
/* Loop / strand — the guard beside the REAL /paymentPolling            */
/* ------------------------------------------------------------------ */

describe("PaytmResumeGuard + the real /paymentPolling — never a loop, never a strand", () => {
  const EDC_ROW = {
    _id: "pay_edc",
    tenant_id: "tenant1",
    deployment_id: "dep1",
    setting_label: "PaytmEdc",
    value: [
      { id: "activate", value: true },
      { id: "paytm_device_id", value: "EDC-1" },
    ],
  };
  const DQR_ROW = {
    _id: "pay_dqr",
    tenant_id: "tenant1",
    deployment_id: "dep1",
    setting_label: "PaytmDynamicQr",
    value: [
      { id: "activate", value: true },
      { id: "paytm_dqr_merchant_guid", value: "MID-1" },
      { id: "paytm_dqr_secret_key", value: "KEY-1" },
    ],
  };
  const CW = { id: "cw", itemId: "cw-1", name: "CW", quantity: 1, type: "ITEM", total_price: 9 };
  const answer = (status: string) => () => Promise.resolve<Envelope>({ data: { status } });

  /** Every committed location, in order. A ping-pong throws instead of hanging. */
  const journey: string[] = [];
  function Journey() {
    const location = useLocation();
    const seenRef = useRef("");
    useEffect(() => {
      if (seenRef.current === location.key) return; // StrictMode re-run
      seenRef.current = location.key;
      journey.push(location.pathname);
      if (journey.length > 8) throw new Error(`navigation loop: ${journey.join(" → ")}`);
    }, [location]);
    return null;
  }

  const renderApp = (path: string) =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <Journey />
          <Routes>
            <Route element={<PaytmResumeGuard />}>
              <Route path="/payment" element={<Probe name="payment" />} />
              <Route path="/receipt" element={<Probe name="receipt" />} />
            </Route>
            <Route path="/paymentPolling" element={<PaytmPayment />} />
            {["/orderSuccess", "/cart", "/menu", "/start"].map((to) => (
              <Route key={to} path={to} element={<Probe name={to.slice(1)} />} />
            ))}
          </Routes>
        </MemoryRouter>
      </Provider>,
      { reactStrictMode: true },
    );

  const kiosk = (rows: unknown[] = [EDC_ROW, DQR_ROW], bag = true) => {
    if (bag) store.dispatch(setCartItems([CW]));
    store.dispatch(setAmount(9));
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: { _id: "dep1", tenant_id: "tenant1" }, licenseDetails: {} }),
    );
    store.dispatch(setPaymentSettings(rows));
  };
  /** An open session whose window starts now (fake clock). */
  const open = (kind: "edc" | "dqr") => {
    arm(kind === "edc" ? "PaytmEdc" : "PaytmDynamicQr");
    store.dispatch(setBillPaymentInfo({ posBillNo: BILL, posBillTime: Date.now() }));
    if (kind === "dqr") qr();
  };
  const tap = (testId: string) =>
    act(() => {
      fireEvent.click(screen.getByTestId(testId));
    });
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  /** 1 s acts: React re-arms the self-rescheduling poll between them. */
  const step = async (ms: number) => {
    for (let left = ms; left > 0; left -= 1000) await advance(Math.min(1000, left));
  };
  const here = () => probe() as { name: string; path: string };

  beforeEach(() => {
    vi.useFakeTimers();
    journey.length = 0;
    gw.status.length = 0;
    gw.voids.length = 0;
    gw.events.length = 0;
    gw.statusReply = answer("pending");
    gw.voidReply = () => Promise.resolve({ data: { success: true } });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["TRY AGAIN", "/payment", "paytm-failed-retry"],
    ["BACK TO BAG", "/cart", "paytm-failed-bag"],
  ])("resumed, then a terminal 'cancelled' (not paid) → %s lands on %s and STAYS: the dead session never re-arms the guard", async (_label, to, exit) => {
    kiosk();
    open("edc");
    gw.statusReply = answer("cancelled");
    renderApp("/payment");
    expect(journey).toEqual(["/payment", "/paymentPolling"]);
    expect(screen.getByTestId("paytm-screen")).toBeInTheDocument();

    await advance(3000); // the first poll answers "cancelled"
    expect(screen.getByTestId("paytm-failed")).toBeInTheDocument();
    tap(exit);
    await step(10_000);

    expect(here()).toMatchObject({ name: to.slice(1), path: to });
    expect(journey).toEqual(["/payment", "/paymentPolling", to]);
    expect(readOpenPaytmSession(payment())).toBeNull();
    expect(gw.status).toHaveLength(1);
  });

  it("resumed, then a customer cancel (EDC): fresh pending read → ONE void (same ids) → 'cancelled' → /payment, which renders and STAYS", async () => {
    kiosk();
    open("edc");
    renderApp("/receipt");
    expect(journey).toEqual(["/receipt", "/paymentPolling"]);

    tap("paytm-cancel");
    tap("paytm-cancel-yes");
    await advance(0); // the fresh read is pending → the void reaches the terminal
    expect(gw.voids).toEqual([
      { deployment_id: "dep1", posBillNo: BILL, posBillTime: expect.any(Number), deviceId: "EDC-1" },
    ]);
    gw.statusReply = answer("cancelled");
    await step(13_000);

    expect(here()).toMatchObject({ name: "payment", path: "/payment" });
    expect(journey).toEqual(["/receipt", "/paymentPolling", "/payment"]);
    expect(readOpenPaytmSession(payment())).toBeNull();
    expect(gw.voids).toHaveLength(1);
    expect(gw.status.every((body) => body.posBillNo === BILL)).toBe(true);
  });

  it("resumed, then paid → Order Complete, and nothing ever navigates back", async () => {
    kiosk();
    open("dqr");
    gw.statusReply = answer("paid");
    renderApp("/receipt");
    await step(13_000);

    expect(here()).toMatchObject({ name: "orderSuccess", path: "/orderSuccess" });
    expect(journey).toEqual(["/receipt", "/paymentPolling", "/orderSuccess"]);
    expect(gw.status).toHaveLength(1); // nothing reads after "paid"
  });

  it("resumed with its credentials gone: the staff panel at once (never bounced back), FINISH → /start", async () => {
    kiosk([DQR_ROW]);
    open("edc");
    renderApp("/payment");
    expect(screen.getByTestId("paytm-unknown")).toBeInTheDocument();
    await step(10_000);
    expect(journey).toEqual(["/payment", "/paymentPolling"]);

    tap("paytm-unknown-finish");
    expect(here()).toMatchObject({ name: "start", path: "/start" });
    expect(journey).toEqual(["/payment", "/paymentPolling", "/start"]);
    expect(gw.status).toHaveLength(0);
  });

  it.each([
    ["with a bag", "/payment", true],
    ["without a bag", "/menu", false],
  ])("a stale /paymentPolling URL with no open session (%s): ONE redirect to %s, never back", async (_label, to, bag) => {
    kiosk(undefined, bag);
    arm("PAY_AT_RESTAURANT");
    renderApp("/paymentPolling");
    await step(10_000);

    expect(here()).toMatchObject({ path: to });
    expect(journey).toEqual(["/paymentPolling", to]);
    expect(gw.status).toHaveLength(0);
  });

  it("Rule 3 (F3): resumed sessions that end paid / cancelled by the guest / not paid / unknown (EDC and DQR) leave analytics only order_id + payment_type — never posBillTime, the QR, mid, secret or device id — and log no session field at all", async () => {
    // Pass-through spies: every console call the flows make is kept.
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    const times: number[] = [];
    const run = async (kind: "edc" | "dqr", rows: unknown[], drive: () => Promise<void>) => {
      store.dispatch({ type: "RESET_STATE" });
      journey.length = 0;
      kiosk(rows);
      open(kind);
      times.push(Number(payment().posBillTime));
      const view = renderApp("/receipt");
      await drive();
      view.unmount();
    };

    gw.statusReply = answer("paid");
    await run("dqr", [EDC_ROW, DQR_ROW], () => step(4_000));
    gw.statusReply = answer("pending");
    await run("edc", [EDC_ROW, DQR_ROW], async () => {
      tap("paytm-cancel");
      tap("paytm-cancel-yes");
      await advance(0);
      gw.statusReply = answer("cancelled");
      await step(4_000);
    });
    gw.statusReply = answer("cancelled");
    await run("dqr", [EDC_ROW, DQR_ROW], () => step(4_000));
    await run("edc", [DQR_ROW], () => step(1_000)); // credentials gone → unknown
    await run("dqr", [EDC_ROW], () => step(1_000)); // the same for DQR, whose session holds the QR
    const logged = inspect(logs.map((spy) => spy.mock.calls), { depth: 8 });
    logs.forEach((spy) => spy.mockRestore());

    const names = gw.events.map(([name]) => name);
    expect(new Set(names)).toEqual(
      new Set(["payment_successful", "payment_cancelled_by_user", "payment_failed", "error_occurred"]),
    );
    const sent = leaves(gw.events.map(([, props]) => props));
    // The contract's two (P8b-05/06/12): the bill number as order_id, the type as payment_type.
    expect(new Set(sent.filter(([, v]) => v === BILL).map(([k]) => k))).toEqual(new Set(["order_id"]));
    expect(
      new Set(sent.filter(([, v]) => v === "PaytmEdc" || v === "PaytmDynamicQr").map(([k]) => k)),
    ).toEqual(new Set(["payment_type"]));
    for (const time of times) {
      expect(sent.filter(([, v]) => v === time || v === String(time)), `posBillTime ${time}`).toEqual([]);
    }
    const text = JSON.stringify(sent);
    for (const secret of [QR, "upi://", "MID-1", "KEY-1", "EDC-1"]) expect(text).not.toContain(secret);
    // Never logged: no session field (bill no, time, type, QR) and no credential.
    for (const value of [BILL, ...times.map(String), "PaytmEdc", "PaytmDynamicQr", QR, "upi://", "MID-1", "KEY-1", "EDC-1"]) {
      expect(logged, `console carried ${value}`).not.toContain(value);
    }
  });

  // Every combination of the four fields readOpenPaytmSession reads, entered
  // on all three routes: at most ONE hop, then still — and it settles where
  // that one shared definition says (no ping-pong between the two screens).
  const TYPES = ["", "PAY_AT_RESTAURANT", "Geidea", "PaytmEdc", "PaytmDynamicQr"];
  const BILLS = ["", "  ", BILL];
  const TIMES: Array<number | "" | "now"> = ["", 0, "now"];
  const CODES = ["", QR];
  const GRID = TYPES.flatMap((type) =>
    BILLS.flatMap((bill) => TIMES.flatMap((time) => CODES.map((code) => ({ type, bill, time, code })))),
  );

  it(`the state grid (${GRID.length} states) × /payment, /receipt, /paymentPolling: at most one hop, and it settles where readOpenPaytmSession says`, async () => {
    let resumed = 0;
    for (const start of ["/payment", "/receipt", "/paymentPolling"]) {
      for (const cell of GRID) {
        store.dispatch({ type: "RESET_STATE" });
        journey.length = 0;
        gw.status.length = 0;
        kiosk();
        arm(cell.type);
        store.dispatch(
          setBillPaymentInfo({ posBillNo: cell.bill, posBillTime: cell.time === "now" ? Date.now() : cell.time }),
        );
        store.dispatch(setPaytmQrCode(cell.code));
        const isOpen = readOpenPaytmSession(payment()) !== null;

        const view = renderApp(start);
        await advance(3000);
        await advance(3000);

        const settle = isOpen ? "/paymentPolling" : start === "/paymentPolling" ? "/payment" : start;
        const label = `${start} ${JSON.stringify(cell)}`;
        expect(journey, label).toEqual(settle === start ? [start] : [start, settle]);
        if (isOpen) {
          resumed += 1;
          expect(screen.getByTestId("paytm-screen"), label).toBeInTheDocument();
        } else {
          expect(gw.status, label).toEqual([]);
        }
        view.unmount();
      }
    }
    // Open: EDC with ids (QR or not) and DQR with ids + QR — on each route.
    expect(resumed).toBe(3 * 3);
  }, 120_000);
});
