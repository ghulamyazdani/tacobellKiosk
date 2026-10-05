import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import {
  apiSlice,
  configureKioskTransport,
  type KioskTransportConfig,
} from "@cx-sdk/core/transport/kioskApi";
import { menuApi } from "@cx-sdk/catalog/services/menuApi";
import { settingsApi } from "@cx-sdk/catalog/services/settingsApi";
import { autoUpdateApi } from "@cx-sdk/devices/updates/services/autoUpdateApi";
import { isTimeoutError, TimeoutError } from "@cx-sdk/core";
import { classifyAuthenticationFailure } from "@cx-sdk/core/auth/authPolicy";
import {
  ORDER_PUSH_MAX_ATTEMPTS,
  isOrderPushOutcomeUnknown,
  shouldRetryOrderPush,
} from "@cx-sdk/payments/settlement/settlementRules";
import {
  BACKGROUND_TELEMETRY_ENDPOINTS,
  KIOSK_REQUEST_TIMEOUT_MS,
  MENU_DOWNLOAD_TIMEOUT_MS,
} from "../redux/app/apiSlice";

/*
  P9b R2/R3 — the host-configured Rule 2 transport budget, run through the
  REAL SDK base query and the REAL RTK 2.12 fetchBaseQuery (TB dedupes RTK, so
  this is the copy the kiosk ships). Only `fetch` is stubbed: a hung backend is
  a fetch that never settles until its signal aborts, which is exactly what a
  browser does. RTK's timeout is a page setTimeout, so vitest's fake clock
  drives it.

  configureKioskTransport is wrapped (not replaced) so TB's own module-scope
  wiring in src/redux/app/apiSlice.ts is captured as-is and every config is
  rebased onto an absolute test origin — Node's Request rejects the relative
  URLs an unset VITE_API_ENDPOINT produces.

  RTK 2.12 never clears its timeout timers, so nothing here asserts on
  vi.getTimerCount().
*/

const wiring = vi.hoisted(() => ({
  origin: "http://kiosk.test",
  tb: undefined as KioskTransportConfig | undefined,
}));

vi.mock("@cx-sdk/core/transport/kioskApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@cx-sdk/core/transport/kioskApi")>();
  return {
    ...actual,
    configureKioskTransport: (config: KioskTransportConfig) => {
      // The first call is TB's apiSlice.ts, run while this file imports it.
      wiring.tb ??= config;
      actual.configureKioskTransport({ ...config, baseUrl: wiring.origin });
    },
  };
});

/** Probe endpoints with no SDK opinion of their own (typed, self-contained). */
const probeApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    probe: build.mutation<unknown, void>({
      query: () => ({ url: "/api/probe", method: "POST", body: {} }),
    }),
    slowProbe: build.mutation<unknown, void>({
      query: () => ({ url: "/api/slow-probe", method: "POST", body: {} }),
    }),
    /** Sets its own FetchArgs timeout, like the SDK's payment polls (5 s). */
    pollProbe: build.mutation<unknown, void>({
      query: () => ({
        url: "/api/poll-probe",
        method: "POST",
        body: {},
        timeout: 5_000,
      }),
    }),
    /** Its own FetchArgs timeout is LONGER than the host budget. */
    longPollProbe: build.mutation<unknown, void>({
      query: () => ({
        url: "/api/long-poll-probe",
        method: "POST",
        body: {},
        timeout: 20_000,
      }),
    }),
    /** The one URL the 401 recovery is exempt for (legacy). */
    otpProbe: build.mutation<unknown, void>({
      query: () => ({
        url: "/api/onlineordersecured/checkMobileForQR",
        method: "POST",
        body: {},
      }),
    }),
    /** D2 matches the RTK endpoint NAME: the version report's URL under another name. */
    renamedTelemetry: build.mutation<unknown, void>({
      query: () => ({ url: "/api/cx/update_cx_software", method: "POST", body: {} }),
    }),
    /** An exempt name as a PREFIX: exact matching only. */
    updateCxFcmKeyV2: build.mutation<unknown, void>({
      query: () => ({ url: "/api/probe-v2", method: "POST", body: {} }),
    }),
    /** An exempt name in another case: exact matching only. */
    updatecxfcmkey: build.mutation<unknown, void>({
      query: () => ({ url: "/api/probe-lower", method: "POST", body: {} }),
    }),
  }),
});

const onAuthFailure = vi.fn();
const onServerError = vi.fn();

const configure = (budgets: Partial<KioskTransportConfig> = {}) =>
  configureKioskTransport({
    baseUrl: wiring.origin,
    tokenFallback: () => "token-1",
    onAuthFailure,
    onServerError,
    ...budgets,
  });

const makeStore = () =>
  configureStore({
    reducer: { [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });

let store: ReturnType<typeof makeStore>;

/** fetch stub: every request is recorded; the behaviour is per test. */
const fetchStub = vi.fn<(request: Request) => Promise<Response>>();
const requests = () => fetchStub.mock.calls.map(([request]) => request);

/** A hung backend: never answers; rejects only when the request is aborted. */
const hang = (request: Request) =>
  new Promise<Response>((_, reject) => {
    request.signal.addEventListener(
      "abort",
      () => reject(request.signal.reason),
      { once: true }
    );
  });

/**
 * Headers arrive at once, then the body stalls until the abort — the
 * "server answered, body ran late" case RTK 2.12 reports as PARSING_ERROR.
 */
const headersThenStall = (request: Request) =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"categories":['));
          request.signal.addEventListener(
            "abort",
            () => controller.error(request.signal.reason),
            { once: true }
          );
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

/**
 * An answered request. `url` is set as a browser's would be (the 401
 * exemption reads the RESPONSE url); a constructed Response has none.
 */
const answer = (request: Request, status: number) => {
  const make = (): Response => {
    const response = new Response("{}", {
      status,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: request.url });
    response.clone = make;
    return response;
  };
  return Promise.resolve(make());
};

/** Observe a request's settlement without awaiting it. */
const track = (promise: PromiseLike<unknown>) => {
  const state: { settled: boolean; result: unknown } = {
    settled: false,
    result: undefined,
  };
  void promise.then((result) => {
    state.settled = true;
    state.result = result;
  });
  return state;
};

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** Error status of a settled trigger result. */
const statusOf = (result: unknown) =>
  (result as { error?: { status?: unknown } } | undefined)?.error?.status;

describe("Rule 2 transport budget (P9b R2) — SDK base query + RTK 2.12", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchStub.mockReset();
    fetchStub.mockImplementation(hang);
    vi.stubGlobal("fetch", fetchStub);
    onAuthFailure.mockReset();
    onServerError.mockReset();
    store = makeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("no budget configured = unbounded, exactly the legacy behaviour (the original kiosk passes none)", async () => {
    configure();
    const request = store.dispatch(probeApi.endpoints.probe.initiate());
    const pending = track(request);

    await advance(10 * 60_000);

    expect(pending.settled).toBe(false);
    expect(requests()).toHaveLength(1);
    expect(requests()[0].signal.aborted).toBe(false);

    // Release the hung request so nothing outlives the test.
    request.abort();
    await advance(0);
    expect(pending.settled).toBe(true);
  });

  it("requestTimeoutMs bounds every request: still pending at 9 999 ms, TIMEOUT_ERROR (a string) at 10 000 ms", async () => {
    configure({ requestTimeoutMs: 10_000 });
    const pending = track(store.dispatch(probeApi.endpoints.probe.initiate()));

    await advance(9_999);
    expect(pending.settled).toBe(false);

    await advance(1);
    expect(pending.settled).toBe(true);
    expect(statusOf(pending.result)).toBe("TIMEOUT_ERROR");
    expect(isTimeoutError((pending.result as { error: unknown }).error)).toBe(
      true
    );
    // The network request itself is cancelled, not just abandoned.
    expect(requests()[0].signal.aborted).toBe(true);
    expect((requests()[0].signal.reason as Error).name).toBe("TimeoutError");
  });

  it("endpointTimeoutsMs wins for its endpoint (by RTK endpoint name); the rest keep requestTimeoutMs", async () => {
    configure({ requestTimeoutMs: 10_000, endpointTimeoutsMs: { slowProbe: 30_000 } });
    const slow = track(store.dispatch(probeApi.endpoints.slowProbe.initiate()));
    const normal = track(store.dispatch(probeApi.endpoints.probe.initiate()));

    await advance(10_000);
    expect(statusOf(normal.result)).toBe("TIMEOUT_ERROR");
    expect(slow.settled).toBe(false);

    await advance(19_999);
    expect(slow.settled).toBe(false);

    await advance(1);
    expect(statusOf(slow.result)).toBe("TIMEOUT_ERROR");
  });

  it("endpointTimeoutsMs alone bounds only its endpoints; everything else stays unbounded", async () => {
    configure({ endpointTimeoutsMs: { slowProbe: 30_000 } });
    const normalRequest = store.dispatch(probeApi.endpoints.probe.initiate());
    const normal = track(normalRequest);
    const slow = track(store.dispatch(probeApi.endpoints.slowProbe.initiate()));

    await advance(30_000);
    expect(statusOf(slow.result)).toBe("TIMEOUT_ERROR");

    await advance(10 * 60_000);
    expect(normal.settled).toBe(false);

    normalRequest.abort();
    await advance(0);
  });

  it("an endpoint's own FetchArgs timeout wins over BOTH host budgets (RTK reads timeout = default per request)", async () => {
    configure({
      requestTimeoutMs: 10_000,
      endpointTimeoutsMs: { pollProbe: 60_000 },
    });
    const poll = track(store.dispatch(probeApi.endpoints.pollProbe.initiate()));

    await advance(4_999);
    expect(poll.settled).toBe(false);

    await advance(1);
    expect(statusOf(poll.result)).toBe("TIMEOUT_ERROR");
  });

  it("…including a LONGER one: the endpoint's own value wins, it is not min(host, endpoint)", async () => {
    configure({ requestTimeoutMs: 10_000 });
    const poll = track(store.dispatch(probeApi.endpoints.longPollProbe.initiate()));

    await advance(10_000);
    expect(poll.settled).toBe(false);

    await advance(10_000);
    expect(statusOf(poll.result)).toBe("TIMEOUT_ERROR");
  });

  it("a body that runs late is aborted too and surfaces as PARSING_ERROR — still classified as a timeout", async () => {
    configure({ requestTimeoutMs: 10_000 });
    fetchStub.mockImplementation(headersThenStall);
    const pending = track(store.dispatch(probeApi.endpoints.probe.initiate()));

    await advance(9_999);
    expect(pending.settled).toBe(false);

    await advance(1);
    const error = (pending.result as { error: Record<string, unknown> }).error;
    expect(error.status).toBe("PARSING_ERROR");
    expect(error.originalStatus).toBe(200);
    expect(String(error.error)).toMatch(/TimeoutError|signal timed out/);
    expect(isTimeoutError(error)).toBe(true);
  });

  it("a timeout NEVER reaches the session recovery: no onAuthFailure, no onServerError (504/505 de-register the kiosk)", async () => {
    configure({ requestTimeoutMs: 10_000 });
    // Routed by URL: RTK calls fetch a few microtasks after initiate().
    fetchStub.mockImplementation((request) =>
      request.url.endsWith("/slow-probe") ? headersThenStall(request) : hang(request)
    );
    const headers = track(store.dispatch(probeApi.endpoints.probe.initiate()));
    const body = track(store.dispatch(probeApi.endpoints.slowProbe.initiate()));

    await advance(10_000);

    expect(statusOf(headers.result)).toBe("TIMEOUT_ERROR");
    expect(statusOf(body.result)).toBe("PARSING_ERROR");
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(onServerError).not.toHaveBeenCalled();
  });

  describe("session-recovery routing is unchanged (pinned — nothing covered it before)", () => {
    const answeredWith = async (
      status: number,
      endpoint: "probe" | "otpProbe" = "probe"
    ) => {
      configure({ requestTimeoutMs: 10_000 });
      fetchStub.mockImplementation((request) => answer(request, status));
      return store.dispatch(probeApi.endpoints[endpoint].initiate());
    };

    it("504 → onServerError once", async () => {
      const result = await answeredWith(504);
      expect(statusOf(result)).toBe(504);
      expect(onServerError).toHaveBeenCalledTimes(1);
      expect(onAuthFailure).not.toHaveBeenCalled();
    });

    it("505 → onServerError once", async () => {
      await answeredWith(505);
      expect(onServerError).toHaveBeenCalledTimes(1);
    });

    it("401 → onAuthFailure once", async () => {
      await answeredWith(401);
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
      expect(onServerError).not.toHaveBeenCalled();
    });

    it("401 on …/checkMobileForQR is exempt", async () => {
      await answeredWith(401, "otpProbe");
      expect(onAuthFailure).not.toHaveBeenCalled();
    });

    it("500 recovers nothing", async () => {
      await answeredWith(500);
      expect(onAuthFailure).not.toHaveBeenCalled();
      expect(onServerError).not.toHaveBeenCalled();
    });
  });

  describe("TB wiring (src/redux/app/apiSlice.ts)", () => {
    it("configures 10 s for every request and 30 s for getMenu, as named constants", () => {
      expect(KIOSK_REQUEST_TIMEOUT_MS).toBe(10_000);
      expect(MENU_DOWNLOAD_TIMEOUT_MS).toBe(30_000);
      expect(wiring.tb?.requestTimeoutMs).toBe(KIOSK_REQUEST_TIMEOUT_MS);
      expect(wiring.tb?.endpointTimeoutsMs).toEqual({
        getMenu: MENU_DOWNLOAD_TIMEOUT_MS,
      });
    });

    it("live: getMenu (the real SDK endpoint) outlives 10 s and times out at 30 s; getCxSkinData times out at 10 s", async () => {
      configureKioskTransport(wiring.tb as KioskTransportConfig);
      const menu = track(store.dispatch(menuApi.endpoints.getMenu.initiate({})));
      const skin = track(
        store.dispatch(settingsApi.endpoints.getCxSkinData.initiate({}))
      );

      await advance(10_000);
      expect(statusOf(skin.result)).toBe("TIMEOUT_ERROR");
      expect(menu.settled).toBe(false);

      await advance(20_000);
      expect(statusOf(menu.result)).toBe("TIMEOUT_ERROR");
    });
  });
});

/*
  P9e D2 — background update telemetry never tears the session down. A 401 /
  504 / 505 on the FCM-key registration, the version report or the brand ack
  says nothing about the device session (a gateway 504 on a version report
  used to de-register the kiosk). TB lists them by RTK endpoint NAME in
  `recoveryExemptEndpoints`; the caller still sees the error. Run through the
  REAL autoUpdateApi endpoints and TB's REAL wiring (only the recovery
  callbacks are swapped for spies).
*/
describe("D2 — recoveryExemptEndpoints (P9e)", () => {
  type Telemetry = (typeof BACKGROUND_TELEMETRY_ENDPOINTS)[number];

  /** TB's own module-scope config, with spies for the two recovery callbacks. */
  const configureAsTB = () =>
    configureKioskTransport({
      ...(wiring.tb as KioskTransportConfig),
      onAuthFailure,
      onServerError,
    });

  const answering = (status: number) =>
    fetchStub.mockImplementation((request) => answer(request, status));

  const sendTelemetry = (name: Telemetry) =>
    store.dispatch(autoUpdateApi.endpoints[name].initiate({ app: "kiosk" }));

  const EXEMPT_CASES = BACKGROUND_TELEMETRY_ENDPOINTS.flatMap((name) =>
    [401, 504, 505].map((status) => [name, status] as const)
  );

  beforeEach(() => {
    vi.useFakeTimers();
    fetchStub.mockReset();
    fetchStub.mockImplementation(hang);
    vi.stubGlobal("fetch", fetchStub);
    onAuthFailure.mockReset();
    onServerError.mockReset();
    store = makeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(EXEMPT_CASES)(
    "TB wiring: %s answering %i keeps the session — no recovery, and the caller still sees the status",
    async (name, status) => {
      configureAsTB();
      answering(status);

      const result = await sendTelemetry(name);

      expect(statusOf(result)).toBe(status);
      expect(onAuthFailure).not.toHaveBeenCalled();
      expect(onServerError).not.toHaveBeenCalled();
    }
  );

  it.each([401, 504, 505])(
    "TB wiring: every NON-listed endpoint still recovers on %i — probe, the same URL under another name, an exempt name as a prefix or in another case",
    async (status) => {
      configureAsTB();
      answering(status);

      for (const endpoint of [
        "probe",
        "renamedTelemetry",
        "updateCxFcmKeyV2",
        "updatecxfcmkey",
      ] as const) {
        await store.dispatch(probeApi.endpoints[endpoint].initiate());
      }

      expect(onAuthFailure).toHaveBeenCalledTimes(status === 401 ? 4 : 0);
      expect(onServerError).toHaveBeenCalledTimes(status === 401 ? 0 : 4);
    }
  );

  it("TB wiring: the legacy URL rule is untouched — 401 on …/checkMobileForQR stays exempt, its 504 still recovers", async () => {
    configureAsTB();

    answering(401);
    await store.dispatch(probeApi.endpoints.otpProbe.initiate());
    expect(onAuthFailure).not.toHaveBeenCalled();

    answering(504);
    await store.dispatch(probeApi.endpoints.otpProbe.initiate());
    expect(onServerError).toHaveBeenCalledTimes(1);
  });

  it.each(EXEMPT_CASES)(
    "nothing configured (the fork's shape): %s answering %i recovers exactly as before",
    async (name, status) => {
      configure();
      answering(status);

      const result = await sendTelemetry(name);

      expect(statusOf(result)).toBe(status);
      expect(onAuthFailure).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(onServerError).toHaveBeenCalledTimes(status === 401 ? 0 : 1);
    }
  );

  it("an EMPTY exemption list exempts nothing", async () => {
    configure({ recoveryExemptEndpoints: [] });
    answering(504);

    await sendTelemetry("updateCxSoftwareDevice");

    expect(onServerError).toHaveBeenCalledTimes(1);
  });

  it("an exempt endpoint that times out resolves TIMEOUT_ERROR and recovers nothing", async () => {
    configureAsTB();
    const pending = track(sendTelemetry("updateDeviceStatus"));

    await advance(KIOSK_REQUEST_TIMEOUT_MS);

    expect(statusOf(pending.result)).toBe("TIMEOUT_ERROR");
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(onServerError).not.toHaveBeenCalled();
  });

  it("TB wiring lists exactly the three live autoUpdateApi endpoints — not the dead getLastSyncDetails", async () => {
    expect(wiring.tb?.recoveryExemptEndpoints).toBe(BACKGROUND_TELEMETRY_ENDPOINTS);
    expect([...BACKGROUND_TELEMETRY_ENDPOINTS].sort()).toEqual([
      "updateCxFcmKey",
      "updateCxSoftwareDevice",
      "updateDeviceStatus",
    ]);
    // A rename in the SDK drops the exemption silently at runtime: each name
    // must be a real endpoint of the autoUpdate service.
    for (const name of BACKGROUND_TELEMETRY_ENDPOINTS) {
      expect(autoUpdateApi.endpoints).toHaveProperty(name);
    }
    expect(autoUpdateApi.endpoints).toHaveProperty("getLastSyncDetails");
    expect(BACKGROUND_TELEMETRY_ENDPOINTS).not.toContain("getLastSyncDetails");

    // …and they are the three update calls the kiosk makes in the background.
    configureAsTB();
    answering(200);
    for (const name of BACKGROUND_TELEMETRY_ENDPOINTS) {
      await sendTelemetry(name);
    }
    expect(requests().map((request) => new URL(request.url).pathname)).toEqual([
      "/api/cx/update_cx_fcm_key",
      "/api/cx/update_cx_software",
      "/api/cx/update_device_status",
    ]);
  });
});

/*
  The classifiers every consumer routes through (R3, U2/R4, R11). Inputs are
  the shapes callers actually catch: RTK FetchBaseQueryErrors, the SDK's own
  TimeoutError, a fetch rejected by AbortSignal.timeout(), and TB pushOrder's
  `Error(err, { cause: err })` rethrow.
*/
const RTK_TIMEOUT = {
  status: "TIMEOUT_ERROR",
  error: "TimeoutError: signal timed out",
};
const RTK_BODY_TIMEOUT = {
  status: "PARSING_ERROR",
  originalStatus: 200,
  data: "",
  error: "TimeoutError: signal timed out",
};
const RTK_BAD_BODY = {
  status: "PARSING_ERROR",
  originalStatus: 200,
  data: "<html>",
  error: "SyntaxError: Unexpected token '<'",
};
const RTK_BAD_5XX_BODY = { ...RTK_BAD_BODY, originalStatus: 502 };
const RTK_NETWORK = { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" };
/** TB useOrderHook.pushOrder's rethrow. */
const rethrown = (rtkError: unknown) =>
  new Error("[object Object]", { cause: rtkError });

describe("isTimeoutError (P9b R3)", () => {
  const selfReferencing: { status: number; cause?: unknown } = { status: 500 };
  selfReferencing.cause = selfReferencing;

  it.each([
    ["RTK TIMEOUT_ERROR (no headers in budget)", RTK_TIMEOUT, true],
    ["bare { status: TIMEOUT_ERROR }", { status: "TIMEOUT_ERROR" }, true],
    ["RTK 2.12 mid-body abort: PARSING_ERROR + TimeoutError", RTK_BODY_TIMEOUT, true],
    [
      "PARSING_ERROR whose detail only says 'signal timed out' (no DOMException host)",
      { status: "PARSING_ERROR", error: "Error: signal timed out" },
      true,
    ],
    ["the SDK's TimeoutError (withTimeoutRetry)", new TimeoutError(8000), true],
    [
      "a fetch rejected by AbortSignal.timeout()",
      new DOMException("signal timed out", "TimeoutError"),
      true,
    ],
    ["anything named TimeoutError (duck-typed)", { name: "TimeoutError" }, true],
    ["TB pushOrder rethrow of a TIMEOUT_ERROR", rethrown(RTK_TIMEOUT), true],
    ["TB pushOrder rethrow of a mid-body timeout", rethrown(RTK_BODY_TIMEOUT), true],
    [
      "a timeout three causes deep",
      new Error("a", { cause: new Error("b", { cause: rethrown(RTK_TIMEOUT) }) }),
      true,
    ],
    ["PARSING_ERROR from a malformed body", RTK_BAD_BODY, false],
    ["PARSING_ERROR with no detail", { status: "PARSING_ERROR" }, false],
    ["network failure (FETCH_ERROR)", RTK_NETWORK, false],
    ["a manual abort (AbortError)", new DOMException("aborted", "AbortError"), false],
    ["HTTP 504", { status: 504, data: {} }, false],
    ["HTTP 505", { status: 505, data: {} }, false],
    ["HTTP 500", { status: 500, data: {} }, false],
    ["HTTP 401", { status: 401, data: {} }, false],
    ["a plain Error", new Error("placeOrder 500"), false],
    ["a rethrown 504", rethrown({ status: 504 }), false],
    ["a self-referencing cause (terminates)", selfReferencing, false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["the bare string TIMEOUT_ERROR (not an error shape)", "TIMEOUT_ERROR", false],
    ["a number", 504, false],
  ])("%s → %s", (_label, input, expected) => {
    expect(isTimeoutError(input)).toBe(expected);
  });

  it("is re-exported from the @cx-sdk/core barrel (the transport subpath is the same function)", async () => {
    const subpath = await import("@cx-sdk/core/transport/withTimeoutRetry");
    expect(subpath.isTimeoutError).toBe(isTimeoutError);
  });
});

describe("isOrderPushOutcomeUnknown (U2) — the order may exist", () => {
  it.each([
    ["timed out before headers", rethrown(RTK_TIMEOUT), true],
    ["timed out mid-body", rethrown(RTK_BODY_TIMEOUT), true],
    ["placeOrder answered 2xx but the body was lost", rethrown(RTK_BAD_BODY), true],
    [
      "201 with a lost body",
      rethrown({ ...RTK_BAD_BODY, originalStatus: 201 }),
      true,
    ],
    ["the bare RTK error (no rethrow wrapper)", RTK_BAD_BODY, true],
    ["a malformed 5xx body (the server refused)", rethrown(RTK_BAD_5XX_BODY), false],
    [
      "originalStatus as a string is not trusted",
      rethrown({ ...RTK_BAD_BODY, originalStatus: "200" }),
      false,
    ],
    ["network down (FETCH_ERROR)", rethrown(RTK_NETWORK), false],
    ["HTTP 500", rethrown({ status: 500, data: {} }), false],
    ["a plain Error", new Error("placeOrder 500"), false],
    ["undefined", undefined, false],
  ])("%s → %s", (_label, input, expected) => {
    expect(isOrderPushOutcomeUnknown(input)).toBe(expected);
  });
});

describe("shouldRetryOrderPush (U2 ladder rule)", () => {
  it("the ladder still has ORDER_PUSH_MAX_ATTEMPTS = 4", () => {
    expect(ORDER_PUSH_MAX_ATTEMPTS).toBe(4);
  });

  it.each([
    [1, "a clean 500", rethrown({ status: 500 }), true],
    [3, "a clean 500", rethrown({ status: 500 }), true],
    [4, "a clean 500 (exhausted)", rethrown({ status: 500 }), false],
    [1, "network down", rethrown(RTK_NETWORK), true],
    [1, "a timeout", rethrown(RTK_TIMEOUT), false],
    [2, "a mid-body timeout", rethrown(RTK_BODY_TIMEOUT), false],
    [1, "a lost 2xx body", rethrown(RTK_BAD_BODY), false],
    [1, "a malformed 5xx body", rethrown(RTK_BAD_5XX_BODY), true],
  ])("attempt %i after %s → %s", (attempts, _label, error, expected) => {
    expect(shouldRetryOrderPush(attempts, error)).toBe(expected);
  });
});

describe("classifyAuthenticationFailure (R11) — a registration timeout reads as a network failure", () => {
  it.each([
    ["TIMEOUT_ERROR", "FETCH_ERROR"],
    ["FETCH_ERROR", "FETCH_ERROR"],
    [500, "SERVER_ERROR"],
    [400, "UNEXPECTED"],
    ["PARSING_ERROR", "UNEXPECTED"],
    [undefined, "UNEXPECTED"],
  ])("%s → %s", (status, expected) => {
    expect(classifyAuthenticationFailure(status)).toBe(expected);
  });
});
