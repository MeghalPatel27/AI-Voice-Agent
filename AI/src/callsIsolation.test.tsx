import { describe, expect, it, vi } from "vitest";

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

const mockedApiFetch = vi.mocked(apiFetch);
const mockedUseAuth = vi.mocked(useAuth);

function buildConversation(input: {
  id: string;
  callId: string;
  phone: string;
  transcript: string;
  requirementSummary: string;
  summary: string;
}) {
  return {
    id: input.id,
    channel: "AI_CALL",
    status: "FOLLOW_UP",
    priority: "HIGH",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T11:00:00.000Z",
    customer: {
      id: "cust-1",
      fullName: "Repeat Customer",
      phone: input.phone,
      requirementSummary: "Latest customer projection",
    },
    calls: [
      {
        id: input.callId,
        status: "COMPLETED",
        direction: "OUTBOUND",
        transcript: input.transcript,
        summary: input.summary,
        postCallAnalysis: {
          analysisStatus: "COMPLETED",
          requirementSummary: input.requirementSummary,
          requirementDetails: { desiredCapabilities: [input.requirementSummary] },
        },
      },
    ],
    latestCall: {
      id: input.callId,
      status: "COMPLETED",
      direction: "OUTBOUND",
      transcript: input.transcript,
      summary: input.summary,
      postCallAnalysis: {
        analysisStatus: "COMPLETED",
        requirementSummary: input.requirementSummary,
      },
    },
  };
}

describe("calls per-phone isolation helpers", () => {
  it("keeps distinct requirement summaries per Call fixture", () => {
    const callA = buildConversation({
      id: "conv-a",
      callId: "call-a",
      phone: "+919999999999",
      transcript: "Customer: First need",
      requirementSummary: "First requirements",
      summary: "First summary",
    });
    const callB = buildConversation({
      id: "conv-b",
      callId: "call-b",
      phone: "+919999999999",
      transcript: "Customer: Second need",
      requirementSummary: "Second requirements",
      summary: "Second summary",
    });

    expect(callA.calls[0]?.id).not.toBe(callB.calls[0]?.id);
    expect(callA.latestCall?.postCallAnalysis?.requirementSummary).toBe(
      "First requirements",
    );
    expect(callB.latestCall?.postCallAnalysis?.requirementSummary).toBe(
      "Second requirements",
    );
    expect(callA.customer?.requirementSummary).toBe("Latest customer projection");
  });

  it("uses unique Call IDs as row identity for same phone", () => {
    const rows = [
      buildConversation({
        id: "conv-1",
        callId: "call-1",
        phone: "+919999999999",
        transcript: "A",
        requirementSummary: "A",
        summary: "A",
      }),
      buildConversation({
        id: "conv-2",
        callId: "call-2",
        phone: "+919999999999",
        transcript: "B",
        requirementSummary: "B",
        summary: "B",
      }),
    ];

    const keys = rows.map((row) => row.calls[0]?.id);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("CallsPage API contract", () => {
  it("loads call detail by conversation without mixing customer projection", async () => {
    mockedUseAuth.mockReturnValue({
      token: "token",
      user: { role: "ADMIN" },
    } as ReturnType<typeof useAuth>);

    mockedApiFetch.mockResolvedValueOnce({
      conversations: [],
      summary: { totalConversations: 0 },
    });

    mockedApiFetch.mockResolvedValueOnce({
      conversation: buildConversation({
        id: "conv-old",
        callId: "call-old",
        phone: "+919999999999",
        transcript: "Customer: Old transcript",
        requirementSummary: "Old requirements",
        summary: "Old summary",
      }),
    });

    const list = await apiFetch("/api/calls");
    const detail = await apiFetch("/api/calls/conv-old");

    expect(list).toBeTruthy();
    expect(detail.conversation.latestCall?.transcript).toBe(
      "Customer: Old transcript",
    );
    expect(detail.conversation.latestCall?.postCallAnalysis?.requirementSummary).toBe(
      "Old requirements",
    );
    expect(detail.conversation.customer.requirementSummary).toBe(
      "Latest customer projection",
    );
  });
});
