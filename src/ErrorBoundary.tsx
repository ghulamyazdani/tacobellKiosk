import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureKioskEvent, KioskEventName } from "./utils/analytics";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Global error boundary (Rule 2: never a blank/frozen screen). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      error_source: "react_boundary",
      error_message: error?.message,
      component_stack_present: Boolean(info?.componentStack),
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-tb-purple p-8 text-center text-tb-surface">
          <h1 className="tb-display text-5xl">Something went wrong</h1>
          <p className="mt-4 text-2xl">Please restart your order.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
