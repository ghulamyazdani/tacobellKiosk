// The SUBPATH, not the @cx-sdk/core barrel (same object): a lazy chunk that
// reaches the barrel (paytmRuntime, P8b) makes Rolldown split a shared vendor
// chunk onto the boot path — measured +2.8 KiB gzip-9 against the budget.
export { KioskEventName } from "@cx-sdk/core/analytics/events";
export { captureKioskEvent, identifyKiosk, startAnalytics } from "./trackEvent";
export type { KioskEventProperties } from "./trackEvent";
