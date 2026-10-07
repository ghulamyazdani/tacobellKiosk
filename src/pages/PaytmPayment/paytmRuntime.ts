/**
 * The ONLY entry of the /paymentPolling chunk (P8b × the P9f boot budget).
 * loadPaytmScreen.ts loads it with `await import()`, so the Paytm settlement
 * screen, its hook, the SDK settlement reducer and react-qr-code ship as ONE
 * lazy chunk with a stable name — paytmRuntime-<hash>.js, which chunkRecovery
 * exempts from the reload: a failed Paytm chunk must never reload the kiosk
 * mid-payment (the initiate is refused, a resumed session gets the staff
 * panel, and the next splash reloads). Renaming this file restores the reload
 * (posthogRuntime.ts / fcmRuntime.ts are the precedent).
 */
export { default } from "./index";
