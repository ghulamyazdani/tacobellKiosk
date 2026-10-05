/**
 * The ONLY firebase importer (P9e). useFcmRegistration loads it with import(),
 * so firebase is its own lazy chunk: never in the boot chunk (CLAUDE.md rule
 * 8) and never fetched while FCM is off. Also the unit tests' vi.mock seam.
 */
export { getApps, initializeApp } from "firebase/app";
export {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "firebase/messaging";
