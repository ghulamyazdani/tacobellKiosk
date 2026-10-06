import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import {
  selectSelectedLanguage,
  setLanguages,
} from "../../../redux/features/multiLanguage/multiLanguage.slice";
import LanguageSheet from "../LanguageSheet";
import i18n from "../../../i18n";

/*
  P9f — framer-motion removed: the sheet has a CSS entrance and NO exit. With
  AnimatePresence the closed sheet lingered for its exit slide, and its
  full-screen scrim swallowed the customer's next tap. It must be gone the
  moment it closes. Choosing a language still stores its direction.
*/

const Harness = () => {
  const [open, setOpen] = useState(true);
  return <LanguageSheet open={open} onClose={() => setOpen(false)} />;
};

const renderSheet = () =>
  render(
    <Provider store={store}>
      <Harness />
    </Provider>
  );

describe("LanguageSheet (P9f — pure-CSS motion)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setLanguages({
        primary_language: { name: "English", code: "en" },
        secondary_language: { name: "Arabic", code: "ar" },
      })
    );
  });

  it("choosing a language stores it with its dir and unmounts the sheet at once", () => {
    renderSheet();
    expect(screen.getByTestId("language-sheet")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("language-ar"));

    expect(selectSelectedLanguage(store.getState())).toMatchObject({ code: "ar", dir: "rtl" });
    expect(screen.queryByTestId("language-sheet")).not.toBeInTheDocument(); // no lingering scrim
  });

  it("the scrim closes it at once too, and nothing is left in the DOM", () => {
    const { container } = renderSheet();

    const [scrim] = screen.getAllByRole("button", { name: i18n.t("language.close") });
    fireEvent.click(scrim);

    expect(container).toBeEmptyDOMElement();
  });

  it("the entrance is CSS keyframes on the scrim and the sheet", () => {
    renderSheet();

    const [scrim] = screen.getAllByRole("button", { name: i18n.t("language.close") });
    expect(scrim.style.animation).toContain("tbLanguageScrimEnter");
    expect(screen.getByRole("heading").parentElement?.style.animation).toContain("tbLanguageSheetEnter");
    // …and both names resolve to the sheet's own @keyframes (else the entrance is silently a no-op).
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toMatch(/@keyframes\s+tbLanguageScrimEnter\s*\{/);
    expect(css).toMatch(/@keyframes\s+tbLanguageSheetEnter\s*\{/);
  });
});
