import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import {
  setEnableAccessibilityMode,
  setMediaData,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { resolveIdleSeconds } from "../useIdleTimeout";
import useLoaders from "../useLoaders";

/*
  The boot loader (LoadResourcesInitially). Every boot fetch is stubbed at its
  RTK hook (originals spread, so endpoint injection still runs); each step's
  answer is a per-test function, so a test can make exactly one step fail.

  P9a (D2, Rule 2 — degrade over block): boot used to THROW "Idle Time Not
  set in the settings" (fork parity), parking a kiosk whose tenant never set
  ideal_time on the retry screen. Now a missing value leaves the slice
  default, which the idle guard caps at Rule 1's 120 s anyway.

  P9b (R6/R7): failures are categorised for /LoadingResources — a typed
  config reason, or "unavailable" for anything the network did — and the
  loyalty partner lookup DEGRADES instead of blocking boot. Local faults
  (Dexie, localStorage, the cosmetic theme) never stop boot either.
*/

// Hoisted with the vi.mock factories that read them.
const { boot, mockCapture } = vi.hoisted(() => ({
  boot: {
    resetDatabase: (): Promise<unknown> => Promise.resolve(),
    language: (): Promise<unknown> =>
      Promise.resolve({ primary_language: { name: "English", code: "en" } }),
    pipelines: (): Promise<unknown> =>
      Promise.resolve([{ _id: "p1", tab_id: "t1" }]),
    settings: {} as Record<string, unknown>,
    settingsCall: undefined as undefined | (() => Promise<unknown>),
    theme: (): Promise<unknown> => Promise.resolve(),
    partner: vi.fn((): Promise<unknown> => Promise.resolve(null)),
    /** getMedia; called with the request so a test can check brand_id. */
    media: vi.fn<(request: unknown) => Promise<unknown>>(),
  },
  mockCapture: vi.fn(),
}));

/** An RTK mutation trigger whose `unwrap()` settles like `run()`. */
const trigger = (run: () => Promise<unknown>) => () => ({ unwrap: run });

vi.mock("../../../models/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../models/db")>()),
  resetDatabase: () => boot.resetDatabase(),
}));

vi.mock("@cx-sdk/catalog/services/kioskInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/kioskInfoApi")>()),
  useGetLanguageMutation: () => [trigger(() => boot.language())],
  useFetchCXPipelinesMutation: () => [trigger(() => boot.pipelines())],
  useGetKioskSettingsMutation: () => [
    trigger(() => boot.settingsCall?.() ?? Promise.resolve(boot.settings)),
  ],
  useGetKioskMediaMutation: () => [
    (request: unknown) => ({ unwrap: () => boot.media(request) }),
  ],
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useGetCxSkinDataMutation: () => [() => Promise.resolve({ data: {} })],
}));

vi.mock("@cx-sdk/ordering/services/loyaltyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/ordering/services/loyaltyApi")>()),
  useGetLoyaltyPartnerMutation: () => [trigger(() => boot.partner())],
}));

vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@cx-sdk/payments/services/paymentSettingsFetchApi")
  >()),
  useGetPaymentSettingsApiMutation: () => [() => Promise.resolve({ data: [] })],
}));

vi.mock("@cx-sdk/payments/services/paymentInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/payments/services/paymentInfoApi")>()),
  useGetDeploymentPaymentPartnersMutation: () => [
    trigger(() => Promise.resolve({ paymentPartners: [] })),
  ],
}));

vi.mock("../colorManagement/useFetchColors", () => ({
  default: () => ({ FetchThemeData: () => boot.theme() }),
}));

vi.mock("../useAppSettings", () => ({
  default: () => ({
    getDeploymentInfoApi: () => Promise.resolve(),
    getAllIds: () => [],
  }),
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const START_TEXT = { start_order_text_primary: "Start order" };

/** RTK's rejection for a request that ran out of its 10 s budget. */
const TIMEOUT = { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const idealTimeout = () =>
  (store.getState() as { appSettings: { idealTimeout: unknown } }).appSettings
    .idealTimeout;

const loyalty = () =>
  (
    store.getState() as {
      loyalty: { isLoyaltyOn: boolean; loyaltyPartner: unknown };
    }
  ).loyalty;

/** Analytics events by `source` (the key every boot-step event uses). */
const eventsFrom = (source: string) =>
  mockCapture.mock.calls
    .map(([, props]) => props as Record<string, unknown> | undefined)
    .filter((props) => props?.source === source);

const runBoot = async () => {
  const onError = vi.fn();
  const onSuccess = vi.fn();
  const { result } = renderHook(() => useLoaders(), { wrapper });
  await act(async () => {
    await result.current.LoadResourcesInitially(onError, onSuccess);
  });
  return { onError, onSuccess };
};

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  mockCapture.mockReset();
  boot.resetDatabase = () => Promise.resolve();
  boot.language = () =>
    Promise.resolve({ primary_language: { name: "English", code: "en" } });
  boot.pipelines = () => Promise.resolve([{ _id: "p1", tab_id: "t1" }]);
  boot.settings = { ...START_TEXT };
  boot.settingsCall = undefined;
  boot.theme = () => Promise.resolve();
  boot.partner.mockReset();
  boot.partner.mockImplementation(() => Promise.resolve(null));
  // A valid answer with no splash media. Stubbed for every test: the real
  // hook would make a real (failing) request from inside the boot.
  boot.media.mockReset();
  boot.media.mockImplementation(() => Promise.resolve({ media: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLoaders — ideal_time (P9a, D2)", () => {
  it("a missing ideal_time no longer blocks boot; the default resolves within Rule 1", async () => {
    const before = idealTimeout();
    boot.settings = { start_order_text_primary: "Start order" };

    const { onError, onSuccess } = await runBoot();

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(idealTimeout()).toBe(before);
    expect(resolveIdleSeconds(idealTimeout())).toBe(120);
  });

  it("a configured ideal_time is stored as a base-10 number", async () => {
    boot.settings = { start_order_text_primary: "Start order", ideal_time: "90" };

    const { onSuccess } = await runBoot();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(idealTimeout()).toBe(90);
  });
});

describe("useLoaders — categorised boot failures (P9b R7)", () => {
  it.each([
    ["no language at all", () => (boot.language = () => Promise.resolve(null)), "noLanguage"],
    [
      "an empty primary language",
      () =>
        (boot.language = () =>
          Promise.resolve({ primary_language: {} })),
      "noLanguage",
    ],
    ["no pipelines", () => (boot.pipelines = () => Promise.resolve([])), "noPipelines"],
    ["no start-screen text", () => (boot.settings = {}), "noStartText"],
    [
      "a secondary language without its start-screen text",
      () => {
        boot.language = () =>
          Promise.resolve({
            primary_language: { name: "English", code: "en" },
            secondary_language: { name: "العربية", code: "ar" },
          });
        boot.settings = { ...START_TEXT };
      },
      "noStartText",
    ],
  ])("configuration: %s → %s", async (_label, arrange, reason) => {
    arrange();

    const { onError, onSuccess } = await runBoot();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(reason);
    expect(eventsFrom("boot")).toEqual([
      expect.objectContaining({ source: "boot", failure: reason }),
    ]);
  });

  it.each([
    ["the language call timed out", () => (boot.language = () => Promise.reject(TIMEOUT))],
    [
      "the pipelines call found no network",
      () =>
        (boot.pipelines = () =>
          Promise.reject({ status: "FETCH_ERROR", error: "TypeError: Failed to fetch" })),
    ],
    [
      "the settings call answered 500",
      () => (boot.settingsCall = () => Promise.reject({ status: 500, data: {} })),
    ],
    [
      "a body ran past the budget (RTK 2.12 PARSING_ERROR)",
      () =>
        (boot.settingsCall = () =>
          Promise.reject({
            status: "PARSING_ERROR",
            originalStatus: 200,
            data: "",
            error: "TimeoutError: signal timed out",
          })),
    ],
  ])("transport: %s → unavailable", async (_label, arrange) => {
    arrange();

    const { onError, onSuccess } = await runBoot();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("unavailable");
  });

  it("reports the RTK status and detail of an unavailable boot (an RTK error has no .message)", async () => {
    boot.language = () => Promise.reject(TIMEOUT);

    await runBoot();

    expect(eventsFrom("boot")).toEqual([
      {
        source: "boot",
        failure: "unavailable",
        error_status: "TIMEOUT_ERROR",
        error_detail: "TimeoutError: signal timed out",
      },
    ]);
  });
});

describe("useLoaders — local faults never read as 'Can't connect' (P9b)", () => {
  it("a theme fetch that fails is cosmetic: boot succeeds and it is reported (no floating rejection)", async () => {
    boot.theme = () => Promise.reject(TIMEOUT);

    const { onError, onSuccess } = await runBoot();

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(eventsFrom("boot_theme_fetch")).toEqual([
      expect.objectContaining({ error_status: "TIMEOUT_ERROR" }),
    ]);
  });

  it("a broken IndexedDB (resetDatabase rejects) is reported and boot continues", async () => {
    boot.resetDatabase = () => Promise.reject(new Error("MissingAPIError"));

    const { onError, onSuccess } = await runBoot();

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(eventsFrom("boot_reset_database")).toHaveLength(1);
  });

  it("a full or blocked localStorage only loses the fork-parity mirrors; boot continues", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    const { onError, onSuccess } = await runBoot();

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    // showSelectionText, kiosk_settings, showUpsellItemsInMenu.
    expect(eventsFrom("boot_storage")).toHaveLength(3);
  });
});

describe("useLoaders — the loyalty partner DEGRADES, never blocks (P9b R6)", () => {
  const PARTNER = {
    partner: { partner_name: "Xeno", partner_merchant_id: "xeno-merchant-uuid-1" },
    partnerDetails: { client_id: "xeno-client-1", partner_name: "Xeno" },
  };

  it("a failed lookup: boot still succeeds, loyalty is OFF and the failure is reported", async () => {
    boot.settings = { ...START_TEXT, enable_loyalty: true };
    boot.partner.mockImplementation(() => Promise.reject(TIMEOUT));

    const { onError, onSuccess } = await runBoot();

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(boot.partner).toHaveBeenCalledTimes(1);
    expect(loyalty().isLoyaltyOn).toBe(false);
    expect(eventsFrom("loyalty_partner")).toEqual([
      {
        source: "loyalty_partner",
        error_status: "TIMEOUT_ERROR",
        error_detail: "TimeoutError: signal timed out",
      },
    ]);
  });

  it("clears the LAST boot's persisted loyalty-on first — never on for a partner this boot did not confirm", async () => {
    store.dispatch(setLoyaltyPartner(PARTNER));
    expect(loyalty().isLoyaltyOn).toBe(true);
    boot.settings = { ...START_TEXT, enable_loyalty: true };
    boot.partner.mockImplementation(() => Promise.reject(TIMEOUT));

    await runBoot();

    expect(loyalty().isLoyaltyOn).toBe(false);
  });

  it("no partner configured (empty answer): boot succeeds with loyalty off", async () => {
    boot.settings = { ...START_TEXT, enable_loyalty: true };

    const { onSuccess } = await runBoot();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(loyalty().isLoyaltyOn).toBe(false);
    expect(eventsFrom("loyalty_partner")).toEqual([]);
  });

  it("a resolved partner turns loyalty on", async () => {
    boot.settings = { ...START_TEXT, enable_loyalty: true };
    boot.partner.mockImplementation(() => Promise.resolve(PARTNER));

    const { onSuccess } = await runBoot();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(loyalty().isLoyaltyOn).toBe(true);
    expect(loyalty().loyaltyPartner).toEqual(PARTNER);
  });

  it("loyalty disabled in settings: the partner is never asked for", async () => {
    boot.settings = { ...START_TEXT, enable_loyalty: false };

    const { onSuccess } = await runBoot();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(boot.partner).not.toHaveBeenCalled();
  });
});

/*
  P9c (A5): the tenant's ADA gate (accessibility_mode) hides the footer toggle
  when false. Only a real boolean may write it — the old `!== undefined` check
  stored null (hiding the toggle) and stored "false" (a truthy string that
  SHOWED it). Anything else keeps the persisted gate.
*/
describe("useLoaders — the ADA feature gate (P9c)", () => {
  const gate = () =>
    (store.getState() as { appSettings: { enableAccessibilityMode: unknown } })
      .appSettings.enableAccessibilityMode;

  it.each([true, false])("a boolean %s is stored as the gate", async (value) => {
    store.dispatch(setEnableAccessibilityMode(!value));
    boot.settings = { ...START_TEXT, accessibility_mode: value };

    const { onSuccess } = await runBoot();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(gate()).toBe(value);
  });

  it.each([
    ["null", null, true],
    ["null", null, false],
    ['the string "false"', "false", false],
    ['the string "true"', "true", false],
    ["a number", 0, true],
    ["a missing key", undefined, true],
  ])("%s keeps the persisted gate (%s → stays %s)", async (_label, value, persisted) => {
    store.dispatch(setEnableAccessibilityMode(persisted));
    boot.settings = { ...START_TEXT, accessibility_mode: value };

    const { onSuccess } = await runBoot();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(gate()).toBe(persisted);
  });
});

/*
  P9d — splash media (getMedia → appSettings.mediaData). Decorative, never
  boot-critical: a valid answer stores ONLY { media: { home_screen } } scoped
  to this deployment (a stored banner_image_* key can blank /menu); a failure,
  or a body that is not a getMedia answer, keeps the last-known
  (device-persisted) media, is reported once, and boot carries on.
*/
describe("useLoaders — splash media (P9d)", () => {
  const DEPLOYMENT = { _id: "dep-1", brand_id: "brand-1" };
  const EVERYWHERE = { url: "https://cdn.test/all.mp4", media_type: "mp4", deployments: [] };
  const THIS_STORE = { url: "https://cdn.test/dep-1.jpg", deployments: ["dep-1"] };
  const OTHER_STORE = { url: "https://cdn.test/dep-2.jpg", deployments: ["dep-2"] };
  const ROOT = {
    key: "home_screen",
    url: "https://cdn.test/splash.jpg",
    media_type: "image",
    iteration_time: "5",
    extra_images: [EVERYWHERE, THIS_STORE, OTHER_STORE],
  };
  const BANNER = { key: "banner_image_primary", url: "https://cdn.test/banner.jpg" };
  /** What an earlier boot stored (device scope, survives the reboot). */
  const LAST_KNOWN = {
    media: { home_screen: [{ key: "home_screen", url: "https://cdn.test/last.jpg" }] },
  };

  const mediaData = () =>
    (store.getState() as { appSettings: { mediaData: unknown } }).appSettings.mediaData;

  /** runBoot, plus every setMediaData the boot itself dispatched. */
  const bootRecordingMediaWrites = async () => {
    const dispatch = vi.spyOn(store, "dispatch");
    const outcome = await runBoot();
    const writes = dispatch.mock.calls.filter(
      ([action]) => (action as { type?: unknown }).type === setMediaData.type
    );
    return { ...outcome, writes };
  };

  beforeEach(() => {
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: DEPLOYMENT, licenseDetails: {} })
    );
  });

  it("stores ONLY this deployment's home_screen (no banner keys), asked for by brand", async () => {
    boot.media.mockResolvedValue({
      media: [BANNER, { key: "loyalty_icon", url: "https://cdn.test/icon.png" }, ROOT],
    });

    const { onSuccess, writes } = await bootRecordingMediaWrites();

    expect(boot.media).toHaveBeenCalledTimes(1);
    expect(boot.media).toHaveBeenCalledWith({ brand_id: "brand-1" });
    // Root, then its extras in payload order; another store's promo is dropped.
    const expected = { media: { home_screen: [ROOT, EVERYWHERE, THIS_STORE] } };
    expect(writes).toEqual([[setMediaData(expected)]]);
    expect(mediaData()).toStrictEqual(expected);
    expect(eventsFrom("boot_media_fetch")).toEqual([]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an empty media list", { media: [] }],
    ["banners but no home_screen", { media: [BANNER] }],
  ])("a valid answer with no splash media (%s) stores home_screen: []", async (_label, body) => {
    store.dispatch(setMediaData(LAST_KNOWN));
    boot.media.mockResolvedValue(body);

    const { onSuccess } = await runBoot();

    // The operator removed the media: the splash falls back to its poster.
    expect(mediaData()).toStrictEqual({ media: { home_screen: [] } });
    expect(eventsFrom("boot_media_fetch")).toEqual([]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  /** The detail loadSplashMedia reports for a body that is not a getMedia answer. */
  const NO_LIST = "getMedia body has no media list";

  it.each([
    ["an empty object", () => Promise.resolve({}), "none", NO_LIST],
    [
      "a media map, not a list",
      () => Promise.resolve({ media: { home_screen: [] } }),
      "none",
      NO_LIST,
    ],
    ["a null body", () => Promise.resolve(null), "none", NO_LIST],
    [
      "no network",
      () => Promise.reject({ status: "FETCH_ERROR", error: "TypeError: Failed to fetch" }),
      "FETCH_ERROR",
      "TypeError: Failed to fetch",
    ],
    [
      "the transport budget ran out",
      () => Promise.reject(TIMEOUT),
      "TIMEOUT_ERROR",
      "TimeoutError: signal timed out",
    ],
    [
      "the body ran past the budget (RTK 2.12)",
      () =>
        Promise.reject({
          status: "PARSING_ERROR",
          originalStatus: 200,
          data: "",
          error: "TimeoutError: signal timed out",
        }),
      "PARSING_ERROR",
      "TimeoutError: signal timed out",
    ],
    [
      "an aborted request",
      () => Promise.reject({ name: "AbortError", message: "Aborted" }),
      "none",
      "Aborted",
    ],
    ["HTTP 500", () => Promise.reject({ status: 500, data: {} }), "500", ""],
  ])("%s: keeps the last-known media, reports once, boot carries on", async (_label, answer, status, detail) => {
    store.dispatch(setMediaData(LAST_KNOWN));
    boot.media.mockImplementation(answer);
    const settings = vi.fn(() => Promise.resolve(boot.settings));
    boot.settingsCall = settings;

    const { onError, onSuccess, writes } = await bootRecordingMediaWrites();

    expect(writes).toEqual([]);
    expect(mediaData()).toStrictEqual(LAST_KNOWN);
    // The whole event: the RTK status AND its detail are the only diagnostics.
    expect(eventsFrom("boot_media_fetch")).toEqual([
      { source: "boot_media_fetch", error_status: status, error_detail: detail },
    ]);
    expect(mockCapture).toHaveBeenCalledWith("error_occurred", eventsFrom("boot_media_fetch")[0]);
    // The steps after media still ran.
    expect(settings).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("runs after the theme step and is AWAITED before kiosk settings, so /start mounts with it stored", async () => {
    const order: string[] = [];
    let answer!: (body: unknown) => void;
    boot.theme = () => {
      order.push("theme");
      return Promise.resolve();
    };
    boot.media.mockImplementation(() => {
      order.push("media");
      return new Promise<unknown>((resolve) => {
        answer = resolve;
      });
    });
    boot.settingsCall = () => {
      order.push("settings");
      return Promise.resolve(boot.settings);
    };
    let storedAtSuccess: unknown;
    const onError = vi.fn();
    const onSuccess = vi.fn(() => {
      storedAtSuccess = mediaData();
    });
    const { result } = renderHook(() => useLoaders(), { wrapper });

    let booting!: Promise<void>;
    await act(async () => {
      booting = result.current.LoadResourcesInitially(onError, onSuccess);
      // One macrotask drains every microtask: boot runs up to what it awaits.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(order).toEqual(["theme", "media"]);
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      answer({ media: [ROOT] });
      await booting;
    });

    expect(order).toEqual(["theme", "media", "settings"]);
    expect(onError).not.toHaveBeenCalled();
    expect(storedAtSuccess).toEqual({
      media: { home_screen: [ROOT, EVERYWHERE, THIS_STORE] },
    });
  });
});
