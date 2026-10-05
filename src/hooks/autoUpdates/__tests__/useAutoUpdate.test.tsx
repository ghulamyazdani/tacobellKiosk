import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markAsUpdateDone,
  receivedUpdateNotif,
  setKioskDeviceVersion,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../../redux/app/store";
import useAutoUpdate from "../useAutoUpdate";

/*
  P9e — the kiosk's update plumbing. The three RTK mutation hooks are the
  seam: each trigger is a spy returning `{ unwrap }`, so a test decides what
  every attempt answers. The real store holds the flags; the clock is fake
  because withTimeoutRetry backs off 400 ms then 1 200 ms and bounds each
  attempt at 10 s. Contract (transport-hook.md §5, §8.1 U2):
  - nothing here ever rejects — every function is fire-and-forget safe;
  - 5xx/network/timeouts are retried twice, terminal 4xx are not;
  - a failure is ONE ErrorOccurred event with the status only — never the
    FCM token, a request body or RTK `data` (Rule 3);
  - the brand flag is lowered synchronously, before the ack's first await.
*/

type Answer = () => Promise<unknown>;

const { api, mockCapture, mockReloadTo } = vi.hoisted(() => ({
  api: {
    fcm: vi.fn<(body: unknown) => { unwrap: () => Promise<unknown> }>(),
    ack: vi.fn<(body: unknown) => { unwrap: () => Promise<unknown> }>(),
    version: vi.fn<(body: unknown) => { unwrap: () => Promise<unknown> }>(),
  },
  mockCapture: vi.fn(),
  mockReloadTo: vi.fn(),
}));

vi.mock("@cx-sdk/devices/updates/services/autoUpdateApi", () => ({
  useUpdateCxFcmKeyMutation: () => [api.fcm],
  useUpdateDeviceStatusMutation: () => [api.ack],
  useUpdateCxSoftwareDeviceMutation: () => [api.version],
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("../../../utils/chunkRecovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/chunkRecovery")>()),
  reloadTo: (path: string) => mockReloadTo(path),
}));

/** Each call to the trigger answers with the next entry; the last repeats. */
const answers = (trigger: typeof api.fcm, ...sequence: Answer[]) => {
  let call = 0;
  trigger.mockImplementation(() => {
    const answer = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return { unwrap: answer };
  });
};

const ok: Answer = () => Promise.resolve({ status: "ok" });
/** An RTK rejection that carries a body echoing secrets — none may reach analytics. */
const fail =
  (status: unknown): Answer =>
  () =>
    Promise.reject({ status, data: { fcm_token: "tok-1", secret: "body" } });
const never: Answer = () => new Promise<never>(() => {});

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);
const mountHook = () => renderHook(() => useAutoUpdate(), { wrapper }).result;

const autoUpdate = () =>
  (
    store.getState() as {
      autoUpdate: {
        shouldBrandUpdate: boolean;
        device_update_id: unknown;
        kioskDeviceVersion: string;
        shouldWholeAppUpdate: boolean;
        shouldDeviceUpdate: boolean;
      };
    }
  ).autoUpdate;

/** Runs every backoff and every 10 s backstop (worst case ≈ 31.6 s). */
const drain = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(40_000);
  });

/** Event props of every captured event. */
const events = () =>
  mockCapture.mock.calls.map(([, props]) => props as Record<string, unknown>);

const pushArrives = (id: unknown) =>
  store.dispatch(receivedUpdateNotif({ shouldBrandUpdate: true, device_update_id: id }));

beforeEach(() => {
  vi.useFakeTimers();
  store.dispatch({ type: "RESET_STATE" });
  api.fcm.mockReset();
  api.ack.mockReset();
  api.version.mockReset();
  mockCapture.mockReset();
  mockReloadTo.mockReset();
  vi.stubEnv("PACKAGE_VERSION", "9.9.9");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useAutoUpdate — the surface", () => {
  it("exposes exactly the five live functions (the fork's dead exports are gone)", () => {
    expect(Object.keys(mountHook().current).sort()).toEqual([
      "applyWholeAppUpdate",
      "checkAndUpdateDeviceVersionDeviceWise",
      "registerFCMTokenToServer",
      "setAutoUpdateOnNextStartOver",
      "updateDeviceUpdateStatus",
    ]);
  });
});

describe("registerFCMTokenToServer", () => {
  it.each([
    ["an empty token", ""],
    ["a blank token", "   "],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
  ])("%s → false with NO POST and no event (D11)", async (_label, token) => {
    const hook = mountHook();

    await expect(hook.current.registerFCMTokenToServer(token as string)).resolves.toBe(false);

    expect(api.fcm).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("a taken token → true; the body is exactly { app, fcm_token }", async () => {
    answers(api.fcm, ok);
    const hook = mountHook();

    await expect(hook.current.registerFCMTokenToServer("tok-1")).resolves.toBe(true);

    expect(api.fcm).toHaveBeenCalledTimes(1);
    expect(api.fcm).toHaveBeenCalledWith({ app: "kiosk", fcm_token: "tok-1" });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("500, 500, then ok → true on the 3rd attempt, after 400 ms then 1 200 ms; no event", async () => {
    answers(api.fcm, fail(500), fail(500), ok);
    const hook = mountHook();

    const pending = hook.current.registerFCMTokenToServer("tok-1");
    await vi.advanceTimersByTimeAsync(399);
    expect(api.fcm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.fcm).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_199);
    expect(api.fcm).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.fcm).toHaveBeenCalledTimes(3);

    await expect(pending).resolves.toBe(true);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("500 ×3 → false and ONE event with the status only", async () => {
    answers(api.fcm, fail(500));
    const hook = mountHook();

    const pending = hook.current.registerFCMTokenToServer("tok-1");
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(api.fcm).toHaveBeenCalledTimes(3);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("error_occurred", {
      error_source: "fcm_token_register",
      error_status: "500",
      timed_out: false,
    });
  });

  it.each([401, 403, 404])("a terminal %i is not retried (1 attempt)", async (status) => {
    answers(api.fcm, fail(status));
    const hook = mountHook();

    const pending = hook.current.registerFCMTokenToServer("tok-1");
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(api.fcm).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      { error_source: "fcm_token_register", error_status: String(status), timed_out: false },
    ]);
  });

  it.each([408, 429, 502, "FETCH_ERROR"])("%s is retried (3 attempts)", async (status) => {
    answers(api.fcm, fail(status));
    const hook = mountHook();

    const pending = hook.current.registerFCMTokenToServer("tok-1");
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(api.fcm).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["the transport's TIMEOUT_ERROR", fail("TIMEOUT_ERROR"), "TIMEOUT_ERROR"],
    [
      "RTK 2.12's mid-body abort (PARSING_ERROR + TimeoutError)",
      () =>
        Promise.reject({
          status: "PARSING_ERROR",
          originalStatus: 200,
          error: "TimeoutError: signal timed out",
        }),
      "PARSING_ERROR",
    ],
    ["an unwrap that never settles (the 10 s backstop)", never, "TimeoutError"],
  ])("%s → retried, reported timed_out: true", async (_label, answer, status) => {
    answers(api.fcm, answer);
    const hook = mountHook();

    const pending = hook.current.registerFCMTokenToServer("tok-1");
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(api.fcm).toHaveBeenCalledTimes(3);
    expect(events()).toEqual([
      { error_source: "fcm_token_register", error_status: status, timed_out: true },
    ]);
  });

  it("a trigger that throws synchronously → false, never a rejection", async () => {
    api.fcm.mockImplementation(() => {
      throw new TypeError("boom");
    });
    const hook = mountHook();

    const pending = hook.current.registerFCMTokenToServer("tok-1");
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(events()).toEqual([
      { error_source: "fcm_token_register", error_status: "TypeError", timed_out: false },
    ]);
  });

  it("no failure event ever carries the token or a response body (Rule 3)", async () => {
    const hook = mountHook();
    for (const answer of [fail(500), fail(401), fail("TIMEOUT_ERROR"), never]) {
      answers(api.fcm, answer);
      const pending = hook.current.registerFCMTokenToServer("tok-1");
      await drain();
      await pending;
    }

    expect(mockCapture).toHaveBeenCalledTimes(4);
    const reported = JSON.stringify(mockCapture.mock.calls);
    expect(reported).not.toContain("tok-1");
    expect(reported).not.toContain("secret");
  });
});

describe("updateDeviceUpdateStatus — the brand-update ack", () => {
  it("lowers the flag SYNCHRONOUSLY, before the POST settles; exact body; true once taken", async () => {
    pushArrives("upd-1");
    let release!: () => void;
    api.ack.mockImplementation(() => ({
      unwrap: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    }));
    const hook = mountHook();

    const pending = hook.current.updateDeviceUpdateStatus();
    // The very next line: no await has run yet (StartScreen navigates here).
    expect(autoUpdate().shouldBrandUpdate).toBe(false);
    expect(api.ack).toHaveBeenCalledTimes(1);
    expect(api.ack).toHaveBeenCalledWith({ app: "kiosk", device_update_id: "upd-1" });

    release();
    await expect(pending).resolves.toBe(true);
    expect(autoUpdate().shouldBrandUpdate).toBe(false);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("500 ×3 → false; the flag stays down (no refresh loop); one update_ack event with the id", async () => {
    pushArrives("upd-1");
    answers(api.ack, fail(500));
    const hook = mountHook();

    const pending = hook.current.updateDeviceUpdateStatus();
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(api.ack).toHaveBeenCalledTimes(3);
    expect(autoUpdate().shouldBrandUpdate).toBe(false);
    expect(events()).toEqual([
      {
        error_source: "update_ack",
        error_status: "500",
        timed_out: false,
        device_update_id: "upd-1",
      },
    ]);
  });

  it("401 is terminal: one attempt, flag down, false", async () => {
    pushArrives("upd-1");
    answers(api.ack, fail(401));
    const hook = mountHook();

    const pending = hook.current.updateDeviceUpdateStatus();
    await drain();

    await expect(pending).resolves.toBe(false);
    expect(api.ack).toHaveBeenCalledTimes(1);
    expect(autoUpdate().shouldBrandUpdate).toBe(false);
  });

  it.each([
    ["is taken", ok, true],
    ["fails", fail(500), false],
  ])("a NEWER push landing while the ack %s keeps its own raised flag and id", async (_label, answer, expected) => {
    pushArrives("upd-1");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    answers(api.ack, () => held.then(answer), answer);
    const hook = mountHook();

    const pending = hook.current.updateDeviceUpdateStatus();
    pushArrives("upd-2");
    release();
    await drain();

    await expect(pending).resolves.toBe(expected);
    expect(autoUpdate().shouldBrandUpdate).toBe(true);
    expect(autoUpdate().device_update_id).toBe("upd-2");
    // Only the first push was acked; the second waits for its own apply.
    const ackedIds = api.ack.mock.calls.map(
      ([body]) => (body as { device_update_id: string }).device_update_id
    );
    expect(new Set(ackedIds)).toEqual(new Set(["upd-1"]));
  });

  it("nothing pending (flag down, a stale never-cleared id) → no POST, false", async () => {
    pushArrives("upd-0");
    store.dispatch(markAsUpdateDone());
    const hook = mountHook();

    await expect(hook.current.updateDeviceUpdateStatus()).resolves.toBe(false);

    expect(api.ack).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(autoUpdate().device_update_id).toBe("upd-0");
  });

  it.each([
    ["an empty id", ""],
    ["a blank id", "  "],
    ["no id", undefined],
    ["a numeric id", 7],
  ])("pending with %s → the flag is lowered, but no POST, false", async (_label, id) => {
    pushArrives(id);
    const hook = mountHook();

    await expect(hook.current.updateDeviceUpdateStatus()).resolves.toBe(false);

    expect(autoUpdate().shouldBrandUpdate).toBe(false);
    expect(api.ack).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("a trigger that throws synchronously: the flag is still lowered, false, no rejection", async () => {
    pushArrives("upd-1");
    api.ack.mockImplementation(() => {
      throw new TypeError("boom");
    });
    const hook = mountHook();

    const pending = hook.current.updateDeviceUpdateStatus();
    expect(autoUpdate().shouldBrandUpdate).toBe(false);
    await drain();

    await expect(pending).resolves.toBe(false);
  });

  it("reads the flag at CALL time, not from a render snapshot", async () => {
    answers(api.ack, ok);
    const hook = mountHook();
    pushArrives("upd-late"); // after the hook rendered

    await expect(hook.current.updateDeviceUpdateStatus()).resolves.toBe(true);
    expect(api.ack).toHaveBeenCalledWith({ app: "kiosk", device_update_id: "upd-late" });
  });
});

describe("checkAndUpdateDeviceVersionDeviceWise — the build-version report", () => {
  it("a new build: exact body, recorded only once the backend took it", async () => {
    let release!: () => void;
    api.version.mockImplementation(() => ({
      unwrap: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    }));
    const hook = mountHook();

    const pending = hook.current.checkAndUpdateDeviceVersionDeviceWise();
    expect(api.version).toHaveBeenCalledWith({ app: "kiosk", version: "9.9.9" });
    await vi.advanceTimersByTimeAsync(0);
    expect(autoUpdate().kioskDeviceVersion).toBe("");

    release();
    await expect(pending).resolves.toBeUndefined();
    expect(autoUpdate().kioskDeviceVersion).toBe("9.9.9");
  });

  it("the version already recorded → no POST", async () => {
    store.dispatch(setKioskDeviceVersion("9.9.9"));
    const hook = mountHook();

    await hook.current.checkAndUpdateDeviceVersionDeviceWise();

    expect(api.version).not.toHaveBeenCalled();
  });

  it("any other recorded version (strict inequality, no semver) → reported", async () => {
    store.dispatch(setKioskDeviceVersion("10.0.0"));
    answers(api.version, ok);
    const hook = mountHook();

    await hook.current.checkAndUpdateDeviceVersionDeviceWise();

    expect(api.version).toHaveBeenCalledTimes(1);
    expect(autoUpdate().kioskDeviceVersion).toBe("9.9.9");
  });

  it.each([
    ["500 ×3", fail(500), 3, "500", false],
    ["401", fail(401), 1, "401", false],
    ["a timeout ×3", fail("TIMEOUT_ERROR"), 3, "TIMEOUT_ERROR", true],
  ])("%s → NOT recorded (re-sent next page load), one event, the promise resolves", async (_label, answer, attempts, status, timedOut) => {
    answers(api.version, answer);
    const hook = mountHook();

    const pending = hook.current.checkAndUpdateDeviceVersionDeviceWise();
    await drain();

    await expect(pending).resolves.toBeUndefined();
    expect(api.version).toHaveBeenCalledTimes(attempts);
    expect(autoUpdate().kioskDeviceVersion).toBe("");
    expect(events()).toEqual([
      {
        error_source: "version_report",
        error_status: status,
        timed_out: timedOut,
        version: "9.9.9",
      },
    ]);
  });

  it("no build version in the environment → no POST", async () => {
    vi.stubEnv("PACKAGE_VERSION", "");
    const hook = mountHook();

    await hook.current.checkAndUpdateDeviceVersionDeviceWise();

    expect(api.version).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe("whole-app update", () => {
  it("setAutoUpdateOnNextStartOver raises ONLY shouldWholeAppUpdate (the dead reload flag stays down)", () => {
    const hook = mountHook();

    act(() => hook.current.setAutoUpdateOnNextStartOver());

    expect(autoUpdate().shouldWholeAppUpdate).toBe(true);
    expect(autoUpdate().shouldDeviceUpdate).toBe(false);
    expect(mockReloadTo).not.toHaveBeenCalled();
  });

  it("applyWholeAppUpdate is the one reload: reloadTo('/start'), once, with no POST", () => {
    const hook = mountHook();

    hook.current.applyWholeAppUpdate();

    expect(mockReloadTo).toHaveBeenCalledTimes(1);
    expect(mockReloadTo).toHaveBeenCalledWith("/start");
    expect(api.fcm).not.toHaveBeenCalled();
    expect(api.ack).not.toHaveBeenCalled();
    expect(api.version).not.toHaveBeenCalled();
  });
});
