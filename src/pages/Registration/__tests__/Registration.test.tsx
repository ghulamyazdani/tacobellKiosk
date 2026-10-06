import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Registration from "../index";
import i18n from "../../../i18n";

const authenticateKiosk = vi.fn();
vi.mock("../../../hooks/utils/useAuthHook", () => ({
  default: () => ({
    authenticateKiosk,
    isAuthenticateLoading: false,
  }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <Registration />
    </MemoryRouter>
  );

describe("Registration (license-code entry)", () => {
  beforeEach(() => authenticateKiosk.mockReset());

  it("types a code on the on-screen keyboard", async () => {
    renderPage();
    for (const key of ["t", "b"]) {
      await userEvent.click(screen.getByRole("button", { name: key }));
    }
    // Digits live on the 123 layer (Figma keyboard design).
    await userEvent.click(screen.getByRole("button", { name: /numbers and symbols/i }));
    await userEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByTestId("registration-code")).toHaveTextContent("tb1");
  });

  it("rejects an empty code without calling the API", async () => {
    renderPage();
    await userEvent.click(screen.getByTestId("registration-submit"));
    expect(authenticateKiosk).not.toHaveBeenCalled();
    expect(screen.getByTestId("registration-error")).toHaveTextContent(
      /greater than 0/i
    );
  });

  it("submits the typed code and surfaces API errors", async () => {
    authenticateKiosk.mockResolvedValue({ error: "The Code You Entered Has Expired" });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "x" }));
    await userEvent.click(screen.getByTestId("registration-submit"));
    expect(authenticateKiosk).toHaveBeenCalledWith("x");
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  /*
    P9f — pure-CSS motion, and the ACTIVATE contrast fix (decision 2:
    ink-purple on pink is 7.73:1; white was 2.46:1). No Figma frame.
  */
  it("ACTIVATE is ink-purple on pink; an error slides the banner in and shakes the button", async () => {
    renderPage();
    const submit = screen.getByTestId("registration-submit");
    const banner = screen.getByTestId("registration-error");
    expect(submit).toHaveClass("bg-tb-pink", "text-tb-ink-purple");
    expect(submit).not.toHaveClass("text-white");
    expect(banner).toHaveClass("-translate-y-[120px]");
    expect(submit.style.animation).toBe("");

    await userEvent.click(submit);

    expect(banner).toHaveClass("translate-y-0");
    expect(banner).not.toHaveClass("-translate-y-[120px]");
    expect(submit.style.animation).toContain("tbRegistrationShake");
    // …and the name resolves to the page's own @keyframes (else the shake is silently a no-op).
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toMatch(/@keyframes\s+tbRegistrationShake\s*\{/);
  });

  it("the banner slides back out and the shake ends when the error clears (3 s)", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      const submit = screen.getByTestId("registration-submit");
      const banner = screen.getByTestId("registration-error");

      fireEvent.click(submit); // empty code → error
      expect(banner).toHaveClass("translate-y-0");
      expect(submit.style.animation).toContain("tbRegistrationShake");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(banner).toHaveClass("-translate-y-[120px]");
      expect(banner).not.toHaveClass("translate-y-0");
      expect(submit.style.animation).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second error gets its own full 3 s, and leaving the screen leaves no timer", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderPage();
      const submit = screen.getByTestId("registration-submit");
      const banner = screen.getByTestId("registration-error");

      fireEvent.click(submit); // error 1 at t=0
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.click(submit); // error 2 at t=2 s restarts the window
      act(() => {
        vi.advanceTimersByTime(1500); // t=3.5 s: error 1's timer would have hidden it
      });
      expect(banner).toHaveClass("translate-y-0");
      act(() => {
        vi.advanceTimersByTime(1500); // t=5 s = error 2 + 3 s
      });
      expect(banner).not.toHaveClass("translate-y-0");

      fireEvent.click(submit); // a pending dismiss timer…
      const clearSpy = vi.spyOn(window, "clearTimeout");
      unmount(); // …is cleared on unmount
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the empty-code placeholder is 55 % black (35 % was 2.43:1)", () => {
    renderPage();

    const placeholder = screen.getByText(i18n.t("registration.placeholder"));
    expect(placeholder).toHaveClass("text-black/55");
    expect(placeholder).not.toHaveClass("text-black/35");
  });
});
