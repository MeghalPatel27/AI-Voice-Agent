import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ProtectedRoute from "./ProtectedRoute";
import { AuthProvider } from "./AuthContext";

vi.mock("../lib/api", () => ({
  API_BASE_URL: "http://localhost:5001",
  apiFetch: vi.fn(),
  registerSessionInvalidationListener: vi.fn(),
}));

import { apiFetch } from "../lib/api";

const mockedApiFetch = vi.mocked(apiFetch);

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <AuthProvider>
        <ProtectedRoute>
          <div>Settings content</div>
        </ProtectedRoute>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute auth hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does not redirect to login while hydrating with a stored token", async () => {
    localStorage.setItem("airadesk_token", "token-123");
    let resolveMe: ((value: unknown) => void) | undefined;
    mockedApiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMe = resolve;
        }),
    );

    renderProtectedRoute();

    expect(screen.getByText("Loading AiraDesk...")).toBeInTheDocument();
    expect(screen.queryByText("Settings content")).not.toBeInTheDocument();

    resolveMe?.({
      user: {
        id: "user-1",
        name: "Admin",
        email: "admin@example.com",
        role: "ADMIN",
        companyId: "company-1",
        companyName: "AiraDesk",
        industry: "OTHER",
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Settings content")).toBeInTheDocument();
    });
  });

  it("redirects only after hydration confirms there is no session", async () => {
    renderProtectedRoute();
    expect(screen.queryByText("Settings content")).not.toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
