import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { CookiesProvider } from "react-cookie";
import { PersistGate } from "redux-persist/integration/react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { setAnalyticsPort } from "@cx-sdk/core";
import { installChunkErrorRecovery } from "./utils/chunkRecovery";
import { captureKioskEvent } from "./utils/analytics";
import { store, persistor } from "./redux/app/store";
import { ErrorBoundary } from "./ErrorBoundary";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// FIRST side effect, before anything can trigger a lazy import: a failed
// chunk fetch after a deploy must reload, not dead-end (Rule 2).
installChunkErrorRecovery();

// The SDK's analytics seam — registered before first render so no early
// engine call drops events.
setAnalyticsPort({ capture: captureKioskEvent });

// PostHog kill switch: initialize ONLY in production analytics mode.
const ENABLE_POSTHOG = import.meta.env.VITE_POST_HOG_TYPE === "production";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const app = (
  // CookiesProvider is mandatory in react-cookie v8 (useCookies throws
  // without it — v7 in posistKiosk fell back to a default jar).
  <CookiesProvider>
  <Provider store={store}>
    <PersistGate loading={null} persistor={persistor}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PersistGate>
  </Provider>
  </CookiesProvider>
);

createRoot(rootElement).render(
  <StrictMode>
    {ENABLE_POSTHOG ? (
      <PostHogProvider
        client={posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
          api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
          defaults: "2025-05-24",
        })}
      >
        {app}
      </PostHogProvider>
    ) : (
      app
    )}
  </StrictMode>
);
