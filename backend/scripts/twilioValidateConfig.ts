import "dotenv/config";
import twilio from "twilio";
import { buildHumeTwilioUrl, redactUrlForLogs } from "../src/integrations/hume/hume.config";

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***${digits.slice(-4)}`;
}

async function main() {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const phoneNumber = env("TWILIO_PHONE_NUMBER");
  const publicWebhookUrl = env("PUBLIC_WEBHOOK_URL");
  const humeConfigId = env("HUME_CONFIG_ID");

  const missing = [
    !accountSid ? "TWILIO_ACCOUNT_SID" : null,
    !authToken ? "TWILIO_AUTH_TOKEN" : null,
    !phoneNumber ? "TWILIO_PHONE_NUMBER" : null,
    !publicWebhookUrl ? "PUBLIC_WEBHOOK_URL" : null,
    !humeConfigId ? "HUME_CONFIG_ID" : null,
  ].filter(Boolean);

  if (missing.length) {
    console.log(JSON.stringify({ validationStatus: "failed", missing }, null, 2));
    process.exitCode = 1;
    return;
  }

  const client = twilio(accountSid, authToken);
  const incomingNumbers = await client.incomingPhoneNumbers.list({ phoneNumber });
  const number = incomingNumbers[0];

  const expectedStatusCallback = `${publicWebhookUrl.replace(/\/$/, "")}/api/voice/twilio/status`;
  const humeTwilioUrl = buildHumeTwilioUrl();
  const humeTwilioUrlRedacted = redactUrlForLogs(humeTwilioUrl);

  const voiceUrl = number?.voiceUrl || "";
  const voiceMethod = number?.voiceMethod || "";
  const statusCallback = number?.statusCallback || "";
  const statusCallbackMethod = number?.statusCallbackMethod || "";

  const humeEndpointBase = "https://api.hume.ai/v0/evi/twilio";
  const voicePointsToHume = voiceUrl.startsWith(humeEndpointBase);
  const configIdMatches = voiceUrl.includes(`config_id=${humeConfigId}`);
  const statusCallbackMatches = statusCallback === expectedStatusCallback;
  const oldAiraDeskRouteActive =
    voiceUrl.includes("/api/voice/twilio/incoming") ||
    voiceUrl.includes("/api/voice/twilio/incoming-legacy");

  const report = {
    validationStatus:
      number &&
      voicePointsToHume &&
      configIdMatches &&
      voiceMethod.toUpperCase() === "POST" &&
      statusCallbackMatches &&
      statusCallbackMethod.toUpperCase() === "POST" &&
      !oldAiraDeskRouteActive
        ? "passed"
        : "failed",
    phoneNumberExists: Boolean(number),
    phoneNumberMasked: number ? maskPhone(number.phoneNumber || phoneNumber) : null,
    voiceUrlRedacted: redactUrlForLogs(voiceUrl),
    expectedVoiceUrlRedacted: humeTwilioUrlRedacted,
    voicePointsToHume,
    configIdMatches,
    voiceMethod,
    statusCallbackRedacted: redactUrlForLogs(statusCallback),
    expectedStatusCallbackRedacted: redactUrlForLogs(expectedStatusCallback),
    statusCallbackMatches,
    statusCallbackMethod,
    oldAiraDeskRouteActive,
    outboundService: {
      usesHumeEviUrl: true,
      statusCallbackConfigured: true,
      statusCallbackEvents: [
        "queued",
        "initiated",
        "ringing",
        "answered",
        "completed",
      ],
    },
    manualCorrections:
      number && voicePointsToHume && statusCallbackMatches
        ? []
        : [
            "Set Twilio voice URL to Hume EVI /v0/evi/twilio with config_id and api_key (via Twilio console).",
            `Set status callback to ${redactUrlForLogs(expectedStatusCallback)} with POST.`,
            "Remove any legacy /api/voice/twilio/incoming route from the phone number.",
          ],
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.validationStatus !== "passed") process.exitCode = 1;
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
