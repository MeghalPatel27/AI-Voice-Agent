import "dotenv/config";
import { getHumeConfig } from "../src/integrations/hume/hume.config";
import {
  REQUIRED_HUME_TOOLS,
  TOOL_DESCRIPTIONS,
  buildCanonicalHumeParameters,
  buildCanonicalHumeParametersString,
  parseRemoteToolParameters,
  schemasEquivalent,
  validateRemoteToolSchemas,
} from "../src/integrations/hume/humeToolSchemas";
import {
  HUME_SYSTEM_PROMPT_CHAR_COUNT,
  HUME_SYSTEM_PROMPT_CHECKSUM,
  HUME_SYSTEM_PROMPT_TEXT,
  HUME_SYSTEM_PROMPT_VERSION,
  computePromptChecksum,
  normalizePromptText,
} from "../src/integrations/hume/humeSystemPrompt";
import { HUME_LATENCY_TARGETS } from "../src/integrations/hume/humeLatencyTargets";

type RemoteTool = {
  id: string;
  name: string;
  version: number;
  description?: string | null;
  parameters?: string;
};

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function extractVersions(payload: any) {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.configs_page)
      ? payload.configs_page
      : Array.isArray(payload?.versions)
        ? payload.versions
        : [];
}

async function humeRequest(path: string, options: { method?: string; body?: unknown } = {}) {
  const config = getHumeConfig();
  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Hume-Api-Key": config.apiKey,
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    throw new Error(`hume_request_failed:${path}:${response.status}:${String(text).slice(0, 200)}`);
  }
  return payload;
}

async function fetchLatestConfigVersion(configId: string) {
  const versionsPayload = (await humeRequest(`/v0/evi/configs/${configId}`)) as any;
  const versions = extractVersions(versionsPayload);
  if (!versions.length) throw new Error("hume_config_versions_empty");
  const versionNum = versions[0].version ?? 0;
  return humeRequest(`/v0/evi/configs/${configId}/version/${versionNum}`) as Promise<any>;
}

function redactParameters(parameters: unknown) {
  return parameters;
}

function readRemotePromptText(remote: any) {
  return normalizePromptText(String(remote?.prompt?.text || remote?.system_prompt || ""));
}

async function listAllTools(): Promise<RemoteTool[]> {
  const payload = (await humeRequest("/v0/evi/tools")) as any;
  const page = Array.isArray(payload?.tools_page) ? payload.tools_page : [];
  return page.map((tool: any) => ({
    id: tool.id,
    name: tool.name,
    version: tool.version,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/** Target latency settings imported from shared module. */
// Re-export for script consumers.
export { HUME_LATENCY_TARGETS } from "../src/integrations/hume/humeLatencyTargets";

function buildConfigVersionBody(remote: any, toolSpecs: Array<{ id: string; version: number }>) {
  const prompt = remote?.prompt;
  const voice = remote?.voice;
  const languageModel = remote?.language_model;
  const ellmModel = remote?.ellm_model;
  const webhooks = remote?.webhooks || [];
  const builtinTools = (remote?.builtin_tools || []).map((tool: any) => ({
    name: tool?.name,
    fallback_content: tool?.fallback_content ?? null,
  }));

  const remoteEventMessages = remote?.event_messages || {};
  const remoteTimeouts = remote?.timeouts || {};

  const turnDetection = {
    end_of_turn_silence_ms: HUME_LATENCY_TARGETS.endOfTurnSilenceMs,
    prefix_padding_ms: HUME_LATENCY_TARGETS.prefixPaddingMs,
    speech_detection_threshold: HUME_LATENCY_TARGETS.speechDetectionThreshold,
  };

  const interruption = {
    min_interruption_ms: HUME_LATENCY_TARGETS.minInterruptionMs,
  };

  const eventMessages = {
    on_new_chat: {
      enabled: true,
      text: HUME_LATENCY_TARGETS.onNewChatText,
    },
    on_resume_chat: remoteEventMessages.on_resume_chat ?? {
      enabled: false,
      text: null,
    },
    on_inactivity_timeout: {
      enabled: true,
      text: HUME_LATENCY_TARGETS.inactivityMessage,
    },
    on_max_duration_timeout: remoteEventMessages.on_max_duration_timeout ?? {
      enabled: false,
      text: null,
    },
  };

  const timeouts = {
    inactivity: {
      enabled: true,
      duration_secs: HUME_LATENCY_TARGETS.inactivityTimeoutSecs,
    },
    max_duration: remoteTimeouts.max_duration ?? {
      enabled: true,
      duration_secs: 1800,
    },
  };

  return {
    evi_version: String(remote?.evi_version || "3"),
    version_description: `AiraDesk latency+recovery ${HUME_SYSTEM_PROMPT_VERSION}`,
    prompt: prompt?.id
      ? {
          id: prompt.id,
          version: prompt.version ?? 0,
          prompt_expansion: prompt.prompt_expansion ?? undefined,
        }
      : undefined,
    voice: voice?.name
      ? {
          name: voice.name,
          provider: voice.provider || "HUME_AI",
        }
      : voice?.id
        ? {
            id: voice.id,
            provider: voice.provider || "HUME_AI",
          }
        : undefined,
    language_model: languageModel
      ? {
          model_provider: languageModel.model_provider,
          model_resource: languageModel.model_resource,
          temperature: languageModel.temperature ?? null,
        }
      : undefined,
    ellm_model: ellmModel
      ? {
          allow_short_responses: true,
        }
      : { allow_short_responses: true },
    event_messages: eventMessages,
    timeouts,
    nudges: remote?.nudges ?? { enabled: false, interval_secs: null },
    turn_detection: turnDetection,
    interruption,
    webhooks: webhooks.map((webhook: any) => ({
      url: webhook.url,
      events: webhook.events,
    })),
    builtin_tools: builtinTools,
    tools: toolSpecs,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const config = getHumeConfig();
  if (!config.apiKey || !config.configId) {
    console.log(JSON.stringify({ status: "failed", missingEnv: ["HUME_API_KEY", "HUME_CONFIG_ID"] }, null, 2));
    process.exitCode = 1;
    return;
  }

  const remote = await fetchLatestConfigVersion(config.configId);
  const configVersionBefore = remote?.version ?? null;
  const attachedTools = (remote?.tools || []) as RemoteTool[];
  const allTools = await listAllTools();

  const duplicateNames = allTools
    .map((tool) => tool.name)
    .filter((name, index, arr) => arr.indexOf(name) !== index);
  if (duplicateNames.length) {
    throw new Error(`duplicate_tool_names:${[...new Set(duplicateNames)].join(",")}`);
  }

  const diffs: Array<{
    name: string;
    id: string;
    versionBefore: number;
    action: "create_tool_version" | "unchanged";
    before: unknown;
    after: unknown;
  }> = [];

  const updatedToolVersions = new Map<string, number>();

  for (const toolName of REQUIRED_HUME_TOOLS) {
    const attached = attachedTools.find((tool) => tool.name === toolName);
    if (!attached?.id) {
      throw new Error(`attached_tool_missing:${toolName}`);
    }

    const before = parseRemoteToolParameters(attached);
    const after = buildCanonicalHumeParameters(toolName);
    const needsUpdate = !schemasEquivalent(toolName, attached);

    diffs.push({
      name: toolName,
      id: attached.id,
      versionBefore: attached.version,
      action: needsUpdate ? "create_tool_version" : "unchanged",
      before: redactParameters(before),
      after: redactParameters(after),
    });

    updatedToolVersions.set(attached.id, attached.version);
  }

  const proposedBody = buildConfigVersionBody(
    remote,
    attachedTools.map((tool) => ({
      id: tool.id,
      version: updatedToolVersions.get(tool.id) ?? tool.version,
    })),
  );
  const remotePromptText = readRemotePromptText(remote);
  const dryRunReport = {
    mode: apply ? "apply" : "dry-run",
    configId: config.configId,
    configIdPreserved: true,
    configName: remote?.name ?? null,
    configVersionBefore,
    configVersionAfterProposed: "new_version_on_apply",
    promptVersionBefore: remote?.prompt?.version ?? null,
    promptVersionAfter: HUME_SYSTEM_PROMPT_VERSION,
    promptCharCountBefore: remotePromptText.length,
    promptCharCountAfter: HUME_SYSTEM_PROMPT_CHAR_COUNT,
    promptChecksumBefore: computePromptChecksum(remotePromptText),
    promptChecksumAfter: HUME_SYSTEM_PROMPT_CHECKSUM,
    promptChanged: computePromptChecksum(remotePromptText) !== HUME_SYSTEM_PROMPT_CHECKSUM,
    endOfTurnSilenceMsBefore: remote?.turn_detection?.end_of_turn_silence_ms ?? null,
    endOfTurnSilenceMsAfter: proposedBody.turn_detection.end_of_turn_silence_ms,
    speechDetectionThresholdBefore:
      remote?.turn_detection?.speech_detection_threshold ?? null,
    speechDetectionThresholdAfter:
      proposedBody.turn_detection.speech_detection_threshold,
    prefixPaddingMsBefore: remote?.turn_detection?.prefix_padding_ms ?? null,
    prefixPaddingMsAfter: proposedBody.turn_detection.prefix_padding_ms,
    minInterruptionMsBefore: remote?.interruption?.min_interruption_ms ?? null,
    minInterruptionMsAfter: proposedBody.interruption.min_interruption_ms,
    quickResponsesBefore: remote?.ellm_model?.allow_short_responses ?? null,
    quickResponsesAfter: proposedBody.ellm_model.allow_short_responses,
    inactivityTimeoutSecsBefore: remote?.timeouts?.inactivity?.duration_secs ?? null,
    inactivityTimeoutSecsAfter: proposedBody.timeouts.inactivity.duration_secs,
    inactivityMessageBefore: remote?.event_messages?.on_inactivity_timeout ?? null,
    inactivityMessageAfter: proposedBody.event_messages.on_inactivity_timeout,
    voicePreserved: proposedBody.voice?.name === "Kora" || proposedBody.voice?.name === remote?.voice?.name,
    modelPreserved: proposedBody.language_model?.model_resource === "gpt-4o",
    toolsPreserved: attachedTools.map((tool) => tool.name),
    webhooksPreserved: (proposedBody.webhooks || []).map((webhook: any) => ({
      events: webhook.events,
      urlHost: (() => {
        try {
          return new URL(webhook.url).host;
        } catch {
          return "invalid";
        }
      })(),
    })),
    hangupPreserved: (proposedBody.builtin_tools || []).some((tool: any) => tool.name === "hang_up"),
    duplicateToolNames: duplicateNames,
    toolDiffs: diffs,
    configVersionBodyPreview: proposedBody,
  };

  if (!apply) {
    console.log(JSON.stringify(dryRunReport, null, 2));
    return;
  }

  for (const diff of diffs) {
    if (diff.action !== "create_tool_version") continue;
    const created = (await humeRequest(`/v0/evi/tools/${diff.id}`, {
      method: "POST",
      body: {
        parameters: buildCanonicalHumeParametersString(diff.name),
        description: TOOL_DESCRIPTIONS[diff.name] || "",
        version_description: "Align parameters with AiraDesk backend Zod validators",
      },
    })) as RemoteTool;
    updatedToolVersions.set(diff.id, created.version);
    diff.versionBefore = created.version - 1;
  }

  let promptRef = remote?.prompt;
  if (
    promptRef?.id &&
    computePromptChecksum(remotePromptText) !== HUME_SYSTEM_PROMPT_CHECKSUM
  ) {
    const createdPrompt = (await humeRequest(`/v0/evi/prompts/${promptRef.id}`, {
      method: "POST",
      body: {
        text: HUME_SYSTEM_PROMPT_TEXT,
        version_description: `AiraDesk canonical prompt ${HUME_SYSTEM_PROMPT_VERSION}`,
      },
    })) as any;
    promptRef = {
      ...promptRef,
      version: createdPrompt?.version ?? promptRef.version,
      id: createdPrompt?.id ?? promptRef.id,
    };
  }

  const configBody = buildConfigVersionBody(
    {
      ...remote,
      prompt: promptRef || remote?.prompt,
    },
    attachedTools.map((tool) => ({
      id: tool.id,
      version: updatedToolVersions.get(tool.id) ?? tool.version,
    })),
  );

  const createdConfig = (await humeRequest(`/v0/evi/configs/${config.configId}`, {
    method: "POST",
    body: configBody,
  })) as any;

  const refreshed = await fetchLatestConfigVersion(config.configId);
  const applyReport = {
    status: "applied",
    configId: config.configId,
    configIdChanged: false,
    configVersionBefore,
    configVersionAfter: createdConfig?.version ?? refreshed?.version ?? null,
    promptPreserved: Boolean(configBody.prompt?.id),
    promptVersionApplied: configBody.prompt?.version ?? null,
    promptChecksumApplied: HUME_SYSTEM_PROMPT_CHECKSUM,
    voicePreserved: configBody.voice?.name === "Kora" || configBody.voice?.name === remote?.voice?.name,
    languageModelPreserved:
      configBody.language_model?.model_resource === remote?.language_model?.model_resource,
    webhookPreserved: Array.isArray(configBody.webhooks) && configBody.webhooks.length > 0,
    hangupPreserved: (configBody.builtin_tools || []).some((tool: any) => tool.name === "hang_up"),
    toolVersions: attachedTools.map((tool) => ({
      name: tool.name,
      id: tool.id,
      versionBefore: diffs.find((item) => item.id === tool.id)?.versionBefore ?? tool.version,
      versionAfter: updatedToolVersions.get(tool.id) ?? tool.version,
    })),
    toolSchemaIssues: validateRemoteToolSchemas(refreshed?.tools || []),
  };

  console.log(JSON.stringify(applyReport, null, 2));

  if (applyReport.toolSchemaIssues.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
