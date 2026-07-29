import "dotenv/config";
import { getHumeConfig } from "../src/integrations/hume/hume.config";
import {
  REQUIRED_HUME_TOOLS,
  validateRemoteToolSchemas,
} from "../src/integrations/hume/humeToolSchemas";
import {
  HUME_SYSTEM_PROMPT_CHECKSUM,
  HUME_SYSTEM_PROMPT_VERSION,
  computePromptChecksum,
  normalizePromptText,
} from "../src/integrations/hume/humeSystemPrompt";

const REQUIRED_EVENTS = ["chat_started", "chat_ended", "tool_call"] as const;

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function redactWebhookUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid_url";
  }
}

function redactHumeConfigId(configId: string | null | undefined) {
  const value = String(configId || "").trim();
  if (!value) return null;
  if (value.length <= 12) return `${value.slice(0, 4)}…`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
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

async function fetchLatestConfig(configId: string, apiKey: string, apiBaseUrl: string) {
  const base = apiBaseUrl.replace(/\/$/, "");
  const listResponse = await fetch(`${base}/v0/evi/configs`, {
    headers: {
      "X-Hume-Api-Key": apiKey,
      Accept: "application/json",
    },
  });
  if (!listResponse.ok) {
    throw new Error(`hume_config_list_failed:${listResponse.status}`);
  }
  const listed = (await listResponse.json()) as any;
  const configs = Array.isArray(listed)
    ? listed
    : Array.isArray(listed?.configs_page)
      ? listed.configs_page
      : Array.isArray(listed?.configs)
        ? listed.configs
        : [];

  const summary = configs.find((item: any) => item?.id === configId) || configs[0];
  if (!summary?.id) {
    throw new Error("hume_config_not_found");
  }

  const versionsResponse = await fetch(`${base}/v0/evi/configs/${summary.id}`, {
    headers: {
      "X-Hume-Api-Key": apiKey,
      Accept: "application/json",
    },
  });
  if (!versionsResponse.ok) {
    throw new Error(`hume_config_versions_failed:${versionsResponse.status}`);
  }
  const versionsPayload = (await versionsResponse.json()) as any;
  const versions = extractVersions(versionsPayload);
  if (!versions.length) {
    throw new Error("hume_config_versions_empty");
  }
  const latest = versions[0];
  const version = latest.version ?? summary.version ?? 0;
  const versionResponse = await fetch(
    `${base}/v0/evi/configs/${summary.id}/version/${version}`,
    {
      headers: {
        "X-Hume-Api-Key": apiKey,
        Accept: "application/json",
      },
    },
  );
  if (!versionResponse.ok) {
    throw new Error(`hume_config_version_fetch_failed:${versionResponse.status}`);
  }
  return versionResponse.json();
}

function resolveDataRetentionStatus() {
  const flag = env("HUME_DATA_RETENTION_USER_CONFIRMED").toLowerCase();
  if (flag === "true" || flag === "on" || flag === "1" || flag === "yes") {
    return "USER_CONFIRMED_ON";
  }
  return "USER DASHBOARD CONFIRMATION REQUIRED";
}

async function main() {
  const config = getHumeConfig();
  const webhookBase = env("HUME_WEBHOOK_PUBLIC_URL") || env("PUBLIC_WEBHOOK_URL");
  const expectedWebhookUrl = webhookBase.includes("/api/webhooks/hume/evi")
    ? webhookBase.replace(/\/$/, "")
    : `${webhookBase.replace(/\/$/, "")}/api/webhooks/hume/evi`;

  const missingEnv = [
    !config.apiKey ? "HUME_API_KEY" : null,
    !config.configId ? "HUME_CONFIG_ID" : null,
    !config.webhookSigningKey ? "HUME_WEBHOOK_SIGNING_KEY" : null,
    !webhookBase ? "PUBLIC_WEBHOOK_URL" : null,
  ].filter(Boolean);

  if (missingEnv.length) {
    console.log(
      JSON.stringify(
        {
          validationStatus: "failed",
          missingEnv,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const remote = await fetchLatestConfig(
    config.configId,
    config.apiKey,
    config.apiBaseUrl,
  );

  const webhooks = remote?.webhooks || remote?.event_webhooks || [];
  const webhook = Array.isArray(webhooks) ? webhooks[0] : webhooks;
  const webhookEvents = webhook?.events || webhook?.subscriptions || [];
  const customTools = remote?.tools || remote?.custom_tools || [];
  const builtinTools = remote?.builtin_tools || remote?.built_in_tools || [];
  const hangupEnabled = builtinTools.some(
    (tool: any) => {
      const name = String(tool?.name || tool?.tool_name || tool).toLowerCase();
      return name === "hang_up" && (tool?.enabled === undefined || tool.enabled === true);
    },
  );

  const toolIssues = validateRemoteToolSchemas(customTools);
  const missingEvents = REQUIRED_EVENTS.filter(
    (event) => !webhookEvents.includes(event),
  );

  const remotePromptText = normalizePromptText(
    String(remote?.prompt?.text || remote?.system_prompt || ""),
  );
  const turnDetection = remote?.turn_detection || {};
  const interruption = remote?.interruption || {};
  const ellm = remote?.ellm_model || {};
  const eventMessages = remote?.event_messages || {};
  const timeouts = remote?.timeouts || {};

  const latencyChecks = {
    endOfTurnSilenceMs: turnDetection.end_of_turn_silence_ms === 500,
    prefixPaddingMs: turnDetection.prefix_padding_ms === 300,
    speechDetectionThreshold: turnDetection.speech_detection_threshold === 0.45,
    minInterruptionMs: interruption.min_interruption_ms === 300,
    quickResponsesEnabled: ellm.allow_short_responses === true,
    inactivityMessageEnabled:
      eventMessages?.on_inactivity_timeout?.enabled === true &&
      /still there/i.test(String(eventMessages?.on_inactivity_timeout?.text || "")),
    inactivityTimeoutSecs: timeouts?.inactivity?.duration_secs === 30,
    voiceIsKora: String(remote?.voice?.name || "") === "Kora",
    modelIsGpt4o: String(remote?.language_model?.model_resource || "") === "gpt-4o",
  };

  const report = {
    promptVersionExpected: HUME_SYSTEM_PROMPT_VERSION,
    promptChecksumExpected: HUME_SYSTEM_PROMPT_CHECKSUM,
    validationStatus:
      missingEvents.length === 0 &&
      toolIssues.length === 0 &&
      hangupEnabled &&
      Boolean(webhook?.url || webhook?.callback_url) &&
      Object.values(latencyChecks).every(Boolean)
        ? "passed"
        : "failed",
    configExists: true,
    humeConfigId: redactHumeConfigId(config.configId),
    humeConfigVersion: remote?.version ?? null,
    configName: remote?.name || null,
    eviVersion: remote?.evi_version || remote?.eviVersion || "unknown",
    humePromptId: redactHumeConfigId(remote?.prompt?.id || null),
    humePromptRemoteVersion: remote?.prompt?.version ?? null,
    localCanonicalPromptVersion: HUME_SYSTEM_PROMPT_VERSION,
    localCanonicalPromptChecksum: HUME_SYSTEM_PROMPT_CHECKSUM,
    remotePromptChecksum: computePromptChecksum(remotePromptText),
    promptChecksumMatch:
      computePromptChecksum(remotePromptText) === HUME_SYSTEM_PROMPT_CHECKSUM,
    voiceNameOrId:
      remote?.voice?.name ||
      remote?.voice?.id ||
      remote?.voice_id ||
      remote?.voice_name ||
      null,
    languageModel:
      remote?.language_model?.model_resource ||
      remote?.language_model?.model ||
      remote?.ellm_model?.model_resource ||
      remote?.ellm_model?.model ||
      remote?.model?.name ||
      null,
    languageProvider:
      remote?.language_model?.provider ||
      remote?.language_model?.model_provider ||
      remote?.ellm_model?.provider ||
      remote?.model?.provider ||
      null,
    promptPresent: Boolean(remotePromptText),
    promptRules: {
      under7000Chars: remotePromptText.length < 7000,
      hasNowVariable: /\{\{now\}\}/.test(remotePromptText),
      hasContextTool: /airadesk_get_call_context/.test(remotePromptText),
      hasLeadCaptureTool: /airadesk_capture_lead_details/.test(remotePromptText),
      hasScheduleTool: /airadesk_schedule_meeting/.test(remotePromptText),
      hasHumanHandoffTool: /airadesk_request_human_handoff/.test(remotePromptText),
      hasCowdOpening:
        /Hi, this is Kora from Cowd\. We build software solutions and websites for businesses\./.test(
          remotePromptText,
        ),
      forbidsHowCanIHelpYou: /Do not ask “How can I help you\?”/.test(remotePromptText),
      hasDiscoveryLimit: /Ask no more than two or three discovery questions\./.test(
        remotePromptText,
      ),
      requiresExactDateTimeTimezone:
        /Use airadesk_schedule_meeting only when exact date, time, and timezone are known\./.test(
          remotePromptText,
        ),
      requiresToolSuccessForScheduling:
        /A meeting is scheduled only when the tool returns success: true\./.test(
          remotePromptText,
        ),
      hasSuccessfulMeetingClosing:
        /Perfect\. Our team will reach out to you at the confirmed time\. Thank you, and have a great day\./.test(
          remotePromptText,
        ),
      requiresHangupAfterSuccess: /Then use hang_up\./.test(remotePromptText),
      forbidsAnythingElseQuestion:
        /Do not ask “Is there anything else I can help you with\?”/.test(remotePromptText),
      respectsOptOut:
        /If asked not to contact again, acknowledge, stop the sales conversation, and end the call\./.test(
          remotePromptText,
        ),
      hasNoCursorInstructions: !/Cursor|BEGIN APPROVED PROMPT|END APPROVED PROMPT/.test(
        remotePromptText,
      ),
      hasNoSecretTokens:
        !/HUME_API_KEY|TWILIO_AUTH_TOKEN|WEBHOOK_SIGNING_KEY|sk-[A-Za-z0-9]/.test(
          remotePromptText,
        ),
    },
    latencySettings: {
      end_of_turn_silence_ms: turnDetection.end_of_turn_silence_ms ?? null,
      prefix_padding_ms: turnDetection.prefix_padding_ms ?? null,
      speech_detection_threshold: turnDetection.speech_detection_threshold ?? null,
      min_interruption_ms: interruption.min_interruption_ms ?? null,
      allow_short_responses: ellm.allow_short_responses ?? null,
      inactivity_timeout_secs: timeouts?.inactivity?.duration_secs ?? null,
      inactivity_message_enabled: eventMessages?.on_inactivity_timeout?.enabled ?? null,
    },
    latencyChecks,
    webhookConfigured: Boolean(webhook?.url || webhook?.callback_url),
    webhookDestination: redactWebhookUrl(
      String(webhook?.url || webhook?.callback_url || ""),
    ),
    expectedWebhookDestination: redactWebhookUrl(expectedWebhookUrl),
    webhookEvents: webhookEvents,
    requiredWebhookEvents: REQUIRED_EVENTS,
    missingWebhookEvents: missingEvents,
    toolNames: customTools.map((tool: any) => tool?.name).filter(Boolean),
    requiredToolNames: REQUIRED_HUME_TOOLS,
    attachedToolVersions: customTools.map((tool: any) => ({
      name: tool?.name,
      id: tool?.id,
      version: tool?.version,
    })),
    builtinToolNames: builtinTools.map((tool: any) => tool?.name || tool),
    hangupEnabled,
    toolSchemaIssues: toolIssues,
    dataRetention: resolveDataRetentionStatus(),
  };

  console.log(JSON.stringify(report, null, 2));

  const promptRulesPassed = Object.values(report.promptRules).every(Boolean);
  if (
    report.validationStatus !== "passed" ||
    !report.promptChecksumMatch ||
    !promptRulesPassed
  ) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        validationStatus: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
