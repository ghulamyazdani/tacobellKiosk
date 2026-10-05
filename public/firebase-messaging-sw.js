/*
 * Taco Bell kiosk: FCM push relay (P9e). Not bundled, and not the app worker
 * (/sw.js).
 *
 * Firebase's page-side getToken() registers THIS file at
 * /firebase-cloud-messaging-push-scope (never "/", so PWAUpdateHandler's
 * exact-scope match ignores it) and owns the push subscription. No Firebase
 * SDK, no CDN, no config: every push is posted to the kiosk page in the exact
 * shape Firebase's own worker posts (isFirebaseMessaging / "push-received"),
 * so the page's onMessage() gets it whether the page is visible or not.
 * NEVER shows a notification: no OS toast over the customer screen.
 *
 * ponytail: relies on Firebase's internal SW-to-page message shape (stable
 * 10.14 -> 12.19; pin it with the FCM e2e through the real Firebase listener
 * and a node:vm unit test of this file). No pushsubscriptionchange handler:
 * the page re-mints on every load.
 */
self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    return; // not JSON, so not an FCM message
  }
  if (!payload || typeof payload !== "object") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({
            ...payload,
            isFirebaseMessaging: true,
            messageType: "push-received",
          });
        }
      }),
  );
});
