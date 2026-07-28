import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";

vi.mock("./lib/api", () => ({
  API_BASE_URL: "http://localhost:5001",
  apiFetch: vi.fn(),
  registerSessionInvalidationListener: vi.fn(),
}));

vi.mock("./auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { apiFetch } from "./lib/api";
import { useAuth } from "./auth/AuthContext";
import CallsPage from "./calls";
import BookingsPage from "./bookings";
import { TranscriptPanel } from "./components/TranscriptPanel";
import {
  BusinessIntentPanel,
  HumeInsightsPanel,
  RequirementsPanel,
} from "./components/CallInsightPanels";
import { resolveRecordingUiState } from "./lib/recordingState";

const mockedApiFetch = vi.mocked(apiFetch);
const mockedUseAuth = vi.mocked(useAuth);

function wrap(ui: ReactNode, initialPath = "/calls") {
  return render(<MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>);
}

const sampleConversation = {
  id: "conv-1",
  channel: "AI_CALL",
  status: "FOLLOW_UP",
  priority: "HIGH",
  intent: "Website redesign",
  aiSummary: "Customer wants a redesigned marketing site with booking.",
  nextAction: "Schedule discovery meeting",
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T11:00:00.000Z",
  customer: {
    id: "cust-1",
    fullName: "Asha Patel",
    phone: "+919999999999",
    businessType: "Clinic",
    requirementSummary: "Need online booking",
  },
  calls: [
    {
      id: "call-1",
      conversationId: "conv-1",
      status: "COMPLETED",
      direction: "INBOUND",
      durationSeconds: 182,
      createdAt: "2026-07-20T10:00:00.000Z",
      transcript: "Customer: We need a new website\nAI: Happy to help",
      recordingMediaUrl: "/api/calls/call-1/recording/media",
      recordingStatus: "COMPLETE",
      recordingSource: "HUME",
      postCallAnalysis: {
        analysisStatus: "COMPLETED",
        intentLevel: "HIGH",
        intentScore: 82,
        requirementSummary: "Website redesign with booking",
        requirementDetails: {
          primaryNeed: "Online appointment booking",
          desiredCapabilities: ["CRM sync"],
        },
        evidenceSignals: ["Asked about pricing timeline"],
      },
      humeExpressionAnalysis: {
        status: "COMPLETED",
        userTurnCount: 4,
        topExpressions: [
          { name: "Interest", score: 0.71 },
          { name: "Calmness", score: 0.55 },
          { name: "Joy", score: 0.42 },
        ],
        averageScores: { Interest: 0.6, Calmness: 0.5 },
        insightSummary: "Caller sounded engaged and calm.",
      },
    },
  ],
  bookings: [
    {
      id: "book-1",
      title: "Discovery call",
      status: "CONFIRMED",
      acceptanceStatus: "PENDING_ACCEPTANCE",
      dateTime: "2026-07-28T09:30:00.000Z",
      timezone: "Asia/Kolkata",
      createdAt: "2026-07-20T11:00:00.000Z",
      assignedUser: { id: "user-assigned", name: "Ravi Kumar", email: "ravi@example.com" },
    },
  ],
  messages: [
    {
      id: "m1",
      senderType: "CUSTOMER",
      body: "We need a new website",
      createdAt: "2026-07-20T10:01:00.000Z",
    },
    {
      id: "m2",
      senderType: "AI",
      body: "Happy to help",
      createdAt: "2026-07-20T10:01:20.000Z",
    },
  ],
  tasks: [],
  latestCall: null as null,
};

sampleConversation.latestCall = sampleConversation.calls[0];

const sampleBooking = {
  id: "book-1",
  companyId: "co-1",
  conversationId: "conv-1",
  callId: "call-1",
  title: "Discovery call",
  dateTime: "2026-07-28T09:30:00.000Z",
  timezone: "Asia/Kolkata",
  status: "CONFIRMED",
  acceptanceStatus: "PENDING_ACCEPTANCE",
  outcome: "PENDING",
  assignedUserId: "user-assigned",
  assignedUser: { id: "user-assigned", name: "Ravi Kumar", email: "ravi@example.com" },
  notes: "Bring pricing sheet",
  proposalSent: false,
  nextAction: "Confirm agenda",
  createdAt: "2026-07-20T11:00:00.000Z",
  customer: {
    id: "cust-1",
    fullName: "Asha Patel",
    phone: "+919999999999",
    businessType: "Clinic",
    requirementSummary: "Need online booking",
  },
  conversation: {
    id: "conv-1",
    aiSummary: "Customer wants a redesigned marketing site with booking.",
    nextAction: "Schedule discovery meeting",
  },
};

describe("Call insight panels", () => {
  it("renders requirements as chips", () => {
    render(
      <RequirementsPanel
        analysis={sampleConversation.calls[0].postCallAnalysis}
      />,
    );
    expect(screen.getByText("Website redesign with booking")).toBeInTheDocument();
    expect(screen.getByText("Online appointment booking")).toBeInTheDocument();
  });

  it("renders business intent separately", () => {
    render(
      <BusinessIntentPanel analysis={sampleConversation.calls[0].postCallAnalysis} />,
    );
    expect(screen.getByText("High interest")).toBeInTheDocument();
    expect(screen.getByText("Score 82")).toBeInTheDocument();
    expect(screen.getByText("Asked about pricing timeline")).toBeInTheDocument();
  });

  it("renders Hume insights and tolerates missing data", () => {
    const { rerender } = render(
      <HumeInsightsPanel analysis={sampleConversation.calls[0].humeExpressionAnalysis} />,
    );
    expect(screen.getByText(/Hume voice insights/i)).toBeInTheDocument();
    expect(screen.getByText(/Interest: 71%/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not buying intent/i),
    ).toBeInTheDocument();

    rerender(<HumeInsightsPanel analysis={null} />);
    expect(
      screen.getByText(/Expression insights will appear/i),
    ).toBeInTheDocument();
  });
});

describe("Recording state helper", () => {
  it("maps preparing and failed states", () => {
    expect(
      resolveRecordingUiState({
        recordingStatus: "QUEUED",
        recordingMediaUrl: null,
      }),
    ).toBe("preparing");

    expect(
      resolveRecordingUiState({
        recordingStatus: "ERROR",
        failureReason: "recording failed",
      }),
    ).toBe("failed");
  });
});

describe("TranscriptPanel", () => {
  it("is collapsed by default and expands", async () => {
    const user = userEvent.setup();
    render(
      <TranscriptPanel raw={"Customer: Hello\nAI: Hi there"} defaultExpanded={false} />,
    );

    expect(
      screen.getByText(/Transcript is collapsed/i),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Transcript/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });
});

describe("CallsPage", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi Kumar",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
  });

  it("renders calls list, detail summary, intent, hume, recording and transcript", async () => {
    mockedApiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/calls?") || path === "/api/calls") {
        return {
          conversations: [sampleConversation],
          latestCalls: sampleConversation.calls,
          summary: {
            totalConversations: 1,
            totalCalls: 1,
            live: 0,
            completed: 1,
            missed: 0,
            humanRequired: 0,
            followUpNeeded: 1,
            transferred: 0,
            recorded: 1,
            transcribed: 1,
            totalDurationSeconds: 182,
            totalDurationMinutes: 3,
            averageDurationSeconds: 182,
          },
        };
      }
      if (path === "/api/calls/conv-1") {
        return { conversation: sampleConversation };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    wrap(<CallsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Asha Patel").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/Customer wants a redesigned marketing site/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Website redesign with booking/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("High interest").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hume voice insights/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/State: Hume/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Transcript is collapsed/i).length).toBeGreaterThan(0);
  });

  it("renders empty and API error states", async () => {
    mockedApiFetch.mockResolvedValueOnce({
      conversations: [],
      latestCalls: [],
      summary: {},
    });

    wrap(<CallsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No AI calls yet/i)).toBeInTheDocument();
    });

    mockedApiFetch.mockRejectedValue(new Error("Backend unavailable"));
    wrap(<CallsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Backend unavailable/i).length).toBeGreaterThan(0);
    });
  });
});

describe("BookingsPage / Meetings", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  function mockBookingsApis(booking = sampleBooking) {
    let current = { ...booking };
    mockedApiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/api/team/overview") {
        return {
          members: [
            {
              id: "user-assigned",
              type: "USER",
              name: "Ravi Kumar",
              email: "ravi@example.com",
              isActive: true,
            },
            {
              id: "user-other",
              type: "USER",
              name: "Other User",
              email: "other@example.com",
              isActive: true,
            },
          ],
        };
      }
      if (path.startsWith("/api/bookings")) {
        if (options?.method === "POST" && path.endsWith("/accept")) {
          current = {
            ...current,
            acceptanceStatus: "ACCEPTED",
            acceptedAt: "2026-07-27T10:00:00.000Z",
            acceptedByUserId: "user-assigned",
          };
          return {
            message: "Booking accepted",
            booking: current,
          };
        }
        if (options?.method === "PATCH") {
          const body = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
          current = { ...current, ...body };
          return {
            message: "Booking updated",
            booking: current,
          };
        }
        return {
          bookings: [current],
          summary: {
            total: 1,
            requested: 0,
            confirmed: 1,
            cancelled: 0,
            completed: 0,
          },
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });
  }

  it("renders meetings list and pending acceptance badge", async () => {
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi Kumar",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    mockBookingsApis();

    wrap(<BookingsPage />, "/bookings");

    await waitFor(() => {
      expect(screen.getAllByText("Discovery call").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/Pending acceptance/i).length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getAllByText("Discovery call")[0]);
    expect(await screen.findByRole("button", { name: /Accept meeting/i })).toBeInTheDocument();
  });

  it("hides Accept for unassigned users", async () => {
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-other",
        name: "Other User",
        email: "other@example.com",
        role: "STAFF",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    mockBookingsApis();

    wrap(<BookingsPage />, "/bookings");

    await waitFor(() => {
      expect(screen.getAllByText("Discovery call").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: /Accept meeting/i })).not.toBeInTheDocument();
  });

  it("accepts a meeting and updates state", async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi Kumar",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    mockBookingsApis();

    wrap(<BookingsPage />, "/bookings");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Accept meeting/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Accept meeting/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/^Accepted$/i).length).toBeGreaterThan(0);
    });
  });

  it("shows failed acceptance errors", async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi Kumar",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });

    mockedApiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/api/team/overview") {
        return { members: [] };
      }
      if (path.startsWith("/api/bookings") && options?.method === "POST") {
        throw new Error("Only the assigned employee can accept");
      }
      if (path.startsWith("/api/bookings")) {
        return {
          bookings: [sampleBooking],
          summary: { total: 1, requested: 0, confirmed: 1, cancelled: 0, completed: 0 },
        };
      }
      throw new Error(`Unexpected ${path}`);
    });

    wrap(<BookingsPage />, "/bookings");
    const acceptBtn = await screen.findByRole("button", { name: /Accept meeting/i });
    await user.click(acceptBtn);
    await waitFor(() => {
      expect(
        screen.getAllByText(/Only the assigned employee can accept/i).length,
      ).toBeGreaterThan(0);
    });
  });

  it("updates meeting outcome", async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi Kumar",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    mockBookingsApis();

    wrap(<BookingsPage />, "/bookings");
    const outcome = (await screen.findAllByLabelText("Outcome"))[0];
    await user.selectOptions(outcome, "WON");

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/api/bookings/book-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("supports related call navigation control", async () => {
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi Kumar",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });
    mockBookingsApis();

    wrap(<BookingsPage />, "/bookings");
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Open related call/i }).length).toBeGreaterThan(0);
    });
  });

  it("renders empty and API error states", async () => {
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-assigned",
        name: "Ravi",
        email: "ravi@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });

    mockedApiFetch.mockImplementation(async (path: string) => {
      if (path === "/api/team/overview") return { members: [] };
      if (path.startsWith("/api/bookings")) {
        return {
          bookings: [],
          summary: { total: 0, requested: 0, confirmed: 0, cancelled: 0, completed: 0 },
        };
      }
      throw new Error(path);
    });

    wrap(<BookingsPage />, "/bookings");
    await waitFor(() => {
      expect(screen.getByText(/No meetings yet/i)).toBeInTheDocument();
    });
  });
});

describe("Recording panel copy states via CallsPage fixtures", () => {
  it("shows preparing and failure labels through resolveRecordingUiState chips when detail loads", async () => {
    mockedUseAuth.mockReturnValue({
      user: {
        id: "u1",
        name: "U",
        email: "u@example.com",
        role: "ADMIN",
        companyId: "co-1",
        companyName: "Demo",
        industry: "OTHER",
      },
      loading: false,
      status: "AUTHENTICATED",
      login: vi.fn(),
      register: vi.fn(),
      refreshUser: vi.fn(),
      logout: vi.fn(),
    });

    const preparing = {
      ...sampleConversation,
      calls: [
        {
          ...sampleConversation.calls[0],
          recordingStatus: "QUEUED",
          recordingMediaUrl: "/api/calls/call-1/recording/media",
          recordingSource: "HUME",
          humeExpressionAnalysis: null,
        },
      ],
    };
    preparing.latestCall = preparing.calls[0];

    mockedApiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/calls")) {
        if (path === "/api/calls/conv-1") return { conversation: preparing };
        return {
          conversations: [preparing],
          latestCalls: [],
          summary: { totalConversations: 1, totalCalls: 1 },
        };
      }
      throw new Error(path);
    });

    wrap(<CallsPage />);
    await waitFor(() => {
      expect(screen.getByText(/State: Preparing/i)).toBeInTheDocument();
    });
  });
});
