import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import IdleTimeoutModal from "../IdleTimeoutModal";
import i18n from "../../../i18n";

/*
  Presentational only (Figma 1:4514): IdleGuard owns the clock, the continue
  and the teardown, so these tests drive props and read the DOM — no store,
  no router.
*/

const onContinue = vi.fn();
const onStartAgain = vi.fn();

const renderModal = (
  props: Partial<{ open: boolean; progress: number; announcedSeconds: number }> = {}
) =>
  render(
    <IdleTimeoutModal
      open
      progress={0}
      announcedSeconds={20}
      onContinue={onContinue}
      onStartAgain={onStartAgain}
      {...props}
    />
  );

/** The lilac "Loading" fill behind the START AGAIN label. */
const fill = () =>
  screen
    .getByTestId("idle-start-again")
    .querySelector<HTMLElement>('[aria-hidden="true"]');

const IDLE_KEYS = ["title", "body", "startAgain", "continue", "countdownA11y"];

describe("IdleTimeoutModal (Figma 1:4514)", () => {
  beforeEach(() => {
    onContinue.mockReset();
    onStartAgain.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders NOTHING while closed — a full-stage wrapper would swallow taps", () => {
    const { container } = renderModal({ open: false });

    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled, described alertdialog stacked above every in-stage overlay", () => {
    renderModal({ announcedSeconds: 20 });
    const dialog = screen.getByRole("alertdialog");

    expect(dialog).toHaveAttribute("data-testid", "idle-modal");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(i18n.t("idle.title"));
    // Body + the one-shot countdown sentence.
    expect(dialog).toHaveAccessibleDescription(
      `${i18n.t("idle.body")} ${i18n.t("idle.countdownA11y", { seconds: 20 })}`
    );
    // Above BagSheet's z-[90] children, below NetworkStatusOverlay (z-[99999]).
    expect(dialog).toHaveClass("z-[100]");
  });

  it("renders the Figma copy through i18n (EN)", () => {
    renderModal();

    expect(screen.getByText(i18n.t("idle.title"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("idle.body"))).toBeInTheDocument();
    expect(screen.getByTestId("idle-start-again")).toHaveTextContent(
      i18n.t("idle.startAgain")
    );
    expect(screen.getByTestId("idle-continue")).toHaveTextContent(
      i18n.t("idle.continue")
    );
    expect(i18n.t("idle.title")).toBe("you have been inactive");
  });

  it("ships every idle key in Arabic too, and renders it", async () => {
    for (const key of IDLE_KEYS) {
      expect(i18n.getResource("ar", "translation", `idle.${key}`)).toEqual(
        expect.any(String)
      );
    }

    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderModal({ announcedSeconds: 20 });

    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(i18n.t("idle.title"));
    expect(screen.getByTestId("idle-continue")).toHaveTextContent(
      i18n.t("idle.continue")
    );
  });

  it.each([
    [0, "0%"],
    [0.5, "50%"],
    [1, "100%"],
    // Clamped: a late tick past the window never overflows the button.
    [-0.25, "0%"],
    [1.7, "100%"],
  ])("progress %s fills START AGAIN to %s from the leading edge", (progress, width) => {
    renderModal({ progress });

    expect(fill()).not.toBeNull();
    expect(fill()?.style.width).toBe(width);
    // Logical start-0, so the fill mirrors under RTL.
    expect(fill()).toHaveClass("start-0", "bg-tb-lilac");
  });

  it("CONTINUE ORDERING takes focus on open — one key press extends (WCAG 2.2.1)", () => {
    renderModal();

    expect(screen.getByTestId("idle-continue")).toHaveFocus();
  });

  it.each(["idle-continue", "idle-backdrop"])(
    "%s continues the session (and does not start again)",
    (testId) => {
      renderModal();
      fireEvent.click(screen.getByTestId(testId));

      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(onStartAgain).not.toHaveBeenCalled();
    }
  );

  it("the backdrop is a named button, not an inert div", () => {
    renderModal();

    expect(screen.getByTestId("idle-backdrop")).toHaveAccessibleName(
      i18n.t("idle.continue")
    );
  });

  it("START AGAIN starts again (and does not continue)", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("idle-start-again"));

    expect(onStartAgain).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });
});
