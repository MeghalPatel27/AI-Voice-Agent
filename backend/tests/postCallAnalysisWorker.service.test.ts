import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findManyMock,
  updateManyMock,
  findUniqueMock,
  updateMock,
  loadTranscriptMock,
  analyzeMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  loadTranscriptMock: vi.fn(),
  analyzeMock: vi.fn(),
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    callPostAnalysis: {
      findMany: findManyMock,
      updateMany: updateManyMock,
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

vi.mock("../src/services/postCallAnalysis.service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/services/postCallAnalysis.service")
  >("../src/services/postCallAnalysis.service");
  return {
    ...actual,
    loadCallTranscriptForAnalysis: loadTranscriptMock,
    analyzeCallTranscriptWithOpenAI: analyzeMock,
    getPostCallAnalysisModel: () => "gpt-4o-mini",
  };
});

import { runPostCallAnalysisWorkerOnce } from "../src/services/postCallAnalysisWorker.service";

describe("postCallAnalysisWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 0 });
  });

  it("claims an eligible pending analysis once", async () => {
    const updatedAt = new Date("2026-07-25T01:00:00Z");
    findManyMock.mockResolvedValue([
      {
        id: "analysis_1",
        callId: "call_1",
        companyId: "company_1",
        attemptCount: 0,
        updatedAt,
      },
    ]);
    updateManyMock
      .mockResolvedValueOnce({ count: 0 }) // stale recovery
      .mockResolvedValueOnce({ count: 1 }); // claim
    findUniqueMock
      .mockResolvedValueOnce({
        id: "analysis_1",
        callId: "call_1",
        companyId: "company_1",
        status: "PROCESSING",
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        id: "analysis_1",
        callId: "call_1",
        companyId: "company_1",
        status: "PROCESSING",
        attemptCount: 1,
        call: { id: "call_1", status: "COMPLETED", endedAt: new Date() },
      });

    loadTranscriptMock.mockResolvedValue({
      call: { id: "call_1" },
      built: {
        transcript: "CUSTOMER: I want pricing and a demo next week.",
        customerTurnCount: 1,
        truncated: false,
        hasMeaningfulCustomerContent: true,
      },
    });
    analyzeMock.mockResolvedValue({
      intentLevel: "HIGH",
      intentScore: 74,
      confidence: 0.88,
      requirementSummary: "Customer wants pricing and a demo.",
      requirements: {
        primaryNeed: "Pricing",
        businessProblem: null,
        desiredCapabilities: ["Demo"],
        integrationNeeds: [],
        currentSolution: null,
        timelineSignal: "next week",
        budgetSignal: null,
        decisionStage: null,
        objections: [],
        requestedNextStep: "Demo",
      },
      evidenceSignals: ["Asked for pricing", "Requested demo"],
    });
    updateMock.mockResolvedValue({});

    const result = await runPostCallAnalysisWorkerOnce(1);

    expect(result.completed).toBe(1);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          intentLevel: "HIGH",
        }),
      }),
    );
  });

  it("marks insufficient data when customer transcript is empty after retries", async () => {
    const updatedAt = new Date();
    findManyMock.mockResolvedValue([
      {
        id: "analysis_2",
        callId: "call_2",
        companyId: "company_1",
        attemptCount: 3,
        updatedAt,
      },
    ]);
    updateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    findUniqueMock
      .mockResolvedValueOnce({
        id: "analysis_2",
        status: "PROCESSING",
        attemptCount: 4,
        callId: "call_2",
        companyId: "company_1",
      })
      .mockResolvedValueOnce({
        id: "analysis_2",
        status: "PROCESSING",
        attemptCount: 4,
        callId: "call_2",
        companyId: "company_1",
        call: { id: "call_2", status: "COMPLETED", endedAt: new Date() },
      });
    loadTranscriptMock.mockResolvedValue({
      call: { id: "call_2" },
      built: {
        transcript: "AI: Hello?",
        customerTurnCount: 0,
        truncated: false,
        hasMeaningfulCustomerContent: false,
      },
    });
    updateMock.mockResolvedValue({});

    const result = await runPostCallAnalysisWorkerOnce(1);

    expect(result.insufficient).toBe(1);
    expect(analyzeMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "INSUFFICIENT_DATA",
          intentLevel: "UNKNOWN",
        }),
      }),
    );
  });

  it("marks FAILED without mock output when OpenAI fails", async () => {
    const updatedAt = new Date();
    findManyMock.mockResolvedValue([
      {
        id: "analysis_3",
        callId: "call_3",
        companyId: "company_1",
        attemptCount: 3,
        updatedAt,
      },
    ]);
    updateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    findUniqueMock
      .mockResolvedValueOnce({
        id: "analysis_3",
        status: "PROCESSING",
        attemptCount: 4,
        callId: "call_3",
        companyId: "company_1",
      })
      .mockResolvedValueOnce({
        id: "analysis_3",
        status: "PROCESSING",
        attemptCount: 4,
        callId: "call_3",
        companyId: "company_1",
        call: { id: "call_3", status: "COMPLETED", endedAt: new Date() },
      });
    loadTranscriptMock.mockResolvedValue({
      call: { id: "call_3" },
      built: {
        transcript: "CUSTOMER: Please share pricing for AiraDesk.",
        customerTurnCount: 1,
        truncated: false,
        hasMeaningfulCustomerContent: true,
      },
    });
    analyzeMock.mockRejectedValue(new Error("openai_http_error"));
    updateMock.mockResolvedValue({});

    const result = await runPostCallAnalysisWorkerOnce(1);

    expect(result.failed).toBe(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          failureCode: "openai_http_error",
          intentScore: null,
        }),
      }),
    );
  });

  it("continues after one job failure", async () => {
    const updatedAt = new Date();
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "analysis_a",
          callId: "call_a",
          companyId: "company_1",
          attemptCount: 3,
          updatedAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "analysis_b",
          callId: "call_b",
          companyId: "company_1",
          attemptCount: 0,
          updatedAt,
        },
      ])
      .mockResolvedValue([]);

    updateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    findUniqueMock
      .mockResolvedValueOnce({
        id: "analysis_a",
        status: "PROCESSING",
        attemptCount: 4,
        callId: "call_a",
        companyId: "company_1",
      })
      .mockResolvedValueOnce({
        id: "analysis_a",
        status: "PROCESSING",
        attemptCount: 4,
        callId: "call_a",
        companyId: "company_1",
        call: { id: "call_a", status: "COMPLETED", endedAt: new Date() },
      })
      .mockResolvedValueOnce({
        id: "analysis_b",
        status: "PROCESSING",
        attemptCount: 1,
        callId: "call_b",
        companyId: "company_1",
      })
      .mockResolvedValueOnce({
        id: "analysis_b",
        status: "PROCESSING",
        attemptCount: 1,
        callId: "call_b",
        companyId: "company_1",
        call: { id: "call_b", status: "COMPLETED", endedAt: new Date() },
      });

    loadTranscriptMock
      .mockResolvedValueOnce({
        call: { id: "call_a" },
        built: {
          transcript: "CUSTOMER: Tell me about pricing.",
          customerTurnCount: 1,
          truncated: false,
          hasMeaningfulCustomerContent: true,
        },
      })
      .mockResolvedValueOnce({
        call: { id: "call_b" },
        built: {
          transcript: "CUSTOMER: Book a demo for next week.",
          customerTurnCount: 1,
          truncated: false,
          hasMeaningfulCustomerContent: true,
        },
      });

    analyzeMock
      .mockRejectedValueOnce(new Error("openai_http_error"))
      .mockResolvedValueOnce({
        intentLevel: "VERY_HIGH",
        intentScore: 90,
        confidence: 0.93,
        requirementSummary: "Customer requested a demo next week.",
        requirements: {
          primaryNeed: "Demo",
          businessProblem: null,
          desiredCapabilities: [],
          integrationNeeds: [],
          currentSolution: null,
          timelineSignal: "next week",
          budgetSignal: null,
          decisionStage: null,
          objections: [],
          requestedNextStep: "Demo",
        },
        evidenceSignals: ["Requested demo"],
      });
    updateMock.mockResolvedValue({});

    const result = await runPostCallAnalysisWorkerOnce(2);

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
  });
});
