/**
 * Web-shell transport wiring (P8-prep). The transport itself now lives in
 * @cx-sdk/core (packages/core/src/transport/kioskApi.ts); this module
 * configures it with the web shell's specifics — env-driven baseUrl, cookie
 * token fallback, and the P3d session-recovery callbacks — at MODULE SCOPE,
 * so every consumer that imports { apiSlice } through this path gets a
 * configured transport by construction.
 */
import { Cookies } from "react-cookie";
import {
  apiSlice,
  configureKioskTransport,
} from "@cx-sdk/core/transport/kioskApi";
import {
  recoverFromAuthFailure,
  recoverFromServerError,
} from "./sessionRecovery";

const cookies = new Cookies();

export const baseUrl = import.meta.env.VITE_API_ENDPOINT;

configureKioskTransport({
  baseUrl,
  tokenFallback: () => cookies.get("token"),
  onAuthFailure: recoverFromAuthFailure,
  onServerError: recoverFromServerError,
});

export { apiSlice };
