import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { selectShouldWholeAppUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../../redux/app/store";
import ActivityCenter from "../ActivityCenter";
import { loadActivityModal } from "../loadActivityModal";
import "../../../i18n";

/*
  The Activity Center's code does NOT arrive. In a build, on a page that is
  itself a fresh reload, chunkRecovery prevents the preloadError without
  reloading again and the import resolves with no module — modelled by a
  bagLazyParts without ActivityModal (the dev server rejects instead). That
  chunk is the bag's too, and Chromium keeps the failure for the page's
  lifetime, so the load flags the whole-app reload the splash applies at its
  next dwell, between guests (loadPaytmScreen's path). The scrim stays and
  closes; a later open asks again.
*/

const parts = vi.hoisted(() => ({ ActivityModal: undefined as unknown }));
vi.mock("../../cart/bagLazyParts", () => parts);

const ui = (isOpen: boolean, onClose: () => void) => (
  <Provider store={store}>
    <ActivityCenter isOpen={isOpen} onClose={onClose} />
  </Provider>
);

describe("ActivityCenter — its code never arrives", () => {
  it("the scrim stays (named, closing), the whole-app reload is flagged for the next splash dwell, and a later open asks again", async () => {
    expect(selectShouldWholeAppUpdate(store.getState())).toBe(false);
    const onClose = vi.fn();
    const view = render(ui(true, onClose));

    expect(await act(() => loadActivityModal())).toBeNull();
    const scrim = screen.getByRole("button", { name: "Close" });
    expect(scrim).toHaveAttribute("data-testid", "activity-loading");
    expect(screen.queryByTestId("activity-modal")).toBeNull();
    expect(selectShouldWholeAppUpdate(store.getState())).toBe(true);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Not latched to the failure: the next open loads again (a browser that
    // refetches gets the modal; Chromium answers from its failure cache).
    view.rerender(ui(false, onClose));
    parts.ActivityModal = () => <div data-testid="activity-modal" />;
    view.rerender(ui(true, onClose));
    expect(await screen.findByTestId("activity-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-loading")).toBeNull();
  });
});
