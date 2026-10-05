import { useCallback, useEffect, useRef, useState } from "react";

type LongPressOptions = {
  shouldPreventDefault?: boolean;
  delay?: number;
};

/**
 * Press-and-hold detector (ported from posistKiosk, typed). Returns bindings
 * for mouse + touch; a hold ≥ delay fires onLongPress, a shorter release
 * fires onClick. Timers/listeners cleaned on unmount (24/7 kiosk).
 */
const useLongPress = (
  onLongPress: (e: React.SyntheticEvent) => void,
  onClick: () => void,
  { shouldPreventDefault = true, delay = 300 }: LongPressOptions = {}
) => {
  const [longPressTriggered, setLongPressTriggered] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef<EventTarget | null>(null);

  const preventDefault = useCallback((event: Event) => {
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches && touchEvent.touches.length < 2 && event.preventDefault) {
      event.preventDefault();
    }
  }, []);

  const start = useCallback(
    (event: React.SyntheticEvent) => {
      if (shouldPreventDefault && event.target) {
        targetRef.current = event.target;
        event.target.addEventListener("touchend", preventDefault, {
          passive: false,
        });
      }
      timeoutRef.current = setTimeout(() => {
        onLongPress(event);
        setLongPressTriggered(true);
      }, delay);
    },
    [delay, onLongPress, preventDefault, shouldPreventDefault]
  );

  const clear = useCallback(
    (_event?: React.SyntheticEvent, shouldTriggerClick = true) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (shouldTriggerClick && !longPressTriggered) {
        onClick();
      }
      setLongPressTriggered(false);
      if (shouldPreventDefault && targetRef.current) {
        targetRef.current.removeEventListener("touchend", preventDefault);
        targetRef.current = null;
      }
    },
    [longPressTriggered, onClick, preventDefault, shouldPreventDefault]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (targetRef.current) {
        targetRef.current.removeEventListener("touchend", preventDefault);
      }
    };
  }, [preventDefault]);

  return {
    onMouseDown: start,
    onTouchStart: start,
    onMouseUp: clear,
    onMouseLeave: (e: React.SyntheticEvent) => clear(e, false),
    onTouchEnd: clear,
  };
};

export default useLongPress;
