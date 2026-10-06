import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../redux/app/store";
import {
  emptySelectedLanguage,
  setSelectedLanguage,
} from "../redux/features/multiLanguage/multiLanguage.slice";
import FooterBar from "../components/chrome/FooterBar";
import App from "../App";
import i18n, { DEFAULT_LANGUAGE } from "../i18n";

/*
  P9a (D9): every session reset blanks selectedLanguage to {name:"", code:""}.
  Both readers of it must treat "" as "the default", or the next customer is
  greeted in the previous customer's language (App's i18n sync) under a blank
  language label (FooterBar). The App test stubs the route tree and the PWA
  handler — only the shell's language effect is under test.
*/

vi.mock("../routes", () => ({ AppRoutes: () => null }));
vi.mock("../components/autoUpdate/PWAUpdateHandler", () => ({
  PWAUpdateHandler: () => null,
}));

const ARABIC = { name: "العربية", code: "ar", dir: "rtl" };

describe("after a reset the next customer is back in the default language", () => {
  beforeEach(async () => {
    store.dispatch({ type: "RESET_STATE" });
    await act(async () => {
      await i18n.changeLanguage(DEFAULT_LANGUAGE);
    });
  });

  it("App: an emptied language code puts i18n — and <html lang> (P9f) — back on DEFAULT_LANGUAGE", async () => {
    store.dispatch(setSelectedLanguage(ARABIC));
    render(
      <Provider store={store}>
        <App />
      </Provider>
    );
    await waitFor(() => expect(i18n.language).toBe("ar"));
    expect(document.documentElement.lang).toBe("ar");

    act(() => {
      store.dispatch(emptySelectedLanguage());
    });

    await waitFor(() => expect(i18n.language).toBe(DEFAULT_LANGUAGE));
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("FooterBar: an emptied language name reads English, not a blank label", () => {
    store.dispatch(setSelectedLanguage(ARABIC));
    render(
      <Provider store={store}>
        <FooterBar onOpenLanguage={() => {}} />
      </Provider>
    );
    expect(screen.getByTestId("footer-language")).toHaveTextContent(ARABIC.name);

    act(() => {
      store.dispatch(emptySelectedLanguage());
    });

    expect(screen.getByTestId("footer-language")).toHaveTextContent(
      i18n.t("language.english")
    );
  });
});
