/*
 * react-qr-code@2.0.15 (user decision D1, P8b) is CommonJS and sets BOTH
 * `exports.default` and `exports.QRCode`, but its bundled types declare only
 * the default. Vite 8 / Rolldown hands a default import of a CJS module the
 * whole namespace (the createFilter trap in the SDK's persistenceManifest),
 * so the kiosk imports the NAMED export — this augmentation types it.
 */
import type { ComponentType } from "react";
import type { QRCodeProps } from "react-qr-code";

declare module "react-qr-code" {
  export const QRCode: ComponentType<QRCodeProps>;
}
