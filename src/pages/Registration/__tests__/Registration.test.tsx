import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Registration from "../index";
import "../../../i18n";

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
});
