import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

/*
  P9e — public/firebase-messaging-sw.js, the dependency-free FCM push relay
  (not bundled; Firebase's getToken registers it at its own push scope). It
  must hand every push to the kiosk page in the exact shape Firebase's own
  worker posts, so the page's onMessage() gets it visible or not — and it
  must NEVER show a notification (no OS toast over the customer screen).
  The file runs in a fresh node:vm realm whose only global is a fake `self`
  (ServiceWorkerGlobalScope): no importScripts, no SDK, no network.
*/

const SOURCE = readFileSync(
  join(import.meta.dirname, "../../public/firebase-messaging-sw.js"),
  "utf8"
);

type Listener = (event: unknown) => void;

/** Boots the worker with `clientCount` window clients (controlled or not). */
const bootWorker = (clientCount = 2) => {
  const listeners = new Map<string, Listener[]>();
  const posted: Array<[number, unknown]> = [];
  const clients = Array.from({ length: clientCount }, (_, index) => ({
    postMessage: (message: unknown) => posted.push([index, message]),
  }));
  // Resolves on a LATER macrotask: a post not chained into waitUntil would
  // land after the push "finished" and fail the waitUntil assertions.
  const matchAll = vi.fn(
    () => new Promise((resolve) => setTimeout(() => resolve(clients), 5))
  );
  const showNotification = vi.fn();
  const self = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    clients: { matchAll },
    registration: { showNotification },
  };
  runInNewContext(SOURCE, { self });

  /** Fires one push; resolves once every waitUntil promise has settled. */
  const push = async (data: unknown) => {
    const waits: Promise<unknown>[] = [];
    for (const listener of listeners.get("push") ?? []) {
      listener({ data, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    }
    await Promise.all(waits);
    return waits.length;
  };
  return { listeners, posted, matchAll, showNotification, push };
};

/** PushMessageData stand-ins. */
const jsonData = (body: unknown) => ({ json: () => JSON.parse(JSON.stringify(body)) });
const textData = (text: string) => ({ json: () => JSON.parse(text) });

describe("firebase-messaging-sw.js — the FCM push relay", () => {
  it("boots with nothing but `self` and registers ONE listener: push", () => {
    const worker = bootWorker();

    expect([...worker.listeners.keys()]).toEqual(["push"]);
    expect(worker.listeners.get("push")).toHaveLength(1);
  });

  it("a JSON push reaches EVERY window client — uncontrolled included — Firebase-shaped, inside waitUntil", async () => {
    const worker = bootWorker(2);
    const payload = {
      from: "1234567890",
      fcmMessageId: "m-1",
      collapse_key: "kiosk",
      data: { device_update_id: "upd-1" },
    };

    expect(await worker.push(jsonData(payload))).toBe(1); // one waitUntil

    expect(worker.matchAll.mock.calls).toEqual([
      [{ type: "window", includeUncontrolled: true }],
    ]);
    const relayed = { ...payload, isFirebaseMessaging: true, messageType: "push-received" };
    expect(worker.posted).toEqual([
      [0, relayed],
      [1, relayed],
    ]);
  });

  it("the payload can never override the relay markers", async () => {
    const worker = bootWorker(1);

    await worker.push(
      jsonData({ isFirebaseMessaging: false, messageType: "data-message", data: {} })
    );

    expect(worker.posted).toEqual([
      [0, { data: {}, isFirebaseMessaging: true, messageType: "push-received" }],
    ]);
  });

  it("no open window: nothing to post, no throw", async () => {
    const worker = bootWorker(0);

    expect(await worker.push(jsonData({ data: { device_update_id: "upd-1" } }))).toBe(1);
    expect(worker.posted).toEqual([]);
  });

  it.each([
    ["no data (an empty push)", null],
    ["undefined data", undefined],
    ["a body that is not JSON", textData("not json {")],
    ["JSON null", jsonData(null)],
    ["a JSON number", jsonData(7)],
    ["a JSON string", jsonData("upd-1")],
    ["a JSON boolean", jsonData(true)],
  ])("%s → ignored: nothing posted, no waitUntil, no throw", async (_label, data) => {
    const worker = bootWorker();

    expect(await worker.push(data)).toBe(0);
    expect(worker.matchAll).not.toHaveBeenCalled();
    expect(worker.posted).toEqual([]);
  });

  it("NEVER shows a notification: a notification block is relayed like data, and the code has no showNotification call", async () => {
    const worker = bootWorker(1);

    await worker.push(
      jsonData({ notification: { title: "Menu updated", body: "x" }, data: { device_update_id: "u-2" } })
    );

    expect(worker.showNotification).not.toHaveBeenCalled();
    expect(worker.posted).toHaveLength(1);
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/showNotification|importScripts/);
  });
});
