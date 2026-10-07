import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import ActivityCenter from "../ActivityCenter";
import { loadActivityModal } from "../loadActivityModal";
import "../../../i18n";

/*
  The Activity Center off the boot path (P9f budget × P8b + offers): its
  code is the lazy bagLazyParts chunk, loaded on the first open. Vitest
  isolates modules per file, so the first open here is a cold one.
*/

vi.mock("../../../hooks/utils/useAuthHook", () => ({
  default: () => ({ logoutKiosk: () => {} }),
}));

const ui = (isOpen: boolean, onClose: () => void) => (
  <Provider store={store}>
    <ActivityCenter isOpen={isOpen} onClose={onClose} />
  </Provider>
);

describe("ActivityCenter — lazy Activity Center", () => {
  it("closed: nothing, no load; first open: the modal's own scrim (named, closing like the modal) until its code arrives, then the modal", async () => {
    const onClose = vi.fn();
    const view = render(ui(false, onClose));
    expect(view.container).toBeEmptyDOMElement();
    // Closed, it starts no load (the chunk is operator-only): even with the
    // code at hand, the first open still begins on the scrim.
    await act(async () => {
      await import("../../cart/bagLazyParts");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    view.rerender(ui(true, onClose));
    const scrim = screen.getByRole("button", { name: "Close" });
    expect(scrim).toHaveAttribute("data-testid", "activity-loading");
    expect(screen.queryByTestId("activity-modal")).toBeNull();
    fireEvent.click(scrim); // a slow download never traps the screen
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(() => loadActivityModal());
    expect(screen.queryByTestId("activity-loading")).toBeNull();
    expect(screen.getByTestId("activity-modal")).toBeInTheDocument();

    view.rerender(ui(false, onClose));
    expect(view.container).toBeEmptyDOMElement();
  });
});
