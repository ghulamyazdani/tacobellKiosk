import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { store } from "../../../redux/app/store";
import StartScreen from "../index";
import "../../../i18n";

const logoutKiosk = vi.fn();
vi.mock("../../../hooks/utils/useAuthHook", () => ({
  default: () => ({ logoutKiosk }),
}));

const renderStart = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="/start" element={<StartScreen />} />
          <Route path="/second" element={<div>second-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

describe("Activity Center (hidden 3s top-left hold)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.dispatch({ type: "RESET_STATE" });
  });
  afterEach(() => {
    vi.useRealTimers();
    logoutKiosk.mockReset();
  });

  it("holding the top-left hotspot for 3s opens the Activity Center", () => {
    renderStart();
    const hotspot = screen.getByTestId("activity-hotspot");
    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(screen.queryByTestId("activity-modal")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.mouseUp(hotspot);
    expect(screen.getByTestId("activity-modal")).toBeInTheDocument();
    // Info rows render (device unknown on a fresh store).
    expect(screen.getByTestId("activity-modal")).toHaveTextContent(/unknown device/i);
  });

  it("a short tap on the hotspot neither opens the modal nor starts an order", () => {
    renderStart();
    const hotspot = screen.getByTestId("activity-hotspot");
    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.mouseUp(hotspot);
    fireEvent.click(hotspot);
    expect(screen.queryByTestId("activity-modal")).not.toBeInTheDocument();
    expect(screen.queryByText("second-screen")).not.toBeInTheDocument();
  });

  it("disabling mandatory fullscreen is passcode-gated; wrong passcode is rejected", () => {
    renderStart();
    const hotspot = screen.getByTestId("activity-hotspot");
    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    fireEvent.mouseUp(hotspot);

    const toggle = screen.getByTestId("activity-fullscreen-toggle");
    expect(screen.getByRole("switch", { name: "Mandatory fullscreen", checked: true })).toBe(toggle);
    // Fresh store: mandatoryFullscreen defaults TRUE (kiosks enforce
    // fullscreen out of the box) → first toggle is a DISABLE attempt and
    // must be passcode-gated.
    fireEvent.click(toggle);
    expect(screen.getByTestId("activity-passcode")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter the passcode to disable mandatory fullscreen")).toBe(
      screen.getByTestId("activity-passcode-input")
    );
    fireEvent.change(screen.getByTestId("activity-passcode-input"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("activity-passcode-submit"));
    expect(screen.getByTestId("activity-passcode-error")).toHaveTextContent(/invalid/i);
  });

  it("logout requires confirmation and calls logoutKiosk", () => {
    renderStart();
    const hotspot = screen.getByTestId("activity-hotspot");
    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    fireEvent.mouseUp(hotspot);

    fireEvent.click(screen.getByTestId("activity-logout"));
    expect(logoutKiosk).not.toHaveBeenCalled(); // confirmation first
    fireEvent.click(screen.getByTestId("activity-logout-yes"));
    expect(logoutKiosk).toHaveBeenCalledTimes(1);
  });
});
