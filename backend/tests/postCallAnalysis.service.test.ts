import { describe, expect, it } from "vitest";
import {
  buildLabeledTranscript,
  validatePostCallAnalysisResult,
} from "../src/services/postCallAnalysis.service";

describe("buildLabeledTranscript", () => {
  it("labels speakers chronologically", () => {
    const built = buildLabeledTranscript([
      {
        senderType: "AI",
        body: "How can I help?",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        senderType: "CUSTOMER",
        body: "I need WhatsApp automation for my clinic.",
        createdAt: new Date("2026-01-01T10:00:05Z"),
      },
    ]);

    expect(built.transcript).toContain("AI: How can I help?");
    expect(built.transcript).toContain(
      "CUSTOMER: I need WhatsApp automation for my clinic.",
    );
    expect(built.hasMeaningfulCustomerContent).toBe(true);
    expect(built.customerTurnCount).toBe(1);
  });

  it("marks empty greeting-only customer speech as insufficient", () => {
    const built = buildLabeledTranscript([
      { senderType: "CUSTOMER", body: "Hello" },
      { senderType: "AI", body: "Hi there" },
    ]);

    expect(built.hasMeaningfulCustomerContent).toBe(false);
  });
});

describe("validatePostCallAnalysisResult", () => {
  const valid = {
    intentLevel: "HIGH" as const,
    intentScore: 72,
    confidence: 0.84,
    requirementSummary:
      "The customer wants an AI voice and WhatsApp system that qualifies property buyers.",
    requirements: {
      primaryNeed: "Automate inbound lead qualification",
      businessProblem: "Agents miss calls",
      desiredCapabilities: ["AI voice calls", "WhatsApp follow-up"],
      integrationNeeds: [],
      currentSolution: null,
      timelineSignal: "Wants to test within the next month",
      budgetSignal: null,
      decisionStage: "Evaluating",
      objections: ["Concerned about AI response accuracy"],
      requestedNextStep: "Product demo",
    },
    evidenceSignals: ["Asked for a demo", "Explained missed-call problem"],
  };

  it("accepts strong buying-signal fixture output", () => {
    const result = validatePostCallAnalysisResult(valid);
    expect(result.intentLevel).toBe("HIGH");
    expect(result.intentScore).toBe(72);
    expect(result.requirements.budgetSignal).toBeNull();
  });

  it("supports not-interested output", () => {
    const result = validatePostCallAnalysisResult({
      ...valid,
      intentLevel: "NOT_INTERESTED",
      intentScore: 8,
      confidence: 0.9,
      requirementSummary: "Caller said they are not interested in the software.",
      evidenceSignals: ["Explicitly said not interested"],
    });
    expect(result.intentLevel).toBe("NOT_INTERESTED");
  });

  it("supports UNKNOWN with null score", () => {
    const result = validatePostCallAnalysisResult({
      ...valid,
      intentLevel: "UNKNOWN",
      intentScore: 40,
      confidence: 0.3,
      requirementSummary: "Too little discussion to judge purchase interest.",
    });
    expect(result.intentLevel).toBe("UNKNOWN");
    expect(result.intentScore).toBeNull();
  });

  it("keeps missing budget and timeline null", () => {
    const result = validatePostCallAnalysisResult({
      ...valid,
      requirements: {
        ...valid.requirements,
        budgetSignal: null,
        timelineSignal: null,
      },
    });
    expect(result.requirements.budgetSignal).toBeNull();
    expect(result.requirements.timelineSignal).toBeNull();
  });

  it("rejects scores outside 0-100", () => {
    expect(() =>
      validatePostCallAnalysisResult({
        ...valid,
        intentScore: 140,
      }),
    ).toThrow();
  });

  it("rejects confidence outside 0-1", () => {
    expect(() =>
      validatePostCallAnalysisResult({
        ...valid,
        confidence: 1.5,
      }),
    ).toThrow();
  });

  it("rejects unsupported enum values", () => {
    expect(() =>
      validatePostCallAnalysisResult({
        ...valid,
        intentLevel: "SUPER_HIGH",
      }),
    ).toThrow();
  });

  it("rejects oversized requirement summaries", () => {
    expect(() =>
      validatePostCallAnalysisResult({
        ...valid,
        requirementSummary: "x".repeat(501),
      }),
    ).toThrow();
  });

  it("does not return a mock fallback object on invalid input", () => {
    expect(() => validatePostCallAnalysisResult(null)).toThrow();
  });
});
