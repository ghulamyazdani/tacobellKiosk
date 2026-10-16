/**
 * Lane perf-bench — the low-end kiosk calibration and the measurement kit of tests/e2e/perf.preview.ts.
 *
 * CALIBRATION. The target is a Celeron/Pentium-class Windows kiosk: ≈ 6× slower than an M4 Pro, 4 GB,
 * an Intel iGPU that may composite in software. CDP Emulation.setCPUThrottlingRate (PERF_CPU_RATE,
 * default 6) holds for the page's whole life, from before the first navigation (it survives it), so every
 * window runs on the slow CPU; the spec launches Chromium with --disable-gpu. The throttle slows the
 * renderer MAIN thread only: compositor, raster and media threads run at host speed. Re-tune
 * PERF_CPU_RATE against a real kiosk: run the same scenario on both and match the cold load or one tap.
 *
 * A WINDOW (measure): settled → t0 → the action → its outcome → settled → t1. Read for [t0, t1]: in-page
 * PerformanceObservers (longtask; long-animation-frame with its script attribution; Event Timing ≥ 16 ms
 * grouped by interactionId; layout-shift) and CDP Performance.getMetrics deltas. The rAF frame sampler
 * runs only in taps (every screen, sheet and key animates in) and flings: a rAF loop makes the main thread
 * render every vsync — under an opacity-only animation it re-styles once a frame — so in an idle or
 * timer-driven window it would be most of what is measured. Those windows poll their outcome on a 100 ms
 * timer instead of rAF, for the same reason.
 *
 * A TAP is a touch tap (CDP touch events → pointerType "touch" pointerdown / pointerup / click, as on the
 * kiosk's touchscreen) at the control's centre, read once the screen has settled; actionability is checked
 * first, outside the window, so no Playwright injected script runs inside it. Every tap names its outcome
 * — a screen or sheet appearing (or leaving), a toggle's aria state, a display's text — which must NOT hold
 * before the tap and must hold after it, and a window with no pointerdown throws: an ignored tap fails
 * instead of reading as a fast one. `toVisibleMs` = pointerdown → the start of the frame after the one that
 * first laid the outcome out. Event Timing's latency ends at that first frame's presentation, so a
 * synchronous outcome reads latency ≥ toVisible; an async one (a lazy chunk, a fetch, a timer) reads
 * toVisible > latency.
 *
 * SETTLED = every finite keyframe animation ended (the 20 s countdown fill excepted; capped at 5 s), then
 * QUIET: no long task or long animation frame ended for 300 ms (capped at 5 s — a screen that keeps
 * ticking never settles, and `quiet: false` says so). Waits on outcomes, never fixed sleeps; the only
 * sleep is `idle`, the deliberate measured idle window.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test, type CDPSession, type Locator, type Page } from "@playwright/test";

/** The calibration knob: how many times slower than this host the kiosk's CPU is. */
export const CPU_RATE = Number(process.env.PERF_CPU_RATE) || 6;
export const PERF_LABEL = process.env.PERF_LABEL || "run";
/** Chromium flags of the calibrated launch (the spec's test.use launchOptions — worker-scoped). */
export const LOW_END_ARGS = ["--disable-gpu"];
/** A screen that keeps ticking never goes quiet: give up after this (the window records `quiet: false`). */
const QUIET_CAP_MS = 5_000;
/** Finite animations a window does not wait out: Order Complete's 20 s countdown fill. */
const LONG_ANIMATIONS = ["tb-countdown-fill"];
/** Headless Chromium's frame interval (60 Hz): every rAF gap lands on a multiple of it. */
const VSYNC_MS = 1000 / 60;

export const tid = (id: string) => `[data-testid="${id}"]`;

interface Script {
  src: string;
  fn: string;
  at: number;
  invoker: string;
  type: string;
  ms: number;
}
interface Loaf {
  start: number;
  duration: number;
  blocking: number;
  scripts: Script[];
}
interface EventTiming {
  id: number;
  name: string;
  start: number;
  duration: number;
  procStart: number;
  procEnd: number;
}
interface Taken {
  lt: { start: number; duration: number }[];
  loaf: Loaf[];
  ev: EventTiming[];
  ls: { start: number; value: number; input: boolean }[];
  frames: number[];
  down: number;
}
interface PerfStore extends Omit<Taken, "frames"> {
  frames: number[] | null;
  lcp: number;
  pending: Promise<number> | null;
  quiet(ms: number, max: number): Promise<boolean>;
  animationsDone(exclude: string[], max: number): Promise<boolean>;
  arm(selector: string, gone: boolean, timeoutMs: number, text: string | null, everyMs: number, then: string | null): void;
  startFrames(): void;
  take(from: number, to: number): Taken;
  clear(): void;
}
type W = Window & { __perf: PerfStore };

/** The in-page half, installed before any app script. Serialized by addInitScript: self-contained. */
function collector() {
  type Entry = PerformanceEntry & Record<string, unknown>;
  const store = { lt: [], loaf: [], ev: [], ls: [], frames: null, down: 0, lcp: 0, pending: null } as unknown as PerfStore;
  Object.defineProperty(window, "__perf", { value: store });
  const observe = (type: string, onEntry: (entry: Entry) => void, extra: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => onEntry(e as Entry))).observe({
        type,
        buffered: true,
        ...extra,
      });
    } catch {
      // An entry type this Chromium lacks: its metrics read empty.
    }
  };
  observe("longtask", (e) => store.lt.push({ start: e.startTime, duration: e.duration }));
  observe("long-animation-frame", (e) =>
    store.loaf.push({
      start: e.startTime,
      duration: e.duration,
      blocking: Number(e.blockingDuration),
      scripts: (e.scripts as Entry[]).map((s) => ({
        src: String(s.sourceURL),
        fn: String(s.sourceFunctionName),
        at: Number(s.sourceCharPosition),
        invoker: String(s.invoker),
        type: String(s.invokerType),
        ms: s.duration,
      })),
    }),
  );
  observe(
    "event",
    (e) => {
      if (Number(e.interactionId) > 0)
        store.ev.push({
          id: Number(e.interactionId),
          name: e.name,
          start: e.startTime,
          duration: e.duration,
          procStart: Number(e.processingStart),
          procEnd: Number(e.processingEnd),
        });
    },
    { durationThreshold: 16 },
  );
  observe("layout-shift", (e) => store.ls.push({ start: e.startTime, value: Number(e.value), input: !!e.hadRecentInput }));
  observe("largest-contentful-paint", (e) => (store.lcp = e.startTime));
  document.addEventListener("pointerdown", (e) => (store.down = e.timeStamp), { capture: true, passive: true });

  const lastBusyEnd = () =>
    Math.max(0, ...[store.lt.at(-1), store.loaf.at(-1)].map((e) => (e ? e.start + e.duration : 0)));
  store.quiet = (ms, max) =>
    new Promise((resolve) => {
      const begin = performance.now();
      const check = () => {
        const now = performance.now();
        if (now - Math.max(begin, lastBusyEnd()) >= ms) resolve(true);
        else if (now - begin >= max) resolve(false);
        else setTimeout(check, 50);
      };
      setTimeout(check, 50);
    });
  // Read layout and animations only once a frame has rendered: then they are clean, so the read forces
  // nothing — in a rAF callback it would force the frame's own style / layout and bill it to this script.
  const afterFrame = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, 0));
  store.animationsDone = (exclude, max) =>
    new Promise((resolve) => {
      const begin = performance.now();
      const check = () => {
        // Keyframe animations only: entrances, springs, confetti. A transition a ticker restarts (the idle
        // prompt's 4 Hz fill) would never end.
        const running = document
          .getAnimations()
          .some(
            (a) =>
              a instanceof CSSAnimation &&
              a.playState === "running" &&
              Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity) &&
              !exclude.includes(a.animationName),
          );
        if (!running) resolve(true);
        else if (performance.now() - begin >= max) resolve(false);
        else afterFrame(check);
      };
      afterFrame(check);
    });
  // The outcome: `selector` laid out (with exactly `text`, when given) — or, `gone`, not laid out — and
  // then, when given, `then` laid out. It must not hold yet: an action whose outcome is already there
  // proves nothing.
  store.arm = (selector, gone, timeoutMs, text, everyMs, then) => {
    let step = { selector, gone, text };
    // DOM only (no style, no layout): the element, with its text when one is asked for.
    const find = () => {
      const el = document.querySelector(step.selector);
      return el && (step.text === null || el.textContent?.trim() === step.text) ? el : null;
    };
    // The outcome off the layout (a box, or none): read only where layout is clean.
    const holds = () => (find()?.getClientRects().length ? !step.gone : step.gone);
    const what = `${selector}${text === null ? "" : ` "${text}"`}${then === null ? "" : ` then ${then}`}`;
    const begin = performance.now();
    store.pending = holds()
      ? Promise.reject(new Error(`perf: ${what} was already ${gone ? "gone" : "there"} before the action`))
      : new Promise<number>((resolve, reject) => {
          let rest = then;
          const advance = () => {
            if (rest !== null) step = { selector: rest, gone: false, text: null };
            rest = null;
          };
          // A chain's first screen can come and go between two polls: a mutation observer (passive — it
          // forces no frame and no layout) latches it the moment it enters the DOM.
          if (then !== null) {
            const latch = new MutationObserver(() => {
              if (rest !== null && !find()) return;
              advance();
              latch.disconnect();
            });
            latch.observe(document, { childList: true, subtree: true });
            setTimeout(() => latch.disconnect(), timeoutMs);
          }
          const check = () => {
            const hit = holds();
            if (hit && rest !== null) {
              advance();
              wait();
            } else if (hit) {
              // Confirmed right after the frame that laid it out: that frame is done once the next one
              // starts. Its rAF timestamp would be that frame's vsync, which a busy main thread runs long
              // after: read the clock instead.
              requestAnimationFrame(() => resolve(performance.now()));
            } else if (performance.now() - begin > timeoutMs) {
              reject(new Error(`perf: ${what} never ${gone ? "left" : "showed"} (${timeoutMs} ms)`));
            } else wait();
          };
          // The layout is read only for a candidate — in the DOM as a frame starts — once that frame has laid
          // it out: then it reads clean. A just-committed element read at once would have its first layout
          // forced here, and billed to this script.
          const candidate = () => step.gone || find() !== null;
          const wait = everyMs
            ? () => setTimeout(() => (candidate() ? afterFrame(check) : check()), everyMs)
            : () => requestAnimationFrame(() => (candidate() ? setTimeout(check, 0) : check()));
          wait();
        });
    store.pending.catch(() => undefined);
  };
  store.startFrames = () => {
    const frames: number[] = [];
    store.frames = frames;
    const loop = (t: number) => {
      if (store.frames !== frames) return;
      frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  store.take = (from, to) => {
    const within = <T extends { start: number }>(list: T[]) => list.filter((e) => e.start >= from && e.start <= to);
    // A long animation frame starts at its first task, which can be t0's own evaluate: overlap, not start.
    const overlapping = <T extends { start: number; duration: number }>(list: T[]) =>
      list.filter((e) => e.start + e.duration >= from && e.start <= to);
    const frames = store.frames ?? [];
    store.frames = null;
    return { lt: overlapping(store.lt), loaf: overlapping(store.loaf), ev: within(store.ev), ls: within(store.ls), frames, down: store.down };
  };
  store.clear = () => {
    for (const list of [store.lt, store.loaf, store.ev, store.ls]) list.length = 0;
  };
}

export interface Perf {
  page: Page;
  cdp: CDPSession;
  rate: number;
}

/** BEFORE the first goto: the in-page observers, a CDP session, the calibrated CPU. */
export async function startPerf(page: Page, rate = CPU_RATE): Promise<Perf> {
  await page.addInitScript(collector);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return { page, cdp, rate };
}

const DURATIONS = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskOtherDuration"] as const;
const COUNTS = ["LayoutCount", "RecalcStyleCount"] as const;
type Counters = Record<(typeof DURATIONS)[number] | (typeof COUNTS)[number], number>;
async function counters(cdp: CDPSession): Promise<Counters> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const byName = new Map(metrics.map((m) => [m.name, m.value]));
  return Object.fromEntries([...DURATIONS, ...COUNTS].map((name) => [name, byName.get(name) ?? 0])) as Counters;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
/** Nearest rank (the frame gaps' p50 / p95). */
const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
/** The middle value, or the mean of the two middle values. */
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

export interface Sample {
  label: string;
  wallMs: number;
  /** A pointerdown landed in the window (a tap window without one throws). */
  tapped: boolean;
  /** The window's slowest interaction (Event Timing). null: no event ≥ 16 ms — the table counts it as < 16 ms. */
  latencyMs: number | null;
  interactions: { latencyMs: number; inputDelayMs: number; processingMs: number; presentationMs: number; events: string[] }[];
  /** Pointerdown (navigation start for a load) → the start of the frame after the outcome first laid out. */
  toVisibleMs: number | null;
  longTasks: number;
  tbtMs: number;
  longTaskMaxMs: number;
  loafCount: number;
  loafMaxMs: number;
  loafMaxBlockingMs: number;
  /** The window's 3 longest animation frames, each with its 3 longest scripts (production bundle: minified). */
  loafTop: { ms: number; blockingMs: number; scripts: Script[] }[];
  cls: number;
  /**
   * rAF frame pacing (taps and flings; null where the sampler is off). Gaps land on the 16.7 ms vsync grid,
   * so the thresholds sit between grid points: over33 = gaps of ≥ 2 intervals (≥ 33.3 ms: one frame or more
   * missed), over50 = ≥ 3 intervals (≥ 50 ms); dropped = every vsync missed, summed.
   */
  frames: { count: number; fps: number; p50: number; p95: number; max: number; over33: number; over50: number; dropped: number } | null;
  /** CDP Performance.getMetrics deltas: durations in ms, *Count as counts; busyPct = TaskDuration / wall. */
  cdp: Record<(typeof DURATIONS)[number] | (typeof COUNTS)[number], number> & { busyPct: number };
  quiet: boolean;
  detail?: Record<string, unknown>;
}

/**
 * `origin`: what toVisibleMs counts from — the tap's pointerdown, navigation start (0), or nothing.
 * `before`: the counters at t0 — null when `after` is a fresh document's own, counted from zero (a load).
 */
function summarize(label: string, t0: number, t1: number, raw: Taken, before: Counters | null, after: Counters, visibleAt: number | void, origin: number | null, tapped: boolean, quiet: boolean): Sample {
  const byId = new Map<number, EventTiming[]>();
  for (const e of raw.ev) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  const interactions = [...byId.values()].map((events) => {
    const slowest = events.reduce((a, b) => (b.duration > a.duration ? b : a));
    return {
      latencyMs: slowest.duration,
      inputDelayMs: round(Math.min(...events.map((e) => e.procStart - e.start))),
      processingMs: round(events.reduce((sum, e) => sum + (e.procEnd - e.procStart), 0)),
      presentationMs: round(Math.max(0, slowest.start + slowest.duration - Math.max(...events.map((e) => e.procEnd)))),
      events: events.map((e) => e.name),
    };
  });
  const deltas = raw.frames.slice(1).map((t, i) => t - raw.frames[i]);
  const delta = (name: keyof Counters) => after[name] - (before?.[name] ?? 0);
  const wallMs = round(t1 - t0);
  const loafs = [...raw.loaf].sort((a, b) => b.duration - a.duration);
  return {
    label,
    wallMs,
    tapped,
    latencyMs: interactions.length ? Math.max(...interactions.map((i) => i.latencyMs)) : null,
    interactions,
    toVisibleMs: typeof visibleAt === "number" && origin !== null ? round(visibleAt - origin) : null,
    longTasks: raw.lt.length,
    tbtMs: round(raw.lt.reduce((sum, e) => sum + Math.max(0, e.duration - 50), 0)),
    longTaskMaxMs: round(Math.max(0, ...raw.lt.map((e) => e.duration))),
    loafCount: raw.loaf.length,
    loafMaxMs: round(loafs[0]?.duration ?? 0),
    loafMaxBlockingMs: round(Math.max(0, ...raw.loaf.map((e) => e.blocking))),
    loafTop: loafs.slice(0, 3).map((e) => ({
      ms: round(e.duration),
      blockingMs: round(e.blocking),
      scripts: [...e.scripts].sort((a, b) => b.ms - a.ms).slice(0, 3).map((s) => ({ ...s, ms: round(s.ms) })),
    })),
    cls: round(raw.ls.filter((e) => !e.input).reduce((sum, e) => sum + e.value, 0), 4),
    frames: raw.frames.length
      ? {
          count: raw.frames.length,
          fps: round(raw.frames.length / (wallMs / 1000)),
          p50: round(percentile(deltas, 50)),
          p95: round(percentile(deltas, 95)),
          max: round(Math.max(0, ...deltas)),
          over33: deltas.filter((d) => d > 1.5 * VSYNC_MS).length,
          over50: deltas.filter((d) => d > 2.5 * VSYNC_MS).length,
          dropped: deltas.reduce((sum, d) => sum + Math.max(0, Math.round(d / VSYNC_MS) - 1), 0),
        }
      : null,
    cdp: {
      ...(Object.fromEntries(DURATIONS.map((name) => [name, round(delta(name) * 1000)])) as Record<(typeof DURATIONS)[number], number>),
      ...(Object.fromEntries(COUNTS.map((name) => [name, delta(name)])) as Record<(typeof COUNTS)[number], number>),
      busyPct: round((delta("TaskDuration") * 100_000) / wallMs),
    },
    quiet,
  };
}

/** Animations done, then quiet (header). */
async function settled(page: Page) {
  await page.evaluate(([exclude, cap]) => (window as unknown as W).__perf.animationsDone(exclude, cap), [LONG_ANIMATIONS, QUIET_CAP_MS] as const);
  return page.evaluate((cap) => (window as unknown as W).__perf.quiet(300, cap), QUIET_CAP_MS);
}

export interface Outcome {
  /** A selector whose appearance (or, with `gone`, disappearance) is the action's outcome. */
  until: string;
  /** ...laid out with exactly this text (trimmed textContent): a display, a counter. */
  text?: string;
  gone?: boolean;
  /** ...and after it, this selector laid out (a chain of screens: no precondition on it). */
  then?: string;
  timeoutMs?: number;
}
/** `everyMs` 0 polls each frame (a tap's outcome, timed to the frame); > 0 on a timer (an idle window's). */
const arm = (page: Page, { until: selector, gone = false, timeoutMs = 60_000, text, then }: Outcome, everyMs = 0) =>
  page.evaluate(([s, g, t, x, e, n]) => (window as unknown as W).__perf.arm(s, g, t, x, e, n), [selector, gone, timeoutMs, text ?? null, everyMs, then ?? null] as const);
const pending = (page: Page) => page.evaluate(() => (window as unknown as W).__perf.pending ?? 0);

interface WindowOptions {
  /** A tap: it must land a pointerdown, and toVisible counts from it. */
  tapped?: boolean;
  /** Run the rAF frame sampler (header). */
  frames?: boolean;
}
/** The window itself, from an already settled screen. */
async function observed(perf: Perf, label: string, run: () => Promise<number | void>, { tapped = false, frames = false }: WindowOptions): Promise<Sample> {
  const { page, cdp } = perf;
  const before = await counters(cdp);
  const t0 = await page.evaluate((sample) => {
    if (sample) (window as unknown as W).__perf.startFrames();
    return performance.now();
  }, frames);
  const visibleAt = await run();
  const quiet = await settled(page);
  const t1 = await page.evaluate(() => performance.now());
  const after = await counters(cdp);
  const raw = await page.evaluate(([from, to]) => (window as unknown as W).__perf.take(from, to), [t0, t1]);
  if (tapped && !(raw.down >= t0)) throw new Error(`perf: ${label}: no pointerdown landed in the window`);
  return summarize(label, t0, t1, raw, before, after, visibleAt, tapped ? raw.down : null, tapped, quiet);
}

/** One measured window, opened once the screen has settled. `run` resolves to the in-page time its outcome showed (or nothing). */
export async function measure(perf: Perf, label: string, run: () => Promise<number | void>, opts: WindowOptions = {}): Promise<Sample> {
  await settled(perf.page);
  return observed(perf, label, run, opts);
}

/**
 * A page load: navigation start (`url`, or a reload for null) → `ready` laid out → settled, with
 * FCP / LCP / DCL / load in `detail`. The outcome watch starts at commit, before the load event.
 */
export async function load(perf: Perf, label: string, url: string | null, ready: string): Promise<Sample> {
  const { page, cdp } = perf;
  const before = await counters(cdp);
  await (url === null ? page.reload({ waitUntil: "commit" }) : page.goto(url, { waitUntil: "commit" }));
  // A new document may come with a new DevTools performance agent (RenderDocument, a process swap), whose
  // counters start from zero: then they are this load's alone. One agent's counters never go down, and at
  // commit a new one has done almost nothing (no layout yet): a drop proves the swap.
  const atCommit = await counters(cdp);
  const fresh = atCommit.TaskDuration < before.TaskDuration || atCommit.LayoutCount < before.LayoutCount;
  await arm(page, { until: ready });
  const visibleAt = await pending(page);
  const quiet = await settled(page);
  const t1 = await page.evaluate(() => performance.now());
  const after = await counters(cdp);
  const raw = await page.evaluate((to) => (window as unknown as W).__perf.take(0, to), t1);
  const detail = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, Math.round(e.startTime)]));
    const scripts = performance.getEntriesByType("resource").filter((e) => (e as PerformanceResourceTiming).initiatorType === "script");
    return {
      fcpMs: paint["first-contentful-paint"] ?? null,
      lcpMs: Math.round((window as unknown as W).__perf.lcp),
      domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd ?? 0),
      loadMs: Math.round(nav?.loadEventEnd ?? 0),
      scriptsLoaded: scripts.length,
    };
  });
  return { ...summarize(label, 0, t1, raw, fresh ? null : before, after, visibleAt, 0, false, quiet), detail: { ...detail, freshCounters: fresh } };
}

/** A measured touch tap on `target` (header): actionable first, then settled, then its centre. */
export async function tap(perf: Perf, label: string, target: Locator, outcome: Outcome): Promise<Sample> {
  const { page } = perf;
  await target.click({ trial: true, timeout: 60_000 });
  await settled(page);
  const box = await target.boundingBox();
  if (!box) throw new Error(`perf: ${label} has no box`);
  return observed(
    perf,
    label,
    async () => {
      await arm(page, outcome);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      return pending(page);
    },
    { tapped: true, frames: true },
  );
}

/** A toggle's outcome: its aria-pressed / aria-checked flips — or, on the PDP's two-button card, data-selected. */
export async function flipOf(target: Locator): Promise<Outcome> {
  const id = tid((await target.getAttribute("data-testid")) ?? "");
  for (const attr of ["aria-pressed", "aria-checked"]) {
    const value = await target.getAttribute(attr);
    if (value !== null) return { until: `${id}[${attr}="${value === "true" ? "false" : "true"}"]` };
  }
  return { until: (await target.getAttribute("data-selected")) === "true" ? `${id}:not([data-selected="true"])` : `${id}[data-selected="true"]` };
}

/** The deliberate, measured idle window: nothing is driven for `ms`. */
export const idle = (perf: Perf, label: string, ms: number) => measure(perf, label, () => sleep(ms));

/** A window that ends when `selector` (and then `then`) shows by itself — a timer's outcome: nothing is driven. */
export const until = (perf: Perf, label: string, selector: string, timeoutMs = 60_000, then?: string) =>
  measure(perf, label, async () => {
    await arm(perf.page, { until: selector, timeoutMs, then }, 100);
    return pending(perf.page);
  });

/**
 * A measured touch fling (CDP Input.synthesizeScrollGesture, the compositor's own scroll path) on the
 * centre of `pane`: `distance` px down (negative = up). `detail`: how far it moved, and its overflow.
 */
export async function fling(perf: Perf, label: string, pane: Locator, distance: number): Promise<Sample> {
  const box = await pane.boundingBox();
  if (!box) throw new Error(`perf: ${label} has no pane`);
  const scrollTop = () => pane.evaluate((el) => el.scrollTop);
  const from = await scrollTop();
  const sample = await measure(
    perf,
    label,
    async () => {
      await perf.cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
        yDistance: -distance,
        speed: 2_000,
        gestureSourceType: "touch",
      });
    },
    { frames: true },
  );
  const overflowPx = await pane.evaluate((el) => el.scrollHeight - el.clientHeight);
  return { ...sample, detail: { scrolledPx: (await scrollTop()) - from, overflowPx } };
}

export interface Memory {
  heapMB: number;
  nodes: number;
  listeners: number;
  documents: number;
}
/**
 * After a full GC: the JS heap, live DOM nodes and JS event listeners (CDP Memory.getDOMCounters). Read
 * between windows only: it first drops the collector's own entries, so they never count as the app's heap.
 */
export async function memory({ page, cdp }: Perf): Promise<Memory> {
  await page.evaluate(() => (window as unknown as W).__perf.clear());
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  return { heapMB: round(usedSize / 2 ** 20, 2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
}

/* ---- the report ---- */

export interface Scenario {
  name: string;
  status: "ok" | "skipped" | "failed";
  reason?: string;
  cpuRate?: number;
  /** The host's 1-minute load average when the scenario finished (this machine's noise). */
  load1?: number;
  samples: Sample[];
  memory?: Memory;
  extra?: Record<string, unknown>;
}
interface Report {
  label: string;
  startedAt: string;
  host: { cpu: string; cores: number; memGB: number; loadavg: number[] };
  calibration: { cpuRate: number; chromiumArgs: string[] };
  scenarios: Scenario[];
}

/** test-results/perf/perf-<label>.json — the runner wipes test-results at each run start. */
export const reportPath = () => join(test.info().project.outputDir, "perf", `perf-${PERF_LABEL}.json`);

function readReport(path: string): Report {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as Report;
  return {
    label: PERF_LABEL,
    startedAt: new Date().toISOString(),
    host: { cpu: cpus()[0]?.model ?? "?", cores: cpus().length, memGB: round(totalmem() / 2 ** 30), loadavg: loadavg().map((n) => round(n)) },
    calibration: { cpuRate: CPU_RATE, chromiumArgs: LOW_END_ARGS },
    scenarios: [],
  };
}

/** Written through at once (the spec runs on one worker): a later failure never loses a finished scenario. */
export function record(scenario: Scenario) {
  const path = reportPath();
  mkdirSync(join(path, ".."), { recursive: true });
  const report = readReport(path);
  report.scenarios = [...report.scenarios.filter((s) => s.name !== scenario.name), { ...scenario, load1: round(loadavg()[0]) }];
  writeFileSync(path, JSON.stringify(report, null, 2));
}

/**
 * A named section: its samples, then the heap after GC. A throw records it "failed" (and fails the test);
 * a state the harness genuinely cannot reach is `skipped(name, reason)`.
 */
export async function scenario(perf: Perf, name: string, body: (samples: Sample[]) => Promise<Record<string, unknown> | void>) {
  const samples: Sample[] = [];
  try {
    const extra = await body(samples);
    record({ name, status: "ok", cpuRate: perf.rate, samples, memory: await memory(perf), ...(extra ? { extra } : {}) });
  } catch (error) {
    record({ name, status: "failed", reason: String(error).slice(0, 500), cpuRate: perf.rate, samples });
    throw error;
  }
}
export const skipped = (name: string, reason: string) => record({ name, status: "skipped", reason, samples: [] });

/** One table row: a (scenario, step label) pair over its n windows. */
interface Row {
  scenario: string;
  step: string;
  n: number;
  /** Median Event Timing latency of the taps (a tap with no event ≥ 16 ms counts as 0, "< 16 ms"). */
  latencyMs: number | null;
  toVisibleMs: number | null;
  tbtMs: number | null;
  longTasks: number | null;
  /** The longest animation frame of the n windows. */
  loafMaxMs: number | null;
  over33: number | null;
  busyPct: number | null;
  /** The scenario's heap after GC (its first row only). */
  heapMB: number | null;
}

/** Medians per (scenario, step label); a scenario without samples (skipped, failed, memory) is one row. */
function rows(report: Report): Row[] {
  return report.scenarios.flatMap((s): Row[] => {
    const blank = { latencyMs: null, toVisibleMs: null, tbtMs: null, longTasks: null, loafMaxMs: null, over33: null, busyPct: null };
    if (s.status !== "ok" || !s.samples.length)
      return [{ scenario: s.name, step: s.status === "ok" ? "–" : `${s.status}: ${s.reason ?? ""}`, n: 0, ...blank, heapMB: s.memory?.heapMB ?? null }];
    return [...new Set(s.samples.map((x) => x.label))].map((label, i) => {
      const samples = s.samples.filter((x) => x.label === label);
      const pick = (f: (x: Sample) => number | null | undefined) => median(samples.map(f).filter((v): v is number => typeof v === "number"));
      return {
        scenario: s.name,
        step: label,
        n: samples.length,
        latencyMs: pick((x) => (x.tapped ? (x.latencyMs ?? 0) : null)),
        toVisibleMs: pick((x) => x.toVisibleMs),
        tbtMs: pick((x) => x.tbtMs),
        longTasks: pick((x) => x.longTasks),
        loafMaxMs: Math.max(...samples.map((x) => x.loafMaxMs)),
        over33: pick((x) => x.frames?.over33),
        busyPct: pick((x) => x.cdp.busyPct),
        heapMB: i === 0 ? (s.memory?.heapMB ?? null) : null,
      };
    });
  });
}

const cell = (value: number | null | undefined, unit = "") => (value === null || value === undefined ? "–" : `${value}${unit}`);

/**
 * Where the long animation frames spent their script time, over every window of the run: the windows'
 * top frames' scripts summed by invoker + source position (the build is minified: map `file:char`
 * with a `vite build --sourcemap` of the same commit).
 */
function hotspots(report: Report) {
  const byKey = new Map<string, { ms: number; frames: number; scenarios: Set<string> }>();
  for (const s of report.scenarios)
    for (const sample of s.samples)
      for (const frame of sample.loafTop)
        for (const script of frame.scripts) {
          const key = `${script.invoker} · ${script.src.split("/").at(-1)}:${script.at} ${script.fn}`.trim();
          const hit = byKey.get(key) ?? { ms: 0, frames: 0, scenarios: new Set<string>() };
          hit.ms += script.ms;
          hit.frames += 1;
          hit.scenarios.add(s.name);
          byKey.set(key, hit);
        }
  return [...byKey.entries()]
    .sort(([, a], [, b]) => b.ms - a.ms)
    .slice(0, 15)
    .map(([script, hit]) => ({ script, ms: round(hit.ms), frames: hit.frames, scenarios: [...hit.scenarios] }));
}

/**
 * The compact table: one row per (scenario, step) with its window count n — medians, except LoAF max (its
 * longest frame). busy % = the renderer main thread's TaskDuration over the window's wall time.
 */
export function table(): string {
  const report = readReport(reportPath());
  let last = "";
  const lines = rows(report).map((r) => {
    const name = r.scenario === last ? "" : r.scenario;
    last = r.scenario;
    const latency = r.latencyMs === null ? "–" : r.latencyMs < 16 ? "< 16 ms" : `${r.latencyMs} ms`;
    return `| ${[name, r.step, r.n || "", latency, cell(r.toVisibleMs, " ms"), cell(r.tbtMs, " ms"), cell(r.longTasks), cell(r.loafMaxMs, " ms"), cell(r.over33), cell(r.busyPct), cell(r.heapMB)].join(" | ")} |`;
  });
  const hot = hotspots(report).slice(0, 8);
  return [
    `perf-${report.label} · CPU ${report.calibration.cpuRate}× · ${report.calibration.chromiumArgs.join(" ")} · host ${report.host.cpu}, load ${report.host.loadavg.join(" ")}`,
    "",
    "| scenario | step | n | median latency | → visible | TBT | long tasks | LoAF max | frames > 33 ms | busy % | heap MB |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...lines,
    "",
    "LoAF script hotspots (ms summed over the windows' longest frames):",
    ...hot.map((h) => `- ${h.ms} ms in ${h.frames} frames — ${h.script} (${h.scenarios.slice(0, 3).join("; ")}${h.scenarios.length > 3 ? "; …" : ""})`),
  ].join("\n");
}

/** Adds the table's rows (with n) and the hotspots to the JSON, writes the table beside it (perf-<label>.md) and returns it. */
export function writeTable(): string {
  const path = reportPath();
  const report = readReport(path);
  writeFileSync(path, JSON.stringify({ ...report, summary: rows(report), hotspots: hotspots(report) }, null, 2));
  const text = table();
  writeFileSync(path.replace(/\.json$/, ".md"), `${text}\n`);
  return text;
}
