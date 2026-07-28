import { z } from "zod";

export const REQUIRED_HUME_TOOLS = [
  "airadesk_get_call_context",
  "airadesk_capture_lead_details",
  "airadesk_schedule_meeting",
  "airadesk_request_human_handoff",
] as const;

/** Tools whose remote schemas should be rewritten to the Hume-UI-safe canonical form. */
export const TOOLS_TO_SCHEMA_CORRECT = [
  "airadesk_get_call_context",
  "airadesk_capture_lead_details",
  "airadesk_schedule_meeting",
  "airadesk_request_human_handoff",
] as const;

export const FORBIDDEN_TOOL_PARAMS = new Set([
  "companyId",
  "callId",
  "customerId",
  "tenantId",
  "assignedUserId",
  "userId",
]);

export const captureLeadSchema = z.object({
  fullName: z.string().trim().optional(),
  businessType: z.string().trim().optional(),
  requiredServices: z.array(z.string()).optional(),
  requirementSummary: z.string().trim().optional(),
  budget: z.string().trim().optional(),
  timeline: z.string().trim().optional(),
  preferredLanguage: z.string().trim().optional(),
  preferredMeetingTime: z.string().trim().optional(),
  additionalNotes: z.string().trim().optional(),
});

export const scheduleMeetingSchema = z.object({
  preferredTimeText: z.string().trim().min(1),
  timezone: z.string().trim().optional(),
  purpose: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  modelResolvedIso: z.string().trim().optional(),
});

export const handoffSchema = z.object({
  reason: z.string().trim().min(1),
  urgency: z.string().trim().min(1),
  notes: z.string().trim().optional(),
});

export const TOOL_ZOD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  airadesk_get_call_context: z.object({}).strict(),
  airadesk_capture_lead_details: captureLeadSchema,
  airadesk_schedule_meeting: scheduleMeetingSchema,
  airadesk_request_human_handoff: handoffSchema,
};

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  airadesk_get_call_context:
    "Fetch tenant-safe call context (company settings, customer summary, knowledge snippets). No caller-supplied IDs.",
  airadesk_capture_lead_details:
    "Capture lead details shared during the call. Do not pass tenant or database identifiers.",
  airadesk_schedule_meeting:
    "Request a meeting using the caller's stated date/time wording. Ask for clarification when timing is ambiguous.",
  airadesk_request_human_handoff:
    "Escalate to a human agent with reason and urgency in the caller's own words.",
};

type JsonSchemaProperty = {
  type: string | string[];
  description?: string;
  items?: { type: string };
};

/**
 * Hume Platform UI expects the same subset shown in their docs:
 * type/properties/required/description/enum only.
 * Keywords like additionalProperties and minLength parse as JSON but the
 * website editor reports "Invalid JSON".
 */
type JsonSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
};

function buildScheduleMeetingParameters(): JsonSchema {
  return {
    type: "object",
    required: ["preferredTimeText"],
    properties: {
      preferredTimeText: {
        type: "string",
        description:
          "The date and time the caller stated, in their own words (for example next Tuesday at 3pm or tomorrow morning). Pass their wording verbatim. Do not invent or assume a specific calendar date or time when the request is ambiguous; ask the caller to clarify first.",
      },
      timezone: {
        type: "string",
        description: "Optional IANA timezone if the caller mentioned one.",
      },
      purpose: {
        type: "string",
        description: "Optional purpose or topic for the meeting.",
      },
      notes: {
        type: "string",
        description: "Optional additional notes about the meeting request.",
      },
    },
  };
}

function buildHandoffParameters(): JsonSchema {
  return {
    type: "object",
    required: ["reason", "urgency"],
    properties: {
      reason: {
        type: "string",
        description: "Why the caller needs a human agent.",
      },
      urgency: {
        type: "string",
        description:
          "How urgent the handoff is, in the callers own words (for example need someone today or whenever available). Capture what the caller said; there is no fixed enum.",
      },
      notes: {
        type: "string",
        description: "Optional extra context for the human agent.",
      },
    },
  };
}

function buildGetCallContextParameters(): JsonSchema {
  return {
    type: "object",
    required: [],
    properties: {},
  };
}

function buildCaptureLeadParameters(): JsonSchema {
  return {
    type: "object",
    required: [],
    properties: {
      fullName: { type: "string", description: "Caller full name if provided." },
      businessType: { type: "string", description: "Type of business if mentioned." },
      requiredServices: {
        type: "array",
        items: { type: "string" },
        description: "Services the caller is interested in.",
      },
      requirementSummary: { type: "string", description: "Summary of requirements." },
      budget: { type: "string", description: "Budget range if mentioned." },
      timeline: { type: "string", description: "Desired timeline if mentioned." },
      preferredLanguage: { type: "string", description: "Preferred language if mentioned." },
      preferredMeetingTime: {
        type: "string",
        description: "Preferred meeting time phrasing if mentioned before scheduling.",
      },
      additionalNotes: { type: "string", description: "Any other lead notes." },
    },
  };
}

export function buildCanonicalHumeParameters(toolName: string): JsonSchema {
  switch (toolName) {
    case "airadesk_schedule_meeting":
      return buildScheduleMeetingParameters();
    case "airadesk_request_human_handoff":
      return buildHandoffParameters();
    case "airadesk_get_call_context":
      return buildGetCallContextParameters();
    case "airadesk_capture_lead_details":
      return buildCaptureLeadParameters();
    default:
      throw new Error(`unsupported_tool:${toolName}`);
  }
}

export function buildCanonicalHumeParametersString(toolName: string): string {
  // Pretty-print matches schemas created in the Hume Platform UI and avoids
  // the website editor treating compact API payloads as invalid.
  return JSON.stringify(buildCanonicalHumeParameters(toolName), null, 2);
}

export function parseRemoteToolParameters(tool: unknown) {
  const raw = (tool as { parameters?: unknown })?.parameters;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return raw as Record<string, unknown>;
}

export function remoteToolParameterNames(tool: unknown) {
  const parsed = parseRemoteToolParameters(tool);
  const properties = parsed?.properties;
  return properties && typeof properties === "object"
    ? Object.keys(properties as Record<string, unknown>)
    : [];
}

export function remoteToolRequiredNames(tool: unknown) {
  const parsed = parseRemoteToolParameters(tool);
  return Array.isArray(parsed?.required) ? (parsed.required as string[]) : [];
}

function zodFieldRequired(schema: z.ZodTypeAny): boolean {
  return !(schema instanceof z.ZodOptional);
}

function expectedRequiredFields(toolName: string): string[] {
  const schema = TOOL_ZOD_SCHEMAS[toolName];
  if (!(schema instanceof z.ZodObject)) return [];
  const shape = schema.shape;
  return Object.keys(shape).filter((key) => zodFieldRequired(shape[key]));
}

function expectedOptionalFields(toolName: string): string[] {
  const schema = TOOL_ZOD_SCHEMAS[toolName];
  if (!(schema instanceof z.ZodObject)) return [];
  const shape = schema.shape;
  return Object.keys(shape).filter((key) => !zodFieldRequired(shape[key]));
}

function propertyTypeMatches(
  toolName: string,
  propertyName: string,
  remoteProperty: JsonSchemaProperty,
): boolean {
  const schema = TOOL_ZOD_SCHEMAS[toolName];
  if (!(schema instanceof z.ZodObject)) return true;
  const field = schema.shape[propertyName];
  if (!field) return false;

  const remoteType = remoteProperty.type;
  if (propertyName === "requiredServices") {
    return remoteType === "array" && remoteProperty.items?.type === "string";
  }
  if (field instanceof z.ZodArray) {
    return remoteType === "array";
  }
  return remoteType === "string";
}

export function validateRemoteToolSchema(tool: { name?: string }): string[] {
  const issues: string[] = [];
  const toolName = String(tool?.name || "");
  if (!toolName) return ["missing_tool_name"];

  const params = remoteToolParameterNames(tool);
  for (const forbidden of FORBIDDEN_TOOL_PARAMS) {
    if (params.includes(forbidden)) {
      issues.push(`forbidden_param:${toolName}.${forbidden}`);
    }
  }

  const schema = TOOL_ZOD_SCHEMAS[toolName];
  if (!schema) return issues;

  for (const key of expectedRequiredFields(toolName)) {
    if (!params.includes(key)) {
      issues.push(`missing_param:${toolName}.${key}`);
    }
  }

  const remoteRequired = remoteToolRequiredNames(tool);
  for (const key of expectedRequiredFields(toolName)) {
    if (!remoteRequired.includes(key)) {
      issues.push(`missing_required_array:${toolName}.${key}`);
    }
  }
  for (const key of remoteRequired) {
    const field = (schema as z.ZodObject<any>).shape?.[key];
    if (field instanceof z.ZodOptional) {
      issues.push(`optional_should_be_required:${toolName}.${key}`);
    }
    if (field === undefined && key !== "") {
      issues.push(`unexpected_required_param:${toolName}.${key}`);
    }
  }

  const parsed = parseRemoteToolParameters(tool);
  const properties = (parsed?.properties || {}) as Record<string, JsonSchemaProperty>;
  for (const key of [...expectedRequiredFields(toolName), ...expectedOptionalFields(toolName)]) {
    const remoteProperty = properties[key];
    if (!remoteProperty) continue;
    if (!propertyTypeMatches(toolName, key, remoteProperty)) {
      issues.push(`type_mismatch:${toolName}.${key}`);
    }
  }

  return issues;
}

export function validateRemoteToolSchemas(tools: Array<{ name?: string }>): string[] {
  const issues: string[] = [];
  for (const requiredName of REQUIRED_HUME_TOOLS) {
    const tool = tools.find((item) => item?.name === requiredName);
    if (!tool) {
      issues.push(`missing_tool:${requiredName}`);
      continue;
    }
    issues.push(...validateRemoteToolSchema(tool));
  }
  return issues;
}

export function schemasEquivalent(toolName: string, remoteTool: unknown): boolean {
  const canonical = buildCanonicalHumeParameters(toolName);
  const remote = parseRemoteToolParameters(remoteTool);
  if (!remote) return false;
  return JSON.stringify(canonical) === JSON.stringify(remote);
}
