import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "./i18n";
import { KioskStage } from "./components/stage/KioskStage";
import ErrorModal from "./components/common/ErrorModal";
import { planCrashRecovery, reloadTo } from "./utils/chunkRecovery";
import { captureKioskEvent, KioskEventName } from "./utils/analytics";

/** Offline at recovery time: look again this often. */
const OFFLINE_RECHECK_MS = 10_000;

interface Props {
  children: ReactNode;
  /**
   * LOCAL use (P9d): render this known-good stand-in instead of the crash
   * screen, with NO recovery timer or reload — the rest of the screen still
   * works (the splash media layer → its static WELCOME frame). A fresh mount
   * (the next visit) retries the children. Omitted = the global boundary.
   */
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * Global error boundary (Rule 2: never a blank/frozen screen). It sits above
 * <App/> (main.tsx), so the Router, the app's KioskStage and the offline
 * overlay are all gone when it trips — hence its own KioskStage, i18n.t
 * (a class cannot use hooks; the language in force at the crash stays) and
 * full page loads instead of navigate().
 *
 * An unattended kiosk cannot wait for a tap: the screen recovers by itself
 * (planCrashRecovery — /start after 10 s, or a re-boot after 60 s when the
 * page is too young to trust or the crash was on the boot screen). START
 * OVER takes the same route now, online or not: a guest is there to see the
 * result, and offline the service worker's navigation fallback serves the app
 * shell, whose offline overlay explains the wait. Either way /start's mount
 * ends the session. NO storage (Rule 3): the only state is one timer, cleared
 * on unmount.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  private recoveryPath = "/start";

  private timer: number | undefined;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const report = {
      error_source: "react_boundary",
      error_message: error?.message,
      component_stack_present: Boolean(info?.componentStack),
    };
    if (this.props.fallback !== undefined) {
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        ...report,
        recovery_path: "local_fallback",
      });
      return;
    }
    const plan = planCrashRecovery();
    this.recoveryPath = plan.path;
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      ...report,
      recovery_path: plan.path,
      recovery_in_ms: plan.delayMs,
    });
    this.arm(plan.delayMs);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  private arm(delayMs: number) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.recover, delayMs);
  }

  // Unattended timer only: offline, a reload without a live service worker
  // lands on the browser's own error page — no app code left to recover
  // from — so wait for the network instead.
  private recover = () => {
    if (navigator.onLine) reloadTo(this.recoveryPath);
    else this.arm(OFFLINE_RECHECK_MS);
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <KioskStage>
        {/* App's window-level kiosk hardening unmounted with App: keep the
            long-press menu ("Open image in new tab") off this screen too. */}
        <div className="contents" onContextMenu={(e) => e.preventDefault()}>
          <ErrorModal
            testId="app-error"
            title={i18n.t("errorBoundary.title")}
            message={i18n.t("errorBoundary.message")}
            primary={{
              label: i18n.t("errorBoundary.startOver"),
              testId: "app-error-start-over",
              onClick: () => reloadTo(this.recoveryPath),
            }}
          />
        </div>
      </KioskStage>
    );
  }
}
