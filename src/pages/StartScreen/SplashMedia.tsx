import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { mediaDataRdx } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  toSplashSlides,
  type SplashSlide,
} from "@cx-sdk/catalog/media/splashMedia";
import { safeVideoPlay } from "../../utils/safeVideoPlay";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.jpg";
import welcomePhoto from "../../assets/splash/fullbleed-halfmoon.jpg";
import star1 from "../../assets/splash/star-1.svg";
import star2 from "../../assets/splash/star-2.svg";
import star3 from "../../assets/splash/star-3.svg";
import star4 from "../../assets/splash/star-4.svg";
import star5 from "../../assets/splash/star-5.svg";
import star6 from "../../assets/splash/star-6.svg";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * No playback progress ('playing'/'timeupdate') for this long ⇒ the video
 * slide is skipped. HARDWARE KNOB: raise it if a legitimate first-play
 * buffer on the store uplink takes longer.
 */
const SPLASH_VIDEO_STALL_MS = 15_000;

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
const CENTRED = "absolute left-1/2 -translate-x-1/2";
/** Figma Title/H5 (Exp Bl 32/32, −1) — every splash CTA. */
const CTA =
  "tb-display whitespace-nowrap text-[32px] leading-[32px] tracking-[-1px] text-tb-surface";
/** Figma Title/H1 (Exp Bl 116/98, −3.27) — WELCOME, ORDER HERE. */
const H1 =
  "tb-display text-[116px] leading-[98px] tracking-[-3.27px] text-tb-surface";
/** 1:2203 card (all three share it; x comes per position). */
const CARD =
  "absolute top-[345px] h-[1043px] w-[680px] overflow-hidden rounded-[16px] bg-tb-purple-vibrant shadow-[0_100px_100px_-20px_rgba(0,0,0,0.2)]";

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
type Fail = (
  index: number,
  kind: "load_error" | "stalled" | "no_video",
) => void;

interface Rotation {
  cur: number;
  failed: ReadonlySet<number>;
}

/** The next live slide from `from` going `step`, wrapping; `from` if none. */
function live(
  from: number,
  step: 1 | -1,
  n: number,
  failed: ReadonlySet<number>,
): number {
  for (let k = 1; k <= n; k += 1) {
    const i = (from + k * (n + step)) % n; // ≡ from + k·step, never negative
    if (!failed.has(i)) return i;
  }
  return from;
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
 * Figma 1:5617 — the neutral no-media frame (no price claim, user decision
 * 2026-10-01). Also the media layer's ErrorBoundary fallback, and what the
 * splash falls back to when every configured slide failed.
 */
export function SplashWelcome() {
  const { t } = useTranslation();
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
      <span className={`${H1} ${CENTRED} top-[1548px] whitespace-nowrap`}>
        {t("splash.welcome")}
      </span>
      <span className={`${CTA} ${CENTRED} top-[1752px]`}>
        {t("splash.touchToStart")}
      </span>
    </>
  );
}

/**
 * The splash composition by PLAYABLE slide count (user decision 2026-10-01):
 * 0 → WELCOME (1:5617) · 1 → full-bleed media (1:5604 frame; the promo words
 * and stars live IN the media) · ≥2 → the 1:2203 peek carousel. A slide that
 * errors or stalls is skipped for the rest of this visit, so the layout
 * degrades 2 → 1 → WELCOME and is never blank or stuck; the next visit
 * (fresh mount) retries everything.
 * ponytail: no timed retry within a visit — a splash idling through a network
 * blip stays degraded until the next guest; clear `failed` on a timer if ops
 * ever see that.
 */
export default function SplashMedia() {
  const { t } = useTranslation();
  const mediaData: unknown = useSelector(mediaDataRdx);
  // One snapshot per visit, so a running rotation never reshuffles. Media
  // only changes at boot, and every boot — P9e's splash refreshes included —
  // runs on /LoadingResources: the splash unmounts, and the return trip
  // mounts a fresh layer that snapshots the new media. No key needed.
  const [slides] = useState(() => toSplashSlides(mediaData));
  const n = slides.length;
  const [{ cur, failed }, setRotation] = useState<Rotation>({
    cur: 0,
    failed: new Set(),
  });

  const advance = useCallback(
    () => setRotation((r) => ({ ...r, cur: live(r.cur, 1, n, r.failed) })),
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
        const nowFailed = new Set(r.failed).add(index);
        // Only the CURRENT slide failing moves the rotation; a failed peek
        // just drops out of the neighbours.
        return {
          failed: nowFailed,
          cur: r.cur === index ? live(index, 1, n, nowFailed) : r.cur,
        };
      });
    },
    [n, slides],
  );

  const alive = n - failed.size;
  if (alive === 0) return <SplashWelcome />;
  const slide = slides[cur]; // `cur` is always a live index while alive > 0

  if (alive === 1) {
    return (
      <>
        <SlideMedia
          key={cur}
          slide={slide}
          index={cur}
          role="single"
          onDone={advance}
          onFail={fail}
        />
        <Tint />
        <Bell className="top-[101px]" />
        <span className={`${CTA} ${CENTRED} top-[1752px]`}>
          {t("splash.startOrder")}
        </span>
      </>
    );
  }

  // Exactly three cards (prev / current / next, wrapping) — ≤3 media
  // elements, and only the centre one ever plays a video (Rule 5).
  const prev = live(cur, -1, n, failed);
  const next = live(cur, 1, n, failed);
  return (
    <>
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
        className="absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-soft-light"
      />
      <Bell className="top-[128px]" />
      <div key={`prev${prev}`} className={`${CARD} left-[-592px]`}>
        <SlideMedia
          slide={slides[prev]}
          index={prev}
          role="peek"
          onDone={advance}
          onFail={fail}
        />
      </div>
      {/* Keyed by slide: each change remounts the centre, which fades in. */}
      <div key={`cur${cur}`} className={`${CARD} tb-fade-in left-[200px]`}>
        <SlideMedia
          slide={slide}
          index={cur}
          role="centre"
          onDone={advance}
          onFail={fail}
        />
      </div>
      <div key={`next${next}`} className={`${CARD} left-[992px]`}>
        <SlideMedia
          slide={slides[next]}
          index={next}
          role="peek"
          onDone={advance}
          onFail={fail}
        />
      </div>
      <div className="absolute bottom-[128px] left-[162px] flex w-[756px] flex-col items-center gap-[48px] text-center">
        <span className={H1}>{t("splash.orderHere")}</span>
        <span className={CTA}>{t("splash.startOrder")}</span>
      </div>
    </>
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
  ...rest
}: MediaProps & { slide: SplashSlide; role: Role }) {
  if (slide.kind === "image") {
    // Only the centre image times the rotation; a single image stays put.
    const dwellMs = role === "centre" ? slide.durationMs : undefined;
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
    else onDone();
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
