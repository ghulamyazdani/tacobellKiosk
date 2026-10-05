import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { withTimeoutRetry } from "@cx-sdk/core";
import {
  receivedUpdateNotif,
  selectShouldRegisterFCM,
  setFcmKeyAutoUpdateRdx,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import { extractBrandUpdateId } from "@cx-sdk/devices/updates/updatePolicy";
import useAutoUpdate from "../autoUpdates/useAutoUpdate";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/** ImportMetaEnv also carries booleans (DEV/PROD/SSR), hence unknown. */
type Env = Record<string, unknown>;

export interface FcmConfig {
  apiKey: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  vapidKey: string;
}

/**
 * The five keys by NAME: Vite then inlines only these. A bare
 * `import.meta.env` would inline EVERY VITE_* value present at build time
 * into the entry chunk, including ones no code reads.
 */
const buildFcmEnv = (): Env => ({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_VAPID_KEY: import.meta.env.VITE_FIREBASE_VAPID_KEY,
});

/**
 * DEV-only e2e seam (precedent: window.__kioskStore, store.ts): a spec injects
 * dummy, NON-secret values with addInitScript, because Playwright reuses an
 * already-running `yarn dev` and would ignore webServer.env.
 * `import.meta.env.DEV` is false in builds, so this is dead code there.
 */
function fcmEnv(): Env {
  const injected = import.meta.env.DEV
    ? (window as unknown as { __TB_FCM_ENV__?: Env }).__TB_FCM_ENV__
    : undefined;
  return injected ?? buildFcmEnv();
}

/**
 * The five values FCM web needs. Any blank → null → FCM off (an unconfigured
 * deployment is supported). getMessaging throws synchronously without the
 * first four; without the VAPID key getToken silently binds the token to
 * Firebase's default key. AUTH_DOMAIN / STORAGE_BUCKET / MEASUREMENT_ID are
 * never read.
 */
export function readFcmConfig(env: Env = fcmEnv()): FcmConfig | null {
  const read = (key: string) => {
    const value = env[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const config = {
    apiKey: read("VITE_FIREBASE_API_KEY"),
    projectId: read("VITE_FIREBASE_PROJECT_ID"),
    appId: read("VITE_FIREBASE_APP_ID"),
    messagingSenderId: read("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    vapidKey: read("VITE_FIREBASE_VAPID_KEY"),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

/**
 * getToken() calls Notification.requestPermission() ITSELF while permission
 * is "default", so only a device pre-granted by Chrome policy may mint. TB
 * never requests permission anywhere.
 */
const permissionGranted = (): boolean =>
  typeof Notification !== "undefined" && Notification.permission === "granted";

/**
 * The firebase chunk, or undefined on ANY failure (= FCM off). A failed
 * import() in a build fires `vite:preloadError`; chunkRecovery preventDefault()s
 * it, so import() RESOLVES undefined, and it exempts this chunk from its
 * reload by name (/fcmRuntime/ in the failure message): an optional feature
 * never reloads the kiosk. Renaming this file silently drops that exemption
 * (back to chunkRecovery's one reload per fresh page load). Dev has no
 * preload helper: the import rejects.
 */
const loadFcmRuntime = () => import("./fcmRuntime").catch(() => undefined);

/**
 * Rule 2 cap on the mint's failure report. getToken cannot be aborted, so
 * this bounds when a slow mint is REPORTED, not the work: its late token is
 * still registered (background only; nothing on screen waits for it).
 */
const MINT_TIMEOUT_MS = 10_000;

/** At most one per page load. NEVER the token, never error.message. */
const reportInitFailure = (
  stage: "import" | "unsupported" | "token" | "init",
  error?: unknown,
  timedOut = false,
) =>
  captureKioskEvent(KioskEventName.ErrorOccurred, {
    error_source: "fcm_init",
    stage,
    timed_out: timedOut,
    error_name: error instanceof Error ? error.name : "none",
    error_code: String((error as { code?: unknown } | undefined)?.code ?? ""),
  });

/**
 * FCM remote brand updates (P9e), mounted once from App. Gated on the
 * registration latch (raised at registration, lowered only by RESET_STATE),
 * the five config values, pre-granted notification permission and browser
 * support. NEVER prompts, never throws. A push only raises the brand flag;
 * the splash applies it, never mid-order.
 */
export default function useFcmRegistration(): void {
  const dispatch = useDispatch();
  const shouldRegister = Boolean(useSelector(selectShouldRegisterFCM));
  const { registerFCMTokenToServer } = useAutoUpdate();
  // Latest-ref, written in an effect (react-hooks/refs): read after the mint.
  const registerRef = useRef(registerFCMTokenToServer);
  useEffect(() => {
    registerRef.current = registerFCMTokenToServer;
  });

  useEffect(() => {
    if (!shouldRegister) return;
    const config = readFcmConfig();
    if (!config || !permissionGranted()) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const fcm = await loadFcmRuntime();
        if (cancelled) return;
        if (!fcm) return reportInitFailure("import");
        // Before getMessaging: its own support check is un-awaited and
        // rejects unhandled on an unsupported browser.
        const supported = await fcm.isSupported();
        if (cancelled) return;
        if (!supported) return reportInitFailure("unsupported");
        const { vapidKey, ...appConfig } = config;
        const messaging = fcm.getMessaging(
          fcm.getApps()[0] ?? fcm.initializeApp(appConfig),
        );
        // Subscribed BEFORE minting: a token registered on an earlier page
        // load keeps delivering even if this mint fails. Firebase has ONE
        // handler slot; `cancelled` + the cleanup keep exactly one live.
        unsubscribe = fcm.onMessage(messaging, ({ data, messageId }) => {
          const id = extractBrandUpdateId(data);
          if (id) {
            dispatch(
              receivedUpdateNotif({
                shouldBrandUpdate: true,
                device_update_id: id,
              }),
            );
          } else {
            captureKioskEvent(KioskEventName.ErrorOccurred, {
              error_source: "fcm_message",
              reason: "no_device_update_id",
              message_id: messageId,
            });
          }
        });
        // Re-checked in the same tick as getToken's own check, which would
        // prompt if a policy refresh reset the permission during the awaits.
        if (!permissionGranted()) return;
        // NO serviceWorkerRegistration: Firebase then registers
        // public/firebase-messaging-sw.js at its own scope AND waits for it
        // to activate; a passed registration skips that wait (first-boot race).
        // ponytail: ONE mint per page load — a retry would overlap a hung,
        // un-abortable getToken. The 10 s bound only times the failure
        // report: a mint that lands later is still registered (the SAME
        // promise, never a second getToken). Upgrade: retry on `online` if
        // fcm_init "token" failures cluster at power-on.
        const mint = fcm.getToken(messaging, { vapidKey });
        const minted = await withTimeoutRetry(() => mint, {
          timeoutMs: MINT_TIMEOUT_MS,
          retries: 0,
        });
        if (cancelled) return;
        let token: string | undefined;
        if (minted.ok) {
          token = minted.data;
        } else {
          reportInitFailure("token", minted.error, minted.timedOut);
          if (minted.timedOut) token = await mint.catch(() => undefined);
        }
        if (cancelled || !token) return;
        // Stored only once the backend took it (fork D5). The register call
        // retries and reports its own failure.
        if ((await registerRef.current(token)) && !cancelled) {
          dispatch(setFcmKeyAutoUpdateRdx(token));
        }
      } catch (error) {
        if (!cancelled) reportInitFailure("init", error); // never rethrow (Rule 2)
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [shouldRegister, dispatch]);
}
