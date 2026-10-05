import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  markAsUpdateDone,
  receivedUpdateNotif,
  setFcmKeyAutoUpdateRdx,
  setShouldRegisterFcm,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../../redux/app/store";
import useFcmRegistration, { readFcmConfig } from "../useFcmRegistration";

/*
  P9e — FCM remote brand updates. The hook is gated (registration latch,
  the five VITE_FIREBASE_* values, PRE-GRANTED notification permission,
  isSupported) and must never prompt, never throw and never leak the token.

  Seam: ./fcmRuntime re-exports firebase and is loaded with import(). The
  firebase PACKAGES are mocked rather than ./fcmRuntime itself: StrictMode
  runs the effect twice, the two import()s are concurrent, and Vitest 5
  hands the second concurrent import of a vi.mock-ed RELATIVE module the
  real file (verified) — whose re-exports then resolve to these mocks.
  The gates and a failing import (vi.doMock, which slows every later import
  in its file) live in useFcmRegistrationGates.test.tsx.
*/

const h = vi.hoisted(() => ({
  isSupported: vi.fn(),
  getApps: vi.fn(),
  initializeApp: vi.fn(),
  getMessaging: vi.fn(),
  onMessage: vi.fn(),
  getToken: vi.fn(),
  unsubscribe: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  requestPermission: vi.fn(),
  order: [] as string[],
  handler: undefined as
    | undefined
    | ((payload: { data?: unknown; messageId?: string }) => void),
}));

vi.mock("firebase/app", () => ({
  getApps: h.getApps,
  initializeApp: h.initializeApp,
}));
vi.mock("firebase/messaging", () => ({
  isSupported: h.isSupported,
  getMessaging: h.getMessaging,
  onMessage: h.onMessage,
  getToken: h.getToken,
}));
vi.mock("../../autoUpdates/useAutoUpdate", () => ({
  default: () => ({ registerFCMTokenToServer: h.register }),
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => h.capture(...args),
}));

const TOKEN = "fcm-token-SECRET-42";
const ENV = {
  VITE_FIREBASE_API_KEY: "api-key",
  VITE_FIREBASE_PROJECT_ID: "project-id",
  VITE_FIREBASE_APP_ID: "1:123:web:abc",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_VAPID_KEY: "vapid-key",
} as const;
const CONFIG = {
  apiKey: "api-key",
  projectId: "project-id",
  appId: "1:123:web:abc",
  messagingSenderId: "123",
  vapidKey: "vapid-key",
};
const MESSAGING = { messaging: "instance" };

const seam = window as unknown as { __TB_FCM_ENV__?: Record<string, unknown> };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);
const mount = (reactStrictMode = false) =>
  renderHook(() => useFcmRegistration(), { wrapper, reactStrictMode });
const setPermission = (permission: NotificationPermission) =>
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: h.requestPermission,
  });
/** Drains the hook's import → isSupported → getToken → register chain. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const autoUpdate = () => store.getState().autoUpdate;
const events = (source: string) =>
  h.capture.mock.calls
    .map(([, props]) => props as Record<string, unknown>)
    .filter((props) => props?.error_source === source);
const push = (payload: { data?: unknown; messageId?: string }) =>
  act(() => {
    if (!h.handler) throw new Error("no live onMessage handler");
    h.handler(payload);
  });

beforeAll(async () => {
  // Warm the module cache so the hook's import() settles in microtasks
  // (fake-timer tests cannot wait for module I/O).
  await import("../fcmRuntime");
});

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  for (const fn of Object.values(h)) {
    if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  }
  h.order.length = 0;
  h.handler = undefined;
  h.isSupported.mockImplementation(async () => {
    h.order.push("isSupported");
    return true;
  });
  h.getApps.mockReturnValue([]);
  h.initializeApp.mockImplementation((options: unknown) => ({ app: options }));
  h.getMessaging.mockImplementation(() => {
    h.order.push("getMessaging");
    return MESSAGING;
  });
  h.onMessage.mockImplementation((_messaging: unknown, next: typeof h.handler) => {
    h.order.push("onMessage");
    h.handler = next;
    return h.unsubscribe;
  });
  h.getToken.mockImplementation(async () => {
    h.order.push("getToken");
    return TOKEN;
  });
  h.register.mockResolvedValue(true);
  seam.__TB_FCM_ENV__ = { ...ENV };
  setPermission("granted");
  store.dispatch(setShouldRegisterFcm());
});

afterEach(() => {
  // NEVER prompts and NEVER leaks the token — in every test (fork D1, Rule 3).
  expect(h.requestPermission).not.toHaveBeenCalled();
  expect(JSON.stringify(h.capture.mock.calls)).not.toContain(TOKEN);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete seam.__TB_FCM_ENV__;
});

describe("readFcmConfig — the five values FCM web needs", () => {
  it("all five present → the exact config (trimmed); the three unread Firebase keys are not needed", () => {
    expect(readFcmConfig({ ...ENV })).toEqual(CONFIG);
    expect(
      readFcmConfig({ ...ENV, VITE_FIREBASE_API_KEY: "  api-key  " })?.apiKey
    ).toBe("api-key");
  });

  it.each(Object.keys(ENV))("%s missing, blank, whitespace or not a string → null (FCM off)", (key) => {
    for (const bad of [undefined, "", "   ", 7, null, true]) {
      expect(readFcmConfig({ ...ENV, [key]: bad })).toBeNull();
    }
  });

  it("the env fallback (no DEV seam) reads exactly the five VITE_FIREBASE_* names", () => {
    delete seam.__TB_FCM_ENV__;
    expect(readFcmConfig()).toBeNull(); // this tree configures no Firebase

    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "x.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "x.appspot.com");
    vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "G-1");
    expect(readFcmConfig()).toBeNull();

    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    expect(readFcmConfig()).toEqual(CONFIG);
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "");
    expect(readFcmConfig()).toBeNull();
  });

  it("the source names every env key it reads: a bare import.meta.env would make Vite inline EVERY VITE_* value into the entry chunk", () => {
    // A build-time property no runtime test can observe (fixer F1), hence
    // the static check.
    const source = readFileSync(
      join(import.meta.dirname, "../useFcmRegistration.ts"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const reads = [...source.matchAll(/import\.meta\.env\b(\.\w+)?/g)].map(
      ([, member]) => member ?? "<bare>"
    );
    expect(new Set(reads)).toEqual(
      new Set([".DEV", ...Object.keys(ENV).map((key) => `.${key}`)])
    );
  });
});

describe("useFcmRegistration — the open path", () => {
  it("isSupported → getMessaging → onMessage BEFORE getToken; getToken gets the VAPID key and NO serviceWorkerRegistration", async () => {
    mount();
    await settle();

    expect(h.order).toEqual(["isSupported", "getMessaging", "onMessage", "getToken"]);
    expect(h.initializeApp).toHaveBeenCalledWith({
      apiKey: "api-key",
      projectId: "project-id",
      appId: "1:123:web:abc",
      messagingSenderId: "123",
    });
    expect(h.getMessaging).toHaveBeenCalledWith({ app: expect.any(Object) });
    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(h.getToken.mock.calls[0][0]).toBe(MESSAGING);
    // Firebase must register public/firebase-messaging-sw.js itself and wait
    // for it to activate — a passed registration skips that wait.
    expect(h.getToken.mock.calls[0][1]).toStrictEqual({ vapidKey: "vapid-key" });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("reuses an already-initialised firebase app", async () => {
    const existing = { app: "existing" };
    h.getApps.mockReturnValue([existing]);
    mount();
    await settle();

    expect(h.initializeApp).not.toHaveBeenCalled();
    expect(h.getMessaging).toHaveBeenCalledWith(existing);
  });

  it("isSupported false → getMessaging never runs; exactly one 'unsupported' event", async () => {
    h.isSupported.mockResolvedValue(false);
    mount();
    await settle();

    expect(h.getMessaging).not.toHaveBeenCalled();
    expect(h.onMessage).not.toHaveBeenCalled();
    expect(h.capture.mock.calls).toEqual([
      [
        "error_occurred",
        { error_source: "fcm_init", stage: "unsupported", timed_out: false, error_name: "none", error_code: "" },
      ],
    ]);
  });

  it("permission revoked during the awaits → getToken is never called (it would prompt); the handler stays live", async () => {
    h.isSupported.mockImplementation(async () => {
      setPermission("default");
      return true;
    });
    mount();
    await settle();

    expect(h.onMessage).toHaveBeenCalledTimes(1);
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
  });

  it("a synchronous throw inside the chain (getMessaging) → one 'init' event, no throw", async () => {
    h.getMessaging.mockImplementation(() => {
      throw Object.assign(new Error("bad config"), { code: "messaging/missing-app-config-values" });
    });
    mount();
    await settle();

    expect(events("fcm_init")).toEqual([
      expect.objectContaining({ stage: "init", error_name: "Error", error_code: "messaging/missing-app-config-values" }),
    ]);
    expect(h.register).not.toHaveBeenCalled();
  });
});

describe("messages — only a device_update_id raises the brand flag (fork D7)", () => {
  it("a push with an id dispatches exactly receivedUpdateNotif({ shouldBrandUpdate: true, device_update_id })", async () => {
    const dispatch = vi.spyOn(store, "dispatch"); // before mount: the hook keeps the dispatch it rendered with
    mount();
    await settle();
    dispatch.mockClear();

    push({ data: { device_update_id: "upd-1" }, messageId: "m-1" });

    expect(dispatch.mock.calls).toEqual([
      [receivedUpdateNotif({ shouldBrandUpdate: true, device_update_id: "upd-1" })],
    ]);
    expect(autoUpdate().shouldBrandUpdate).toBe(true);
    expect(autoUpdate().device_update_id).toBe("upd-1");
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("a push without a usable id dispatches NOTHING and emits one fcm_message event each", async () => {
    const dispatch = vi.spyOn(store, "dispatch");
    mount();
    await settle();
    dispatch.mockClear();
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile payload");
        },
      }
    );

    for (const data of [undefined, null, {}, { device_update_id: "" }, { device_update_id: "   " }, { device_update_id: 7 }, throwing]) {
      push({ data, messageId: "m-junk" });
    }

    expect(dispatch).not.toHaveBeenCalled();
    expect(autoUpdate().shouldBrandUpdate).toBe(false);
    expect(h.capture.mock.calls).toEqual(
      Array.from({ length: 7 }, () => [
        "error_occurred",
        { error_source: "fcm_message", reason: "no_device_update_id", message_id: "m-junk" },
      ])
    );
  });

  it("a mint failure leaves the subscribed handler live: a push still raises the flag", async () => {
    h.getToken.mockRejectedValue(
      Object.assign(new Error("boom"), { code: "messaging/token-subscribe-failed" })
    );
    mount();
    await settle();

    expect(events("fcm_init")).toEqual([
      { error_source: "fcm_init", stage: "token", timed_out: false, error_name: "Error", error_code: "messaging/token-subscribe-failed" },
    ]);
    expect(h.register).not.toHaveBeenCalled();

    push({ data: { device_update_id: "upd-2" }, messageId: "m-2" });
    expect(autoUpdate().device_update_id).toBe("upd-2");
  });
});

describe("the token — registered with the backend, stored only once it took it (fork D5)", () => {
  it("register → true: setFcmKeyAutoUpdateRdx(token) dispatched only AFTER register resolves; register once", async () => {
    const answer = deferred<boolean>();
    h.register.mockReturnValue(answer.promise);
    const dispatch = vi.spyOn(store, "dispatch");
    mount();
    await settle();

    expect(h.register.mock.calls).toEqual([[TOKEN]]);
    expect(dispatch).not.toHaveBeenCalledWith(setFcmKeyAutoUpdateRdx(TOKEN));
    expect(autoUpdate().fcmKey).toBe("");

    answer.resolve(true);
    await settle();

    expect(dispatch.mock.calls.filter(([action]) => action.type === setFcmKeyAutoUpdateRdx.type)).toEqual([
      [setFcmKeyAutoUpdateRdx(TOKEN)],
    ]);
    expect(autoUpdate().fcmKey).toBe(TOKEN);
    expect(h.register).toHaveBeenCalledTimes(1);
  });

  it("register → false: the token is NOT stored (the next page load re-registers)", async () => {
    h.register.mockResolvedValue(false);
    mount();
    await settle();

    expect(h.register).toHaveBeenCalledTimes(1);
    expect(autoUpdate().fcmKey).toBe("");
  });

  it("logout (RESET_STATE) while the register POST is in flight → the token is not stored", async () => {
    const answer = deferred<boolean>();
    h.register.mockReturnValue(answer.promise);
    mount();
    await settle();

    act(() => {
      store.dispatch({ type: "RESET_STATE" });
    });
    answer.resolve(true);
    await settle();

    expect(autoUpdate().fcmKey).toBe("");
  });
});

describe("a slow mint — reported at 10 s, its late token still registered (fixer F2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const fcmInit = () => events("fcm_init");

  it("a token landing at 12 s: ONE timed-out report at 10 s, then registered once and stored — from the SAME getToken", async () => {
    h.getToken.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(TOKEN), 12_000))
    );
    mount();
    await settle();

    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(fcmInit()).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fcmInit()).toEqual([
      expect.objectContaining({ stage: "token", timed_out: true, error_name: "TimeoutError" }),
    ]);
    expect(h.register).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await settle();

    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(h.register.mock.calls).toEqual([[TOKEN]]);
    expect(autoUpdate().fcmKey).toBe(TOKEN);
    expect(fcmInit()).toHaveLength(1);
  });

  it("a mint that never settles: the timed-out report, no register, no retry", async () => {
    h.getToken.mockImplementation(() => new Promise(() => {}));
    mount();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await settle();

    expect(fcmInit()).toEqual([
      expect.objectContaining({ stage: "token", timed_out: true, error_name: "TimeoutError" }),
    ]);
    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(h.register).not.toHaveBeenCalled();
  });

  it("a mint that REJECTS after the bound: still one timed-out report, no register, no unhandled rejection", async () => {
    h.getToken.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("late boom")), 12_000))
    );
    mount();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(13_000));
    await settle();

    expect(fcmInit()).toEqual([expect.objectContaining({ stage: "token", timed_out: true })]);
    expect(h.register).not.toHaveBeenCalled();
    expect(autoUpdate().fcmKey).toBe("");
  });

  it("the latch drops while a late mint is pending → the late token is neither registered nor stored", async () => {
    h.getToken.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(TOKEN), 12_000))
    );
    mount();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(10_001));

    act(() => {
      store.dispatch({ type: "RESET_STATE" });
    });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await settle();

    expect(h.register).not.toHaveBeenCalled();
    expect(autoUpdate().fcmKey).toBe("");
  });
});

describe("lifecycle — exactly one live handler (fork D4)", () => {
  it("StrictMode: getMessaging, onMessage, getToken and register run ONCE; that one handler is live", async () => {
    mount(true);
    await settle();

    expect(h.isSupported).toHaveBeenCalledTimes(1); // the cancelled run stops right after its import
    expect(h.getMessaging).toHaveBeenCalledTimes(1);
    expect(h.onMessage).toHaveBeenCalledTimes(1);
    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.unsubscribe).not.toHaveBeenCalled();

    push({ data: { device_update_id: "upd-strict" }, messageId: "m-s" });
    expect(autoUpdate().device_update_id).toBe("upd-strict");
  });

  it("unmount unsubscribes the handler", async () => {
    const view = mount();
    await settle();
    expect(h.unsubscribe).not.toHaveBeenCalled();

    view.unmount();

    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("the latch drops (RESET_STATE) mid-mint → unsubscribed; the token resolving afterwards is neither registered nor stored", async () => {
    const mint = deferred<string>();
    h.getToken.mockReturnValue(mint.promise);
    mount();
    await settle();
    expect(h.onMessage).toHaveBeenCalledTimes(1);

    act(() => {
      store.dispatch({ type: "RESET_STATE" });
    });
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);

    mint.resolve(TOKEN);
    await settle();

    expect(h.register).not.toHaveBeenCalled();
    expect(autoUpdate().fcmKey).toBe("");
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("a brand push after markAsUpdateDone raises the flag again (the handler is not one-shot)", async () => {
    mount();
    await settle();

    push({ data: { device_update_id: "upd-a" }, messageId: "m-a" });
    act(() => {
      store.dispatch(markAsUpdateDone());
    });
    push({ data: { device_update_id: "upd-b" }, messageId: "m-b" });

    expect(autoUpdate().shouldBrandUpdate).toBe(true);
    expect(autoUpdate().device_update_id).toBe("upd-b");
  });
});
