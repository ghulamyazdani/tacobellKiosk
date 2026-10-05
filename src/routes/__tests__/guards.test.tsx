import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../ProtectedRoute";
import ProtectedRouteIfAuthenticated from "../ProtectedRouteIfAuthenticated";

const renderGuards = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRouteIfAuthenticated />}>
          <Route path="/" element={<div>registration</div>} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/start" element={<div>start</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe("route guards (registration-first boot, posistKiosk parity)", () => {
  afterEach(() => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("unregistered device: / shows Registration", () => {
    renderGuards("/");
    expect(screen.getByText("registration")).toBeInTheDocument();
  });

  it("unregistered device: /start redirects to Registration", () => {
    renderGuards("/start");
    expect(screen.getByText("registration")).toBeInTheDocument();
  });

  it("registered device: / redirects to /start", () => {
    document.cookie = "token=abc123; path=/";
    renderGuards("/");
    expect(screen.getByText("start")).toBeInTheDocument();
  });

  it("registered device: /start renders", () => {
    document.cookie = "token=abc123; path=/";
    renderGuards("/start");
    expect(screen.getByText("start")).toBeInTheDocument();
  });
});
