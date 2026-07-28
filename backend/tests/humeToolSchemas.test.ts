import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_TOOL_PARAMS,
  buildCanonicalHumeParameters,
  buildCanonicalHumeParametersString,
  handoffSchema,
  scheduleMeetingSchema,
  validateRemoteToolSchema,
} from "../src/integrations/hume/humeToolSchemas";

function remoteTool(name: string, parameters: Record<string, unknown>) {
  return {
    name,
    parameters: JSON.stringify(parameters),
  };
}

describe("Hume tool schema contracts", () => {
  it("requires preferredTimeText for schedule meeting backend parsing", () => {
    expect(() => scheduleMeetingSchema.parse({})).toThrow();
    expect(scheduleMeetingSchema.parse({ preferredTimeText: "next Tuesday at 3pm" }).preferredTimeText).toBe(
      "next Tuesday at 3pm",
    );
  });

  it("requires reason and urgency for handoff backend parsing", () => {
    expect(() => handoffSchema.parse({})).toThrow();
    expect(() => handoffSchema.parse({ reason: "billing issue" })).toThrow();
    expect(
      handoffSchema.parse({ reason: "billing issue", urgency: "need someone today" }).urgency,
    ).toBe("need someone today");
  });

  it("treats urgency as free-form text, not a fixed enum", () => {
    const schema = buildCanonicalHumeParameters("airadesk_request_human_handoff");
    expect(schema.required).toEqual(["reason", "urgency"]);
    expect(schema.properties.urgency?.type).toBe("string");
    expect("enum" in (schema.properties.urgency || {})).toBe(false);
  });

  it("uses Hume-UI-safe schemas without additionalProperties or minLength", () => {
    for (const name of ["airadesk_schedule_meeting", "airadesk_request_human_handoff"] as const) {
      const schema = buildCanonicalHumeParameters(name);
      expect("additionalProperties" in schema).toBe(false);
      for (const property of Object.values(schema.properties)) {
        expect("minLength" in property).toBe(false);
      }
    }
  });
});

describe("validateRemoteToolSchema", () => {
  it("rejects schedule-meeting schema without preferredTimeText", () => {
    const issues = validateRemoteToolSchema(
      remoteTool("airadesk_schedule_meeting", {
        type: "object",
        properties: { purpose: { type: "string" } },
        required: [],
      }),
    );
    expect(issues).toContain("missing_param:airadesk_schedule_meeting.preferredTimeText");
    expect(issues).toContain("missing_required_array:airadesk_schedule_meeting.preferredTimeText");
  });

  it("rejects handoff schema without reason", () => {
    const issues = validateRemoteToolSchema(
      remoteTool("airadesk_request_human_handoff", {
        type: "object",
        properties: { urgency: { type: "string" } },
        required: ["urgency"],
      }),
    );
    expect(issues).toContain("missing_param:airadesk_request_human_handoff.reason");
    expect(issues).toContain("missing_required_array:airadesk_request_human_handoff.reason");
  });

  it("rejects handoff schema without urgency", () => {
    const issues = validateRemoteToolSchema(
      remoteTool("airadesk_request_human_handoff", {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      }),
    );
    expect(issues).toContain("missing_param:airadesk_request_human_handoff.urgency");
    expect(issues).toContain("missing_required_array:airadesk_request_human_handoff.urgency");
  });

  it("rejects incorrect urgency enum constraints", () => {
    const issues = validateRemoteToolSchema(
      remoteTool("airadesk_request_human_handoff", {
        type: "object",
        properties: {
          reason: { type: "string" },
          urgency: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        },
        required: ["reason", "urgency"],
      }),
    );
    expect(issues).not.toContain("missing_param:airadesk_request_human_handoff.urgency");
    const canonical = JSON.parse(buildCanonicalHumeParametersString("airadesk_request_human_handoff"));
    expect(canonical.properties.urgency.enum).toBeUndefined();
  });

  it("rejects tenant/database identifier parameters", () => {
    for (const forbidden of FORBIDDEN_TOOL_PARAMS) {
      const issues = validateRemoteToolSchema(
        remoteTool("airadesk_schedule_meeting", {
          type: "object",
          properties: {
            preferredTimeText: { type: "string" },
            [forbidden]: { type: "string" },
          },
          required: ["preferredTimeText"],
        }),
      );
      expect(issues).toContain(`forbidden_param:airadesk_schedule_meeting.${forbidden}`);
    }
  });

  it("accepts the final canonical schedule-meeting schema", () => {
    const canonical = buildCanonicalHumeParameters("airadesk_schedule_meeting");
    const issues = validateRemoteToolSchema(remoteTool("airadesk_schedule_meeting", canonical));
    expect(issues).toEqual([]);
  });

  it("accepts the final canonical handoff schema", () => {
    const canonical = buildCanonicalHumeParameters("airadesk_request_human_handoff");
    const issues = validateRemoteToolSchema(remoteTool("airadesk_request_human_handoff", canonical));
    expect(issues).toEqual([]);
  });
});
