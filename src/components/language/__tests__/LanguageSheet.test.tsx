import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import {
  emptySelectedLanguage,
  selectSelectedLanguage,
  setLanguages,
} from "../../../redux/features/multiLanguage/multiLanguage.slice";
import useLocalized from "../../../hooks/utils/useLocalized";
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

/*
  Post-P9 L0 — the selection carries the fork's slot `type`: every per-language
  read (pipeline names, MIAM and ticker copy) keys on type ===
  "secondary_language", never on the code. A session reset blanks it, which
  must read as the primary language.
*/
describe("LanguageSheet stores the fork's slot type (post-P9 L0)", () => {
  /** What every slot reader sees: useLocalized().isSecondary. */
  const SlotProbe = () => (
    <span data-testid="slot">{useLocalized().isSecondary ? "secondary" : "primary"}</span>
  );
  const renderWithProbe = () =>
    render(
      <Provider store={store}>
        <Harness />
        <SlotProbe />
      </Provider>
    );

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setLanguages({
        primary_language: { name: "English", code: "en" },
        secondary_language: { name: "Arabic", code: "ar" },
      })
    );
  });

  it("Arabic (the secondary option) stores type 'secondary_language'; dir is unchanged", () => {
    renderWithProbe();

    fireEvent.click(screen.getByTestId("language-ar"));

    expect(selectSelectedLanguage(store.getState())).toEqual({
      name: "Arabic",
      code: "ar",
      dir: "rtl",
      type: "secondary_language",
    });
    expect(screen.getByTestId("slot")).toHaveTextContent("secondary");
  });

  it("English (the primary option) stores type 'primary_language'; dir is unchanged", () => {
    renderWithProbe();

    fireEvent.click(screen.getByTestId("language-en"));

    expect(selectSelectedLanguage(store.getState())).toEqual({
      name: "English",
      code: "en",
      dir: "ltr",
      type: "primary_language",
    });
    expect(screen.getByTestId("slot")).toHaveTextContent("primary");
  });

  it("an option's own dir is kept, never rewritten by the type", () => {
    store.dispatch(
      setLanguages({
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: { name: "Hindi", code: "hi", dir: "ltr" },
      })
    );
    renderWithProbe();

    fireEvent.click(screen.getByTestId("language-hi"));

    expect(selectSelectedLanguage(store.getState())).toEqual({
      name: "Hindi",
      code: "hi",
      dir: "ltr",
      type: "secondary_language",
    });
  });

  it("a session reset (emptySelectedLanguage) means primary again", () => {
    renderWithProbe();
    fireEvent.click(screen.getByTestId("language-ar"));
    expect(screen.getByTestId("slot")).toHaveTextContent("secondary");

    act(() => {
      store.dispatch(emptySelectedLanguage());
    });

    expect(selectSelectedLanguage(store.getState())).toEqual({ name: "", code: "" });
    expect(screen.getByTestId("slot")).toHaveTextContent("primary");
  });
});
