import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TasksPage from "./tasks";

vi.mock("./lib/api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./lib/api";

const mockedApiFetch = vi.mocked(apiFetch);

describe("scheduled AI call form", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async (path: string) => {
      if (String(path).startsWith("/api/tasks/operations")) {
        return {
          summary: {
            total: 0,
            open: 0,
            doing: 0,
            dueToday: 0,
            overdue: 0,
            unassigned: 0,
            blocked: 0,
            critical: 0,
            completedToday: 0,
            completionRate: 0,
          },
          tasks: [],
          todayFocus: [],
          teamMembers: [],
          taskTypes: [],
        };
      }
      if (path === "/api/tasks/ai-call") {
        return { task: { id: "task-1" } };
      }
      throw new Error(`Unexpected path ${path}`);
    });
  });

  it("shows helper texts and character counters", async () => {
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Schedule AI Call/i }));
    expect(
      screen.getByText(/This becomes the objective for this specific call/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Private background context for the calling assistant/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\/1200/)).toBeInTheDocument();
    expect(screen.getByText(/\/2000/)).toBeInTheDocument();
  });

  it("submits canonical payload fields", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("button", { name: /Schedule AI Call/i })[0]!);
    await waitFor(() => {
      expect(screen.getByText(/Schedule AI Requirement Call/i)).toBeInTheDocument();
    });
    const form = screen.getByText(/Schedule AI Requirement Call/i).closest("form")!;
    const phoneInput = form.querySelector("input[placeholder='+919586410399']") as HTMLInputElement;
    const dateInput = form.querySelector("input[type='datetime-local']") as HTMLInputElement;
    const objective = form.querySelector("textarea[placeholder*='Collect requirement']") as HTMLTextAreaElement;
    const shortPurpose = form.querySelector("textarea[placeholder='Follow up on earlier website inquiry']") as HTMLTextAreaElement;
    const extraNotes = form.querySelector("textarea[placeholder*='lead source']") as HTMLTextAreaElement;
    const timezoneInput = form.querySelector("input[placeholder='Asia/Kolkata']") as HTMLInputElement;

    await user.type(phoneInput, "+919999999999");
    await user.type(dateInput, "2030-01-01T10:00");
    await user.clear(objective);
    await user.type(objective, "Collect budget and timeline");
    await user.type(shortPurpose, "Website follow-up");
    await user.type(extraNotes, "Private note");
    await user.clear(timezoneInput);
    await user.type(timezoneInput, "Asia/Kolkata");

    await user.click(screen.getAllByRole("button", { name: /Schedule AI Call/i })[1]!);
    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/api/tasks/ai-call",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("collectionGoal"),
        }),
      );
    });
    const req = mockedApiFetch.mock.calls.find((call) => call[0] === "/api/tasks/ai-call");
    const body = JSON.parse(String(req?.[1]?.body || "{}"));
    expect(body.collectionGoal).toBe("Collect budget and timeline");
    expect(body.callPurpose).toBe("Website follow-up");
    expect(body.extraNotes).toBe("Private note");
    expect(body.timezone).toBe("Asia/Kolkata");
  });
});
