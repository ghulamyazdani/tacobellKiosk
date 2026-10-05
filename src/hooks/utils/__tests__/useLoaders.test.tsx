import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import {
  setDeploymentInfo,
  setDiscountOnAddon,
  setEnableAccessibilityMode,
  setGeneralSettings,
  setKioskSettings,
  setMediaData,
  setPaymentSettings,
  setTemplateType,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { setLastBootAt } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../../redux/app/store";
import { setLanguages } from "../../../redux/features/multiLanguage/multiLanguage.slice";
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

  P9e: the REAL useAppSettings runs (its getDeploymentInfoApi(stage) guards
  the deployment rows), stubbed one level down at the RTK hook like every
  other step. The skin, deployment-info and device-settings triggers are not
  unwrapped by the loader, so their stubs answer `{data}` / `{error}`.
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
    /** Trigger RESULTS (not unwrapped by the loader): `{data}` or `{error}`. */
    skin: (): Promise<unknown> => Promise.resolve({ data: {} }),
    deploy: (): Promise<unknown> => Promise.resolve({ data: [] }),
    device: (): Promise<unknown> => Promise.resolve({ data: [] }),
    partners: vi.fn((): Promise<unknown> => Promise.resolve({ paymentPartners: [] })),
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
  useGetCxSkinDataMutation: () => [() => boot.skin()],
  // Reached through the REAL useAppSettings.getDeploymentInfoApi.
  useGetDeploymentInfoForOrderingMutation: () => [() => boot.deploy()],
}));

vi.mock("@cx-sdk/ordering/services/loyaltyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/ordering/services/loyaltyApi")>()),
  useGetLoyaltyPartnerMutation: () => [trigger(() => boot.partner())],
}));

vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@cx-sdk/payments/services/paymentSettingsFetchApi")
  >()),
  useGetPaymentSettingsApiMutation: () => [() => boot.device()],
}));

vi.mock("@cx-sdk/payments/services/paymentInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/payments/services/paymentInfoApi")>()),
  useGetDeploymentPaymentPartnersMutation: () => [trigger(() => boot.partners())],
}));

vi.mock("../colorManagement/useFetchColors", () => ({
  default: () => ({ FetchThemeData: () => boot.theme() }),
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
  boot.skin = () => Promise.resolve({ data: {} });
  boot.deploy = () => Promise.resolve({ data: [] });
  boot.device = () => Promise.resolve({ data: [] });
  boot.partners.mockReset();
  boot.partners.mockImplementation(() => Promise.resolve({ paymentPartners: [] }));
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

  it("never wipes IndexedDB (P9e): the menu 304 cache survives a boot, a broken Dexie cannot fail it", async () => {
    const wipe = vi.fn(() => Promise.reject(new Error("MissingAPIError")));
    boot.resetDatabase = wipe;

    const { onError, onSuccess } = await runBoot();

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(wipe).not.toHaveBeenCalled();
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

/*
  P9e STAGE → COMMIT (boot-refresh.md §2.4). Every step stages its writes and
  nothing reaches the store until the last await is behind the boot; then ONE
  synchronous burst commits them in step order, stamps lastBootAt and writes
  the fork-parity mirrors. A boot that fails anywhere commits NOTHING, so a
  splash refresh returns on exactly the old data and the values a half-run
  boot used to leave (B1 empty pipelines, B2 a degraded kiosk_settings) can
  never be stored. Best-effort steps stage only a well-formed answer and
  otherwise keep the last-known value. The store is seeded with a previous
  boot's data, 7 h old.
*/
describe("useLoaders — stage → commit: a boot writes all or nothing (P9e)", () => {
  const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
  const OLD_BOOT = T0 - 7 * 60 * 60 * 1000;
  const OLD = {
    languages: { primary_language: { name: "OLD", code: "old" }, secondary_language: {} },
    pipelines: [{ _id: "old-p", tab_id: "old-t" }],
    media: { media: { home_screen: [{ key: "home_screen", url: "https://cdn.test/old.jpg" }] } },
    kioskSettings: { start_order_text_primary: "OLD START", enable_loyalty: true },
    deploymentRows: [
      { name: "disable_roundoff", selected: true },
      { name: "enable_dis_addon", selected: true },
    ],
    general: [{ group: "general", setting_id: "tent_number_range" }],
    payment: [{ _id: "old-pay" }],
    partner: { partner: { partner_name: "OLD" } },
  };
  const NEW_SETTINGS = {
    start_order_text_primary: "NEW START",
    one_category_at_a_time: true,
    enable_loyalty: true,
    ideal_time: "90",
  };
  const NEW_MEDIA = { key: "home_screen", url: "https://cdn.test/new.jpg" };
  const NEW_ROWS = [{ name: "enable_dis_addon", selected: false }];
  const NEW_GENERAL = [{ group: "general", setting_id: "new-general" }];
  const NEW_PARTNER = { partner: { partner_name: "Xeno" } };
  /** The fork-parity localStorage keys, written only for a committed boot. */
  const MIRRORS = ["showSelectionText", "kiosk_settings", "showUpsellItemsInMenu"];

  type BootState = {
    multiLanguage: { primary_language: unknown; secondary_language: unknown };
    pipeline: { pipelines: unknown };
    appSettings: Record<string, unknown>;
    loyalty: { isLoyaltyOn: boolean; loyaltyPartner: unknown };
    dynamicPricing: unknown;
    autoUpdate: { lastBootAt: number };
  };
  const state = () => store.getState() as unknown as BootState;

  /** Everything a boot can write. */
  const snapshot = () => {
    const s = state();
    return JSON.parse(
      JSON.stringify({
        languages: [s.multiLanguage.primary_language, s.multiLanguage.secondary_language],
        pipelines: s.pipeline.pipelines,
        appSettings: s.appSettings,
        loyalty: [s.loyalty.isLoyaltyOn, s.loyalty.loyaltyPartner],
        dynamicPricing: s.dynamicPricing,
        lastBootAt: s.autoUpdate.lastBootAt,
      })
    ) as unknown;
  };

  /** runBoot, plus every action the boot dispatched and every mirror it wrote. */
  const bootRecording = async () => {
    const dispatch = vi.spyOn(store, "dispatch");
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const outcome = await runBoot();
    return {
      ...outcome,
      types: dispatch.mock.calls.map(([action]) => (action as { type: string }).type),
      mirrors: setItem.mock.calls.map(([key]) => key).filter((key) => MIRRORS.includes(key)),
    };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    store.dispatch(
      setAutenticationDetails({
        deploymentDetails: { _id: "dep-1", brand_id: "brand-1" },
        licenseDetails: {},
      })
    );
    store.dispatch(setLanguages(OLD.languages));
    store.dispatch(setTemplateType("albaik"));
    store.dispatch(setPipelines(OLD.pipelines));
    store.dispatch(setMediaData(OLD.media));
    store.dispatch(setKioskSettings(OLD.kioskSettings));
    store.dispatch(setDeploymentInfo(OLD.deploymentRows));
    store.dispatch(setDiscountOnAddon(true));
    store.dispatch(setGeneralSettings(OLD.general));
    store.dispatch(setPaymentSettings(OLD.payment));
    store.dispatch(setLoyaltyPartner(OLD.partner));
    store.dispatch(setLastBootAt(OLD_BOOT));

    boot.resetDatabase = vi.fn(() => Promise.resolve());
    boot.skin = () => Promise.resolve({ data: { skin_id: "skin_1" } });
    boot.pipelines = () => Promise.resolve([{ _id: "new-p", tab_id: "t1" }]);
    boot.media.mockImplementation(() => Promise.resolve({ media: [NEW_MEDIA] }));
    boot.settings = { ...NEW_SETTINGS };
    boot.deploy = () => Promise.resolve({ data: NEW_ROWS });
    boot.device = () => Promise.resolve({ data: NEW_GENERAL });
    boot.partner.mockImplementation(() => Promise.resolve(NEW_PARTNER));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [
      "the FIRST await: the language call times out",
      () => (boot.language = () => Promise.reject(TIMEOUT)),
      "unavailable",
    ],
    [
      "the first await: an empty primary language",
      () => (boot.language = () => Promise.resolve({ primary_language: {} })),
      "noLanguage",
    ],
    [
      "the 2nd await: the skin call throws",
      () => (boot.skin = () => Promise.reject(new TypeError("skin"))),
      "unavailable",
    ],
    [
      "a MIDDLE await: no pipelines (B1 — the staged [] is dropped)",
      () => (boot.pipelines = () => Promise.resolve([])),
      "noPipelines",
    ],
    [
      "a middle await: a null pipelines body (B1)",
      () => (boot.pipelines = () => Promise.resolve(null)),
      "noPipelines",
    ],
    [
      "a middle await: pipelines that are not a list",
      () => (boot.pipelines = () => Promise.resolve({})),
      "unavailable",
    ],
    [
      "a middle await: settings without the start text (B2 — the staged settings are dropped)",
      () => (boot.settings = { one_category_at_a_time: true, enable_loyalty: true }),
      "noStartText",
    ],
    [
      "a middle await: a null settings body (B2)",
      () => (boot.settingsCall = () => Promise.resolve(null)),
      "noStartText",
    ],
    [
      "a middle await: the settings call times out",
      () => (boot.settingsCall = () => Promise.reject(TIMEOUT)),
      "unavailable",
    ],
    [
      "the LAST await that can fail: the deployment-info call throws",
      () => (boot.deploy = () => Promise.reject(new TypeError("deploy"))),
      "unavailable",
    ],
  ])("%s → commits NOTHING: no redux write, no stamp, no mirrors", async (_label, arrange, reason) => {
    arrange();
    const before = snapshot();

    const { onError, onSuccess, types, mirrors } = await bootRecording();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(reason);
    expect(types).toEqual([]);
    expect(snapshot()).toEqual(before);
    expect(state().autoUpdate.lastBootAt).toBe(OLD_BOOT);
    // The staged turnOfLoyalty never landed: the last boot's partner stands.
    expect(state().loyalty.isLoyaltyOn).toBe(true);
    expect(mirrors).toEqual([]);
    expect(boot.resetDatabase).not.toHaveBeenCalled();
    expect(eventsFrom("boot")).toEqual([expect.objectContaining({ failure: reason })]);
  });

  it("nothing reaches the store while the LAST fetch (the loyalty partner) is still in flight", async () => {
    let answer!: (partner: unknown) => void;
    boot.partner.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const before = snapshot();
    const dispatch = vi.spyOn(store, "dispatch");
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoaders(), { wrapper });

    let booting!: Promise<void>;
    await act(async () => {
      booting = result.current.LoadResourcesInitially(onError, onSuccess);
      // One macrotask drains every microtask (only Date is faked).
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(boot.partner).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);

    await act(async () => {
      answer(null);
      await booting;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(state().autoUpdate.lastBootAt).toBe(T0);
    // The staged turnOfLoyalty committed; no partner came back.
    expect(state().loyalty.isLoyaltyOn).toBe(false);
  });

  it("success: ONE burst after the last fetch — every write in step order, then the stamp, the mirrors, onSuccess", async () => {
    const fetched = vi.fn((name: string) => name);
    const logged = (name: string, run: () => Promise<unknown>) => () => {
      fetched(name);
      return run();
    };
    boot.language = logged("language", boot.language);
    boot.skin = logged("skin", boot.skin);
    boot.pipelines = logged("pipelines", boot.pipelines);
    boot.theme = logged("theme", boot.theme);
    boot.media.mockImplementation(logged("media", () => Promise.resolve({ media: [NEW_MEDIA] })));
    boot.settingsCall = logged("settings", () => Promise.resolve(boot.settings));
    boot.deploy = logged("deploy", boot.deploy);
    boot.device = logged("device", boot.device);
    boot.partners.mockImplementation(
      logged("partners", () => Promise.resolve({ paymentPartners: [] }))
    );
    boot.partner.mockImplementation(logged("partner", () => Promise.resolve(NEW_PARTNER)));
    const dispatch = vi.spyOn(store, "dispatch");
    const setItem = vi.spyOn(window.localStorage, "setItem");

    const { onError, onSuccess } = await runBoot();

    /** One merged timeline, ordered by vitest's global invocation counter. */
    const entries = (
      mock: { mock: { calls: unknown[][]; invocationCallOrder: number[] } },
      label: (args: unknown[]) => string | null
    ) =>
      mock.mock.calls.flatMap((args, i) => {
        const text = label(args);
        return text === null ? [] : [{ at: mock.mock.invocationCallOrder[i], text }];
      });
    const timeline = [
      ...entries(fetched, ([name]) => `fetch:${String(name)}`),
      ...entries(dispatch, ([action]) => (action as { type: string }).type),
      ...entries(setItem, ([key]) =>
        MIRRORS.includes(String(key)) ? `mirror:${String(key)}` : null
      ),
      ...entries(onSuccess, () => "onSuccess"),
    ]
      .sort((a, b) => a.at - b.at)
      .map(({ text }) => text);

    expect(onError).not.toHaveBeenCalled();
    expect(timeline).toEqual([
      // Fetch order unchanged (posistKiosk's LoadResourcesInitially).
      "fetch:language",
      "fetch:skin",
      "fetch:pipelines",
      "fetch:theme",
      "fetch:media",
      "fetch:settings",
      "fetch:deploy",
      "fetch:device",
      "fetch:partners",
      "fetch:partner",
      // The commit: staged writes in step order…
      "multiLanguage/setLanguages",
      "appSettings/setTemplateType",
      "pipeline/setPipelines",
      "appSettings/setMediaData",
      "appSettings/setOneCategoryAtATime",
      "appSettings/setShowRepeatCustomization",
      "appSettings/setQuickCustomizationMode",
      "appSettings/setEnableFullWidthBanner",
      "appSettings/setHideFilter",
      "appSettings/setHideComboConstituentAddons",
      "appSettings/setShowSelectionText",
      "appSettings/setKioskSettings",
      "appSettings/setEnableBannerCollapse",
      "appSettings/setIdealTimeout",
      "appSettings/setStickyDuration",
      "appSettings/setHidePlusIconFromItem",
      "appSettings/setAutoAdjustFontSize",
      "appSettings/setShowUpsellingItemAsSeperateItem",
      "appSettings/setDiscountOnAddon",
      "appSettings/setDeploymentInfo",
      "appSettings/setPaymentSettings",
      "appSettings/setGeneralSettings",
      "loyalty/turnOfLoyalty",
      "loyalty/setLoyaltyPartner",
      // …then the stamp, the mirrors, and only then the success callback.
      "autoUpdate/setLastBootAt",
      "mirror:showSelectionText",
      "mirror:kiosk_settings",
      "mirror:showUpsellItemsInMenu",
      "onSuccess",
    ]);

    const s = state();
    expect(s.autoUpdate.lastBootAt).toBe(T0);
    expect(s.multiLanguage.primary_language).toEqual({ name: "English", code: "en" });
    expect(s.appSettings.templateType).toBe("default");
    expect(s.pipeline.pipelines).toEqual([{ _id: "new-p", tab_id: "t1" }]);
    expect(s.appSettings.mediaData).toEqual({ media: { home_screen: [NEW_MEDIA] } });
    expect(s.appSettings.kiosk_settings).toEqual(NEW_SETTINGS);
    expect(s.appSettings.idealTimeout).toBe(90);
    expect(s.appSettings.deploymentInfoSettings).toEqual(NEW_ROWS);
    expect(s.appSettings.discountOnAddon).toBe(false);
    expect(s.appSettings.generalSettings).toEqual(NEW_GENERAL);
    expect(s.appSettings.paymentSettings).toEqual([]);
    expect(s.loyalty.isLoyaltyOn).toBe(true);
    expect(s.loyalty.loyaltyPartner).toEqual(NEW_PARTNER);
    expect(window.localStorage.getItem("kiosk_settings")).toBe(JSON.stringify(NEW_SETTINGS));
    // B8: the boot never wipes the Dexie menu cache.
    expect(boot.resetDatabase).not.toHaveBeenCalled();
  });

  it.each([
    ["a failed call ({error})", { error: { status: 500 } }],
    ["a timed-out call", { error: TIMEOUT }],
    ["an error envelope ({data: {}})", { data: {} }],
    ["a null body", { data: null }],
    ["a string body", { data: "x" }],
  ])("B3: deployment info — %s keeps the LAST rows and their derived flags; the boot still commits and stamps", async (_label, answer) => {
    boot.deploy = () => Promise.resolve(answer);

    const { onSuccess, types } = await bootRecording();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(types).not.toContain("appSettings/setDeploymentInfo");
    expect(types).not.toContain("appSettings/setDiscountOnAddon");
    expect(state().appSettings.deploymentInfoSettings).toEqual(OLD.deploymentRows);
    expect(state().appSettings.discountOnAddon).toBe(true);
    expect(state().autoUpdate.lastBootAt).toBe(T0);
  });

  it("B3: a valid EMPTY list is a real answer and replaces the rows", async () => {
    boot.deploy = () => Promise.resolve({ data: [] });

    await bootRecording();

    expect(state().appSettings.deploymentInfoSettings).toEqual([]);
  });

  it.each([
    ["a failed call ({error})", () => Promise.resolve({ error: { status: 500 } })],
    ["an error envelope ({data: {}})", () => Promise.resolve({ data: {} })],
    ["a null body", () => Promise.resolve({ data: null })],
    ["a trigger that throws", () => Promise.reject(new TypeError("device"))],
  ])("B4: device settings — %s keeps the LAST general + payment settings, reports once, the boot commits and stamps", async (_label, answer) => {
    boot.device = answer;

    const { onSuccess, types } = await bootRecording();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(types).not.toContain("appSettings/setGeneralSettings");
    expect(types).not.toContain("appSettings/setPaymentSettings");
    expect(state().appSettings.generalSettings).toEqual(OLD.general);
    expect(state().appSettings.paymentSettings).toEqual(OLD.payment);
    expect(eventsFrom("boot_payment_settings_fetch")).toEqual([
      { source: "boot_payment_settings_fetch" },
    ]);
    expect(boot.partners).not.toHaveBeenCalled();
    expect(state().autoUpdate.lastBootAt).toBe(T0);
  });

  it.each([
    ["a failed call ({error}) keeps the stored skin", { error: { status: 500 } }, "albaik"],
    ["skin_2 → albaik", { data: { skin_id: "skin_2" } }, "albaik"],
    ["any other skin → default", { data: { skin_id: "skin_1" } }, "default"],
  ])("skin: %s", async (_label, answer, expected) => {
    boot.skin = () => Promise.resolve(answer);

    const { onSuccess } = await bootRecording();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(state().appSettings.templateType).toBe(expected);
  });

  it("a failed skin call stages nothing (it used to overwrite the skin with 'default')", async () => {
    boot.skin = () => Promise.resolve({ error: { status: 500 } });

    const { types } = await bootRecording();

    expect(types).not.toContain("appSettings/setTemplateType");
  });

  it("P9d under stage → commit: a valid media answer is NOT stored when a later step fails the boot", async () => {
    boot.settings = {};

    const { onError } = await bootRecording();

    expect(onError).toHaveBeenCalledWith("noStartText");
    expect(state().appSettings.mediaData).toEqual(OLD.media);
  });

  it("P9d under stage → commit: a media failure keeps the last-known media while the rest commits", async () => {
    boot.media.mockImplementation(() => Promise.reject(TIMEOUT));

    const { onSuccess, types } = await bootRecording();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(types).not.toContain("appSettings/setMediaData");
    expect(state().appSettings.mediaData).toEqual(OLD.media);
    expect(eventsFrom("boot_media_fetch")).toHaveLength(1);
    expect(state().pipeline.pipelines).toEqual([{ _id: "new-p", tab_id: "t1" }]);
    expect(state().autoUpdate.lastBootAt).toBe(T0);
  });
});
