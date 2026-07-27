import { describe, expect, it } from "vitest";
import {
  pickLatestCompletedCallAnalysis,
  withPostCallAnalysis,
} from "../src/services/postCallAnalysisApi.service";

describe("postCallAnalysisApi helpers", () => {
  it("includes analysis on call detail payloads", () => {
    const call = withPostCallAnalysis({
      id: "call_1",
      status: "COMPLETED",
      postAnalysis: {
        status: "COMPLETED",
        intentLevel: "HIGH",
        intentScore: 70,
        confidence: 0.8,
        requirementSummary: "Needs WhatsApp automation",
        requirementDetails: { primaryNeed: "WhatsApp" },
        evidenceSignals: ["Asked about WhatsApp"],
        completedAt: new Date("2026-07-25T02:00:00Z"),
        failureCode: null,
        promptVersion: "post-call-intent-v1",
        callId: "call_1",
      },
    });

    expect(call.postCallAnalysis.analysisStatus).toBe("COMPLETED");
    expect(call.postCallAnalysis.intentScore).toBe(70);
    expect((call as any).postAnalysis).toBeUndefined();
  });

  it("uses the latest completed analyzed call for lead projection", () => {
    const latest = pickLatestCompletedCallAnalysis([
      {
        id: "call_old",
        createdAt: new Date("2026-07-20T00:00:00Z"),
        postAnalysis: {
          status: "COMPLETED",
          intentLevel: "LOW",
          intentScore: 25,
          confidence: 0.5,
          requirementSummary: "Old call",
          requirementDetails: null,
          evidenceSignals: [],
          completedAt: new Date("2026-07-20T01:00:00Z"),
          failureCode: null,
          promptVersion: "post-call-intent-v1",
          callId: "call_old",
        },
      },
      {
        id: "call_new",
        createdAt: new Date("2026-07-25T00:00:00Z"),
        postAnalysis: {
          status: "COMPLETED",
          intentLevel: "HIGH",
          intentScore: 77,
          confidence: 0.9,
          requirementSummary: "Latest requirement summary",
          requirementDetails: null,
          evidenceSignals: [],
          completedAt: new Date("2026-07-25T01:00:00Z"),
          failureCode: null,
          promptVersion: "post-call-intent-v1",
          callId: "call_new",
        },
      },
    ]);

    expect(latest.isLatestCallAnalysis).toBe(true);
    expect(latest.callId).toBe("call_new");
    expect(latest.intentLevel).toBe("HIGH");
  });

  it("returns pending state for pending analysis", () => {
    const pending = pickLatestCompletedCallAnalysis([
      {
        id: "call_1",
        createdAt: new Date(),
        postAnalysis: {
          status: "PENDING",
          intentLevel: null,
          intentScore: null,
          confidence: null,
          requirementSummary: null,
          requirementDetails: null,
          evidenceSignals: null,
          completedAt: null,
          failureCode: null,
          promptVersion: null,
          callId: "call_1",
        },
      },
    ]);

    expect(pending.analysisStatus).toBe("PENDING");
  });
});
