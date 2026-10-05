import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_EVENTS, useIdleTimer } from "react-idle-timer";
import { selectIdealTimeout } from "@cx-sdk/catalog/state/appSettings.slice";
import IdleTimeoutModal from "../components/common/IdleTimeoutModal";
import {
  IDLE_PROMPT_SECONDS,
  IdleHoldContext,
  resolveIdleSeconds,
} from "../hooks/utils/useIdleTimeout";
import { captureKioskEvent, KioskEventName } from "../utils/analytics";

const PROMPT_MS = IDLE_PROMPT_SECONDS * 1000;
/** Countdown UI refresh (4 Hz). Display only — the library is the one clock. */
const PROMPT_TICK_MS = 250;
/**
 * The library's activity events minus `focus`. A real touch or key already
 * arrives as touchstart/mousedown/keydown, so `focus` only adds PROGRAMMATIC
 * focus — and the P9b ErrorModal's autoFocus would then restart the period
 * whenever a menu-error dialog opens over an abandoned session, stretching
 * Rule 1's 120 s by the failed call's duration (found by the P9b e2e LATE
 * MENU test). Module scope: a stable array, so listeners are bound once.
 */
const ACTIVITY_EVENTS = DEFAULT_EVENTS.filter((event) => event !== "focus");

/**
 * IdleGuard — the idle subtree (fork IdleChecksRoutes), as a pathless layout
 * route. ONE react-idle-timer instance for the whole in-session flow: it
 * stays mounted across /second -> /menu -> /cart -> ... and unmounts — timer
 * and document listeners with it — the moment the kiosk lands on /start,
 * which sits outside. With T = resolveIdleSeconds(ideal_time) (<= 120 s,
 * Rule 1) the prompt opens at T - 20 s and the session ends at T.
 *
 * ── TEARDOWN: THIS COMPONENT ONLY NAVIGATES ─────────────────────────────
 * Timeout and START AGAIN both send analytics + navigate("/start") and
 * nothing else; /start's MOUNT owns revoke-then-resetSession("full").
 * Resetting here first would be a bug: RR7's BrowserRouter wraps navigate
 * in startTransition, so the emptied store renders on the OLD route first
 * and the empty-state guard effects of /cart, /tent, /payment, /forYou and
 * /customization re-navigate to /menu — the kiosk would park on an empty
 * menu instead of Splash. `endedRef` latches the exit, so a tap and onIdle
 * landing together tear down once.
 *
 * ── FORK DEFECTS NOT PORTED ─────────────────────────────────────────────
 * The fork prompted at HALF the period (reset at 65 s for ideal_time=120),
 * ran a second, independent countdown clock inside its modal that did the
 * actual reset, and cleared state from an untracked setTimeout after
 * navigating. Here the library's own onIdle ends the session; the prompt
 * only reads getRemainingTime().
 *
 * ── HOLDS ────────────────────────────────────────────────────────────────
 * Descendants suspend the timer through IdleHoldContext (useIdleHold).
 * `disabled` stops the library outright; re-enabling starts a fresh full
 * period.
 */
export default function IdleGuard() {
  const navigate = useNavigate();
  const { pathname, key: locationKey } = useLocation();
  const totalSeconds = resolveIdleSeconds(useSelector(selectIdealTimeout));
  const [prompted, setPrompted] = useState(false);
  const [holds, setHolds] = useState(0);
  const endedRef = useRef(false);

  // Stable on purpose: it is the context value, and every useIdleHold
  // effect keys on it.
  const adjustHold = useCallback((delta: 1 | -1) => {
    // A hold never coexists with an open prompt: the timer is stopped under
    // it, so that prompt could never resolve.
    if (delta === 1) setPrompted(false);
    setHolds((count) => Math.max(0, count + delta));
  }, []);

  const endSession = (event: KioskEventName, reason: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    captureKioskEvent(event, { reason, route_path: pathname });
    navigate("/start");
  };

  // Callback props are held in refs the library refreshes every render, so
  // these inline closures never go stale.
  const { activate, getRemainingTime } = useIdleTimer({
    timeout: totalSeconds * 1000,
    promptBeforeIdle: PROMPT_MS,
    events: ACTIVITY_EVENTS,
    disabled: holds > 0,
    onPrompt: () => setPrompted(true),
    // The library calls this whenever activate() leaves the prompted or idle
    // state — so any re-arm also takes the prompt down (see self-heal).
    onActive: () => setPrompted(false),
    onIdle: () => endSession(KioskEventName.Timeout, "idle_timeout"),
  });

  // Self-heal. A late navigation from the page (an unguarded await
  // continuation) landing in the same transition as our navigate("/start")
  // wins — the last push does — so this guard stays mounted on that route
  // with the exit latched and the library idle: no timer, dead buttons, a
  // hang. Normally the guard unmounts before it can see another location,
  // so seeing one while latched means exactly that: re-arm a fresh period.
  // activate(), not reset(): reset() re-arms silently and would leave a
  // START AGAIN prompt standing over the page; activate() closes it through
  // onActive.
  useEffect(() => {
    if (!endedRef.current) return;
    endedRef.current = false;
    activate();
  }, [locationKey, activate]);

  const handleContinue = () => {
    // The session is already on its way to /start — nothing to continue.
    if (endedRef.current) return;
    // react-idle-timer IGNORES activity while prompted (its event handler
    // returns early), so the tap that continues must re-arm the timer itself.
    activate();
    setPrompted(false);
  };

  const handleStartAgain = () =>
    endSession(KioskEventName.KioskReset, "idle_prompt_start_again");

  return (
    <IdleHoldContext.Provider value={adjustHold}>
      <Outlet />
      {prompted && (
        <IdlePrompt
          getRemainingTime={getRemainingTime}
          onContinue={handleContinue}
          onStartAgain={handleStartAgain}
        />
      )}
    </IdleHoldContext.Provider>
  );
}

interface IdlePromptProps {
  getRemainingTime: () => number;
  onContinue: () => void;
  onStartAgain: () => void;
}

/**
 * Mounted ONLY while prompted, so its tick exists only then (Rule 5). It
 * displays the library's clock and decides nothing — onIdle does.
 */
function IdlePrompt({
  getRemainingTime,
  onContinue,
  onStartAgain,
}: IdlePromptProps) {
  const [openingMs] = useState(getRemainingTime);
  const [remainingMs, setRemainingMs] = useState(openingMs);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemainingMs(getRemainingTime());
    }, PROMPT_TICK_MS);
    return () => window.clearInterval(id);
  }, [getRemainingTime]);

  return (
    <IdleTimeoutModal
      open
      progress={1 - remainingMs / PROMPT_MS}
      announcedSeconds={Math.ceil(openingMs / 1000)}
      onContinue={onContinue}
      onStartAgain={onStartAgain}
    />
  );
}
