import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { setShouldRegisterFcm } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../../redux/app/store";
import useFcmRegistration from "../useFcmRegistration";

/*
  P9e — FCM gates (fork D1/D2). While ANY gate is closed — the registration
  latch, the five VITE_FIREBASE_* values, a Notification API with permission
  PRE-granted — the firebase chunk is never imported and nothing can prompt
  (getToken itself calls requestPermission on "default"). A firebase chunk
  that fails to load turns FCM off quietly. Each test re-registers the seam
  with vi.doMock, so its factory runs on this test's first import(): that is
  how "never imported" is observed. (doMock slows every later import in the
  file, which is why the timing-sensitive suite lives in its own file.)
*/

const h = vi.hoisted(() => ({
  isSupported: vi.fn(),
  getToken: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  requestPermission: vi.fn(),
  imports: 0,
}));

vi.mock("../../autoUpdates/useAutoUpdate", () => ({
  default: () => ({ registerFCMTokenToServer: h.register }),
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => h.capture(...args),
}));

const RUNTIME = "../fcmRuntime";
const ENV = {
  VITE_FIREBASE_API_KEY: "api-key",
  VITE_FIREBASE_PROJECT_ID: "project-id",
  VITE_FIREBASE_APP_ID: "1:123:web:abc",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_VAPID_KEY: "vapid-key",
};
const seam = window as unknown as { __TB_FCM_ENV__?: Record<string, unknown> };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);
const mount = () => renderHook(() => useFcmRegistration(), { wrapper });
const setPermission = (permission: NotificationPermission) =>
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: h.requestPermission,
  });
/** Real wall time: a re-registered module import does I/O. */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  for (const fn of [h.isSupported, h.getToken, h.register, h.capture, h.requestPermission]) {
    fn.mockReset();
  }
  h.imports = 0;
  h.isSupported.mockResolvedValue(true);
  h.getToken.mockResolvedValue("fcm-token");
  h.register.mockResolvedValue(true);
  vi.doMock(RUNTIME, () => {
    h.imports += 1;
    return {
      isSupported: h.isSupported,
      getApps: () => [],
      initializeApp: (options: unknown) => ({ app: options }),
      getMessaging: () => ({ messaging: "instance" }),
      onMessage: () => () => {},
      getToken: h.getToken,
    };
  });
  seam.__TB_FCM_ENV__ = { ...ENV };
  setPermission("granted");
  store.dispatch(setShouldRegisterFcm());
});

afterEach(() => {
  expect(h.requestPermission).not.toHaveBeenCalled(); // NEVER prompts
  vi.doUnmock(RUNTIME);
  vi.unstubAllGlobals();
  delete seam.__TB_FCM_ENV__;
});

describe("useFcmRegistration gates — any one closed ⇒ no import, no prompt, no event", () => {
  it("control: every gate open → the seam is imported once, a token minted and registered", async () => {
    mount();
    await settle();

    expect(h.imports).toBe(1);
    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(h.register).toHaveBeenCalledWith("fcm-token");
  });

  it.each([
    ["the registration latch is down (never registered, or RESET_STATE)", () => store.dispatch({ type: "RESET_STATE" })],
    ["a config value is blank", () => (seam.__TB_FCM_ENV__ = { ...ENV, VITE_FIREBASE_VAPID_KEY: " " })],
    ["the browser has no Notification API", () => vi.stubGlobal("Notification", undefined)],
    ["permission is 'default' (getToken would PROMPT)", () => setPermission("default")],
    ["permission is 'denied'", () => setPermission("denied")],
  ])("%s", async (_label, closeGate) => {
    closeGate();
    mount();
    await settle();

    expect(h.imports).toBe(0);
    expect(h.isSupported).not.toHaveBeenCalled();
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("the latch rising later (registration completes) starts FCM then — no reload needed", async () => {
    store.dispatch({ type: "RESET_STATE" });
    mount();
    await settle();
    expect(h.imports).toBe(0);

    act(() => {
      store.dispatch(setShouldRegisterFcm());
    });
    await settle();

    expect(h.imports).toBe(1);
    expect(h.register).toHaveBeenCalledTimes(1);
  });
});

describe("useFcmRegistration — the firebase chunk fails to load", () => {
  it.each([
    ["rejects (dev: the module failed to fetch)", () => {
      throw new TypeError("Failed to fetch dynamically imported module: /assets/fcmRuntime-AbC.js");
    }],
    ["resolves nothing (build: chunkRecovery preventDefault()s the preload error)", () => undefined as never],
  ])("the import %s → FCM off: ONE 'import' event, nothing else, no throw", async (_label, factory) => {
    vi.doMock(RUNTIME, factory);
    mount();
    await settle();

    expect(h.capture.mock.calls).toEqual([
      [
        "error_occurred",
        { error_source: "fcm_init", stage: "import", timed_out: false, error_name: "none", error_code: "" },
      ],
    ]);
    expect(h.isSupported).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
  });
});
