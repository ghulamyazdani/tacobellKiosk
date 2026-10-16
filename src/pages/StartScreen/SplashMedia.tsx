import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  kiosSettingsRdx,
  mediaDataRdx,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  toSplashSlides,
  type SplashSlide,
} from "@cx-sdk/catalog/media/splashMedia";
import { DEFAULT_LANGUAGE } from "../../i18n";
import { STAGE_WIDTH } from "../../components/stage/KioskStage";
import { safeVideoPlay } from "../../utils/safeVideoPlay";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.webp";
import welcomePhoto from "../../assets/splash/fullbleed-halfmoon.jpg";
import star1 from "../../assets/splash/star-1.svg";
import star2 from "../../assets/splash/star-2.svg";
import star3 from "../../assets/splash/star-3.svg";
import star4 from "../../assets/splash/star-4.svg";
import star5 from "../../assets/splash/star-5.svg";
import star6 from "../../assets/splash/star-6.svg";
import tbBell from "../../assets/brand/tb-bell.svg";
import {
  focusAt,
  matrixOf,
  PITCH,
  settleMs,
  SWIPE_SLOP_PX,
  SWIPE_VELOCITY_MS,
  target,
  velocity,
  type Sample,
} from "./splashSwipe";

/**
 * No playback progress ('playing'/'timeupdate') for this long ⇒ the video
 * slide is skipped. HARDWARE KNOB: raise it if a legitimate first-play
 * buffer on the store uplink takes longer.
 */
const SPLASH_VIDEO_STALL_MS = 15_000;

/**
 * OPS KNOB (D9): a slide that errored or stalled sits out this long after the
 * LAST failure, then gets one more try. `no_video` (a codec fact, never a
 * blip) is not retried within the visit.
 */
export const SPLASH_RETRY_MS = 10 * 60_000;

/**
 * `path|kind` → when last reported (monotonic). A broken asset fails on every
 * visit (and twice in a 2-slide peek): one event per asset per hour instead,
 * which still re-surfaces on a kiosk that runs for days (safeVideoPlay's rule).
 * Keyed by the URL PATH (query and hash stripped, as the SDK engine's video
 * test does): a boot refresh (P9e) re-signs S3 URLs, and a new signature must
 * not reset the hourly limit.
 */
const lastReported = new Map<string, number>();
const SPLASH_REPORT_WINDOW_MS = 60 * 60 * 1000;

const MEDIA = "pointer-events-none absolute inset-0 h-full w-full object-cover";
/** Figma Title/H1 (Exp Bl 116/98, −3.27) — the splash's one line. */
const H1 =
  "tb-display text-[116px] leading-[98px] tracking-[-3.27px] text-tb-surface";
/**
 * A 1:2203 card's mover: all three share the Figma box; the slot (and the
 * focus) is its transform — .tb-splash-card's, or inline while a finger
 * holds it. Never a Tailwind translate-* / scale-* here (one owner).
 */
const MOVER = "tb-splash-card absolute left-[200px] top-[345px] h-[1043px] w-[680px]";
/** The 1:2203 card itself, inside its mover (the shadow scales with it). */
const CARD =
  "absolute inset-0 overflow-hidden rounded-[16px] bg-tb-purple-vibrant shadow-[0_100px_100px_-20px_rgba(0,0,0,0.2)]";
/** A peek's dimming: its own layer and radius, beside the card (no rounded clip around a promoted layer). */
const VEIL = "tb-splash-veil pointer-events-none absolute inset-0 rounded-[16px] bg-black";
/** --tb-settle after a release that stays (the snap-back), and after a failure or the retry (in place: still). */
const SNAP = "var(--tb-dur-snap)";
const STILL = "0s";

/** 1:5617 stars (FIGMA guide §0.8): intrinsic size, img top-left, rotate → mirror. */
const WELCOME_STARS = [
  [star1, "left-[864.1px] top-[1193.4px] rotate-[-140.59deg] -scale-x-100"],
  [star2, "left-[119.7px] top-[1723.8px] rotate-[-24.82deg] -scale-x-100"],
  [star3, "left-[703.6px] top-[497px] rotate-[-24.82deg] -scale-x-100"],
  [star4, "left-[888.7px] top-[296.4px] rotate-[31.84deg] -scale-x-100"],
  [star5, "left-[60.7px] top-[686.7px] rotate-[-155.18deg]"],
  [star6, "left-[188.3px] top-[141.5px] rotate-[24.82deg]"],
] as const;

type Role = "single" | "centre" | "peek";
type Kind = "load_error" | "stalled" | "no_video";
type Fail = (index: number, kind: Kind) => void;

interface Rotation {
  cur: number;
  failed: ReadonlyMap<number, Kind>;
  /**
   * The virtual position: the movers are keyed e−1 / e / e+1, so a step
   * re-slots the two that stay (their transitions carry on from wherever
   * they are) and mounts only the entrant.
   */
  e: number;
  /**
   * The last step's side (+1 = to the next): the entrant comes in from one
   * pitch further out (@starting-style). 0 at mount — the splash's first
   * frame (the idle return) is still — and after a failure or the retry,
   * whose content swaps in place.
   */
  dir: -1 | 0 | 1;
  /** A finger is down on the carousel: nothing advances (the dwell is off, a video's end waits). */
  held: boolean;
  /** The centre video ended under the finger: it advances at the release. */
  pending: boolean;
  /** The next settle's --tb-settle on the track; unset = --tb-dur-carousel. */
  settle: string | undefined;
}

/** The finger on the carousel (refs only: no render per move). */
interface Drag {
  id: number;
  /** The press, client px. */
  x: number;
  y: number;
  /** Client px per stage px (KioskStage's scale). */
  k: number;
  /** The centre's x when the finger landed (0 at rest; caught mid-flight otherwise): the follow's base. */
  base: number;
  /** The follow's offset (stage px, ±PITCH): every mover sits slot × PITCH + o. */
  o: number;
  /** Decided at the slop: "x" follows, "y" is neither a swipe nor a tap. */
  axis: "x" | "y" | null;
  /** ±SWIPE_SLOP_PX, latched at the slop: the follow starts there (no catch-up jump). */
  lock: number;
  /** [timeStamp, dx]: the press and the moves of the last SWIPE_VELOCITY_MS. */
  samples: Sample[];
  /** Reduced motion, read once at the press: the drag only translates. */
  still: boolean;
}

/** The next live slide from `from` going `step`, wrapping; `from` if none. */
function live(
  from: number,
  step: 1 | -1,
  n: number,
  failed: { has(i: number): boolean },
): number {
  for (let k = 1; k <= n; k += 1) {
    const i = (from + k * (n + step)) % n; // ≡ from + k·step, never negative
    if (!failed.has(i)) return i;
  }
  return from;
}

/** One card toward `to` (+1 = the next), over `settle` (unset = --tb-dur-carousel). */
const stepped = (r: Rotation, to: 1 | -1, n: number, settle: string | undefined): Rotation => ({
  ...r,
  cur: live(r.cur, to, n, r.failed),
  e: r.e + to,
  dir: to,
  held: false,
  pending: false,
  settle,
});

/**
 * The release, ONE commit: a step (speed-matched), else a video that ended
 * under the finger advances now (from where the cards are), else back to the
 * slots (the snap-back) — and the dwell re-arms in full.
 */
function released(r: Rotation, to: -1 | 0 | 1, settle: string, n: number): Rotation {
  if (to) return stepped(r, to, n, settle);
  if (r.pending && n - r.failed.size > 1) return stepped(r, 1, n, undefined);
  return { ...r, held: false, pending: false, settle };
}

const Bell = ({ className }: { className: string }) => (
  <img
    alt=""
    aria-hidden
    draggable={false}
    src={tbBell}
    className={`absolute left-[490px] h-[89px] w-[100px] ${className}`}
  />
);

/** 1:5604/1:5617 fill over the photo: 4% white → 16% violet at the foot. */
const Tint = () => (
  <div
    aria-hidden
    className="absolute inset-0 bg-linear-to-b from-white/4 from-[79.401%] to-tb-violet/16"
  />
);

/**
 * The splash's ONE line, on every layout (user decision 2026-10-16): the
 * backend's start_order_text_primary (cx/get_kiosk_settings — posistKiosk's
 * StartFooter copy), else ORDER HERE. Primary only: every splash visit runs
 * in the default language — the fallback pinned to it, as i18n catches up
 * with a session reset one effect late (App). ORDER HERE's place: its 756 px
 * column, bottom edge at y 1712, so a longer text grows upward. A word wider
 * than the column (~7+ letters: WELCOME 767, ANYWHERE 880 px) widens the box
 * to that word (min-content), centred between the stage's 24 px gutters,
 * instead of breaking mid-word (WELCOM / E).
 * ponytail: one size, no line clamp (overflow:hidden clips the first line's
 * accents at leading 98 < 116 px). Ceilings: one word over ~1032 px (~11+
 * letters) runs past the gutters (past 1080, the stage clips it), and a 3+
 * line text paints over the focused centre card's foot (by 22 px at three
 * lines; two clear it by 76, as the bell does); upgrade = a step-down size
 * (or a clamp) if an operator needs either.
 */
function SplashText() {
  const { t } = useTranslation();
  const custom: unknown =
    useSelector(kiosSettingsRdx)?.start_order_text_primary;
  const text =
    (typeof custom === "string" && custom.trim()) ||
    t("splash.orderHere", { lng: DEFAULT_LANGUAGE });
  return (
    <div className="absolute inset-x-[24px] bottom-[208px] flex justify-center">
      {/* dir="auto" on this LEAF only (P9f): an operator's Arabic text reads RTL. */}
      <span
        dir="auto"
        className={`${H1} w-max min-w-min max-w-[756px] text-center`}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * Figma 1:5617 — the neutral no-media frame (no price claim, user decision
 * 2026-10-01), its WELCOME / TOUCH ANYWHERE TO START now the one SplashText
 * line (2026-10-16). Also the media layer's ErrorBoundary fallback, and what
 * the splash falls back to when every configured slide failed.
 */
export function SplashWelcome() {
  return (
    <>
      <img
        alt=""
        aria-hidden
        draggable={false}
        src={welcomePhoto}
        className={MEDIA}
      />
      <Tint />
      {WELCOME_STARS.map(([src, position]) => (
        <img
          key={position}
          alt=""
          aria-hidden
          draggable={false}
          src={src}
          className={`absolute ${position}`}
        />
      ))}
      <Bell className="top-[101px]" />
      <SplashText />
    </>
  );
}

/**
 * The splash composition by PLAYABLE slide count (user decision 2026-10-01):
 * 0 → WELCOME (1:5617) · 1 → the 1:2203 centre card alone (user decision
 * 2026-10-13: an operator video carries its own captions, which full-bleed
 * 1:5604 covered with START ORDER) · ≥2 → the 1:2203 peek carousel — each
 * under the one SplashText line (2026-10-16). A slide that errors or stalls
 * is skipped, so the layout degrades 2 → 1 → WELCOME and is never blank or
 * stuck; the next visit (fresh mount) retries everything.
 * ponytail: retry — non-codec failures get one more try 10 min after the LAST
 * failure; fixed interval, no backoff (a dead URL costs one request / ≤15 s
 * frozen card per 10 min); back off if the physical soak shows churn.
 *
 * THE CAROUSEL (user request 2026-10-16; design language, sign-off): the
 * centre card in focus (1.10) between two dimmed peeks (0.88 under a 45 %
 * veil), and a swipe. Three movers keyed by a virtual position, the slot a
 * transform: CSS owns every motion — a step re-slots the movers and their
 * transitions carry them on from wherever they are (mid-drag, mid-settle or
 * at rest); the entrant comes in through @starting-style. JS writes only the
 * gesture, as ScrollIndicator does (direct manipulation, refs, no render per
 * move): the press freezes the cards where they are (the catch), the drag
 * follows the finger 1:1 past the slop with the focus a function of where
 * each card sits, and the release makes ONE commit — a step at 30 % of a
 * card or on a flick, settling at about the finger's speed (250–500 ms), or
 * back to the slots (300 ms). Nothing waits on a transition. A drag is never
 * a tap: a touch past the slop gets no click from Chromium, and a mouse's or
 * a pen's is swallowed here; a tap anywhere — mid-settle too — still starts
 * the order (the splash <button>'s onClick).
 */
export default function SplashMedia() {
  const mediaData: unknown = useSelector(mediaDataRdx);
  // One snapshot per visit, so a running rotation never reshuffles. Media
  // only changes at boot, and every boot — P9e's splash refreshes included —
  // runs on /LoadingResources: the splash unmounts, and the return trip
  // mounts a fresh layer that snapshots the new media. No key needed.
  const [slides] = useState(() => toSplashSlides(mediaData));
  const n = slides.length;
  const [{ cur, failed, e, dir, held, settle }, setRotation] = useState<Rotation>({
    cur: 0,
    failed: new Map(),
    e: 0,
    dir: 0,
    held: false,
    pending: false,
    settle: undefined,
  });

  // The rotation never moves under a finger: a video's end waits for the release.
  const advance = useCallback(
    () => setRotation((r) => (r.held ? { ...r, pending: true } : stepped(r, 1, n, undefined))),
    [n],
  );
  const fail = useCallback<Fail>(
    (index, kind) => {
      const key = `${slides[index]?.url.split(/[?#]/, 1)[0]}|${kind}`;
      const now = performance.now();
      const last = lastReported.get(key);
      if (last === undefined || now - last >= SPLASH_REPORT_WINDOW_MS) {
        lastReported.set(key, now);
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          error_source: "splash_media",
          failure_kind: kind,
          slide_index: index,
        });
      }
      setRotation((r) => {
        if (r.failed.has(index)) return r;
        const nowFailed = new Map(r.failed).set(index, kind);
        // Only the CURRENT slide failing moves the rotation (forward, in
        // place: no motion); a failed peek just drops out of the neighbours.
        // Every slide gone (WELCOME): no carousel is left under the finger,
        // so its release can never come — nothing is held any more.
        const gone = nowFailed.size === n;
        return {
          ...r,
          failed: nowFailed,
          cur: r.cur === index ? live(index, 1, n, nowFailed) : r.cur,
          dir: 0,
          settle: STILL,
          held: r.held && !gone,
          pending: r.pending && !gone,
        };
      });
    },
    [n, slides],
  );

  // One timer, re-armed by every new failure (`failed` is a new Map each
  // time), so the retry lands SPLASH_RETRY_MS after the LAST failure.
  useEffect(() => {
    // no_video is a codec fact, never a blip: not retried within the visit.
    if (![...failed.values()].some((kind) => kind !== "no_video")) return;
    const timer = window.setTimeout(
      () =>
        setRotation((r) => {
          const kept = new Map(
            [...r.failed].filter(([, kind]) => kind === "no_video"),
          );
          // H1: re-point cur — with every slide failed it sits on a failed
          // index (live() returned `from`); a kept no_video one would stick.
          return {
            ...r,
            failed: kept,
            cur: kept.has(r.cur) ? live(r.cur, 1, n, kept) : r.cur,
            dir: 0,
            settle: STILL,
          };
        }),
      SPLASH_RETRY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [failed, n]);

  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** A pointer crossed the slop since its press: its click is not a tap. */
  const swallow = useRef(false);

  const alive = n - failed.size;
  // One playable slide: the centre card alone, looping / never advancing —
  // and inert (no swipe).
  const single = alive === 1;

  /** Every mover with its veil, as rendered now. */
  const movers = () =>
    Array.from(track.current?.children ?? [], (el) => {
      const mover = el as HTMLElement;
      return { mover, veil: mover.querySelector<HTMLElement>(".tb-splash-veil"), slot: Number(mover.dataset.slot) };
    });

  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!ev.isPrimary || ev.button !== 0) return;
    swallow.current = false;
    if (single) return;
    const k = ev.currentTarget.getBoundingClientRect().width / STAGE_WIDTH || 1;
    // The catch: every card stops exactly where it is — mid-settle,
    // mid-snap-back or mid-advance — and the finger takes it from there.
    // Every read first, then every write (one style pass).
    const caught = movers().map((m) => ({
      ...m,
      at: matrixOf(getComputedStyle(m.mover).transform),
      opacity: m.veil ? getComputedStyle(m.veil).opacity : "",
    }));
    for (const { mover, veil, at, opacity } of caught) {
      mover.style.transition = "none";
      mover.style.transform = `translateX(${at[0]}px) scale(${at[1]})`;
      if (veil) {
        veil.style.transition = "none";
        veil.style.opacity = opacity;
      }
    }
    const base = caught.find((m) => m.slot === 0)?.at[0] ?? 0;
    // A primary press always starts afresh: a drag still on record lost its
    // end (its layer went away mid-gesture), and a second finger is never
    // primary.
    drag.current = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      k,
      base,
      o: base,
      axis: null,
      lock: 0,
      samples: [[ev.timeStamp, 0]],
      still: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    };
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      // jsdom / an inactive pointer: the moves that still reach the layer drive it.
    }
    setRotation((r) => (r.held ? r : { ...r, held: true }));
  };

  const onPointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d?.id !== ev.pointerId || single) return;
    const dx = (ev.clientX - d.x) / d.k;
    d.samples.push([ev.timeStamp, dx]);
    while (ev.timeStamp - d.samples[0][0] > SWIPE_VELOCITY_MS) d.samples.shift();
    if (!d.axis) {
      const dy = (ev.clientY - d.y) / d.k;
      if (Math.hypot(dx, dy) < SWIPE_SLOP_PX) return; // still a tap
      swallow.current = true; // past the slop: never a tap
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      d.lock = Math.sign(dx) * SWIPE_SLOP_PX;
    }
    if (d.axis === "y") return; // up or down: not a swipe (and not a tap)
    d.o = Math.max(-PITCH, Math.min(PITCH, d.base + dx - d.lock)); // one card at most
    for (const { mover, veil, slot } of movers()) {
      const focus = focusAt(slot, d.o, d.still);
      mover.style.transform = `translateX(${slot * PITCH + d.o}px) scale(${focus.scale})`;
      if (veil) veil.style.opacity = String(focus.veil);
    }
  };

  // Up, cancel or a lost capture (the browser releases the capture itself).
  const onPointerEnd = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d?.id !== ev.pointerId) return;
    drag.current = null;
    const dx = (ev.clientX - d.x) / d.k;
    const v = velocity(d.samples, [ev.timeStamp, dx]);
    const p = -d.o / PITCH; // positive toward the next
    const to = ev.type === "pointerup" && !single ? target(p, v, Math.abs(dx), d.axis === "x") : 0;
    // Every card back to its slot's CSS. Nothing reads layout before the
    // commit below, so each transition starts from the finger's last frame.
    for (const { mover, veil } of movers()) {
      mover.style.transform = "";
      mover.style.transition = "";
      if (veil) {
        veil.style.opacity = "";
        veil.style.transition = "";
      }
    }
    const ms = to ? `${settleMs(Math.abs(to - p) * PITCH, v)}ms` : SNAP;
    setRotation((r) => released(r, to, ms, n));
  };

  // A pointer that crossed the slop sends a click a mouse (or a pen) still
  // delivers: never a tap. Keyboard activation targets the button itself.
  const onClickCapture = (ev: ReactMouseEvent) => {
    if (!swallow.current) return;
    swallow.current = false;
    ev.stopPropagation();
    ev.preventDefault();
  };

  if (alive === 0) return <SplashWelcome />;
  // Exactly three movers (prev / current / next, wrapping) — ≤3 media
  // elements, and only the centre one ever plays a video (Rule 5). Keyed by
  // POSITION, not by slide: with ≤3 slides a wrap would carry a node across
  // the window. A step keeps the two that stay (their media too — never
  // re-decoded) and mounts the entrant, which comes in from the side it
  // steps from; the leaver unmounts at once.
  const slots = single ? [0] : [-1, 0, 1];
  return (
    // The gesture layer: the button's name (SplashText) is inside it, so it
    // carries no role and is never aria-hidden. The z-20 operator hotspot
    // and the update modal sit above it (siblings of the button).
    <div
      className={single ? "absolute inset-0" : "absolute inset-0 touch-none"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onClickCapture={onClickCapture}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "240px 240px",
          backgroundPosition: "top left",
        }}
      />
      <img
        alt=""
        aria-hidden
        draggable={false}
        src={plasticOverlay}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
      />
      <Bell className="top-[128px]" />
      <div
        ref={track}
        className={single ? "tb-splash-track absolute inset-0" : "tb-splash-track tb-splash-carousel absolute inset-0"}
        data-dir={dir || undefined}
        data-held={held ? "" : undefined}
        style={settle === undefined ? undefined : ({ "--tb-settle": settle } as CSSProperties)}
      >
        {slots.map((slot) => {
          const index = slot === 0 ? cur : live(cur, slot === 1 ? 1 : -1, n, failed);
          return (
            <div key={e + slot} data-slot={slot} className={single ? `${MOVER} tb-splash-single` : MOVER}>
              <div className={CARD}>
                <SlideMedia
                  key={index}
                  slide={slides[index]}
                  index={index}
                  role={single ? "single" : slot === 0 ? "centre" : "peek"}
                  held={held}
                  onDone={advance}
                  onFail={fail}
                />
              </div>
              {!single && <div aria-hidden className={VEIL} />}
            </div>
          );
        })}
      </div>
      <SplashText />
    </div>
  );
}

interface MediaProps {
  index: number;
  onDone: () => void;
  onFail: Fail;
}

function SlideMedia({
  slide,
  role,
  held,
  ...rest
}: MediaProps & { slide: SplashSlide; role: Role; held: boolean }) {
  if (slide.kind === "image") {
    // Only the centre image times the rotation — never under a finger: the
    // release re-arms it in full. A single image stays put.
    const dwellMs = role === "centre" && !held ? slide.durationMs : undefined;
    return <SlideImage url={slide.url} dwellMs={dwellMs} {...rest} />;
  }
  // A peeking video shows the card colour: one decoder at a time (Rule 5).
  if (role === "peek") return null;
  return (
    <SlideVideo
      url={slide.url}
      plays={slide.plays}
      loop={role === "single"}
      {...rest}
    />
  );
}

function SlideImage({
  url,
  dwellMs,
  index,
  onDone,
  onFail,
}: MediaProps & { url: string; dwellMs: number | undefined }) {
  useEffect(() => {
    if (dwellMs === undefined) return;
    const timer = window.setTimeout(onDone, dwellMs);
    return () => window.clearTimeout(timer);
  }, [dwellMs, onDone]);

  return (
    <img
      alt=""
      aria-hidden
      draggable={false}
      src={url}
      onError={() => onFail(index, "load_error")}
      className={MEDIA}
    />
  );
}

/**
 * One <video> per visit of a slide (the parent keys it), so per-slide counters
 * reset and no src is ever swapped under a pending play(). The fork waited for
 * 'ended' forever (D6) and only pause()d on teardown (D8).
 */
function SlideVideo({
  url,
  plays,
  loop,
  index,
  onDone,
  onFail,
}: MediaProps & { url: string; plays: number; loop: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const watchdog = useRef<number | undefined>(undefined);
  const played = useRef(0);

  // Re-armed by every sign of progress; firing = never started, or frozen.
  // A hidden page (display asleep, screen locked) pauses video, so the check
  // waits while hidden, and becoming visible starts a fresh window (an
  // overdue throttled timer would otherwise fire before 'playing').
  const arm = useCallback(() => {
    window.clearTimeout(watchdog.current);
    const check = () => {
      if (document.hidden) {
        watchdog.current = window.setTimeout(check, SPLASH_VIDEO_STALL_MS);
      } else onFail(index, "stalled");
    };
    watchdog.current = window.setTimeout(check, SPLASH_VIDEO_STALL_MS);
  }, [index, onFail]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // src is set HERE, not as a prop: the cleanup strips it to free the
    // decoder, and StrictMode's immediate re-run must put it back.
    video.src = url;
    arm();
    safeVideoPlay(video, "splash_video");
    const onVisibility = () => {
      if (!document.hidden) arm();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(watchdog.current);
      video.pause();
      video.removeAttribute("src");
      video.load(); // releases the decoder + connection now, not at GC
    };
  }, [url, arm]);

  // `loop` (the single slide) never fires 'ended'.
  const onEnded = useCallback(() => {
    played.current += 1;
    if (played.current < plays) safeVideoPlay(ref.current, "splash_video");
    else {
      // Done, so no more progress: never a stall — a finger holding the
      // cards defers the advance to its release, however long it holds.
      window.clearTimeout(watchdog.current);
      onDone();
    }
  }, [plays, onDone]);

  return (
    <video
      ref={ref}
      aria-hidden
      muted
      playsInline
      autoPlay
      preload="auto"
      loop={loop}
      onPlaying={arm}
      onTimeUpdate={arm}
      onEnded={onEnded}
      onError={() => onFail(index, "load_error")}
      // An undecodable video track beside decodable audio (HEVC/ProRes + AAC
      // on Chromium) plays audio-only: no error, progress, 'ended' — and a
      // blank card. Dimensions are known by HAVE_METADATA (spec).
      onLoadedMetadata={(e) => {
        if (!e.currentTarget.videoWidth) onFail(index, "no_video");
      }}
      className={MEDIA}
    />
  );
}
