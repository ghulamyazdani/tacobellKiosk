import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import NetworkStatusOverlay from "../NetworkStatusOverlay";
import i18n from "../../../i18n";

/*
  P9f — framer-motion removed: an opacity-only CSS entrance (tb-fade-in) on a
  portal that unmounts the moment the network returns. While online it
  renders nothing at all (no invisible full-screen layer over the kiosk).
*/
describe("NetworkStatusOverlay (P9f — pure-CSS motion)", () => {
  const goOffline = () => act(() => void window.dispatchEvent(new Event("offline")));
  const goOnline = () => act(() => void window.dispatchEvent(new Event("online")));

  it("online: renders null — nothing in the tree, nothing portalled", () => {
    const { container } = render(<NetworkStatusOverlay />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("network-offline")).not.toBeInTheDocument();
  });

  it("offline: a tb-fade-in blocker on document.body; back online it unmounts at once", () => {
    render(<NetworkStatusOverlay />);

    goOffline();
    const overlay = screen.getByTestId("network-offline");
    expect(overlay).toHaveClass("tb-fade-in");
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveTextContent(i18n.t("network.title"));

    goOnline();
    expect(screen.queryByTestId("network-offline")).not.toBeInTheDocument();
  });
});
