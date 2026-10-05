import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { CookiesProvider } from "react-cookie";
import { store } from "../../../redux/app/store";
import StartScreen from "../index";
import "../../../i18n";

const renderStart = () =>
  render(
    <CookiesProvider>
    <Provider store={store}>
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="/start" element={<StartScreen />} />
          <Route path="/second" element={<div>second-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
    </CookiesProvider>
  );

describe("StartScreen (Figma Splash - Single, 1:2184)", () => {
  it("renders the splash with the start-order call to action", () => {
    renderStart();
    expect(screen.getByTestId("start-screen")).toBeInTheDocument();
    expect(screen.getByText(/start order/i)).toBeInTheDocument();
  });

  it("whole screen is one tap target that starts the order flow", async () => {
    renderStart();
    await userEvent.click(screen.getByTestId("start-screen"));
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });
});
