import "dotenv/config";
import twilio from "twilio";

function env(name: string) {
  return String(process.env[name] || "").trim();
}

async function main() {
  const authToken = env("TWILIO_AUTH_TOKEN");
  const publicWebhookUrl = env("PUBLIC_WEBHOOK_URL");
  const targetPath = process.argv[2] || "/api/voice/twilio/status";

  if (!authToken || !publicWebhookUrl) {
    console.error("Missing TWILIO_AUTH_TOKEN or PUBLIC_WEBHOOK_URL");
    process.exitCode = 1;
    return;
  }

  const callbackUrl = `${publicWebhookUrl.replace(/\/$/, "")}${targetPath}`;
  const params = {
    CallSid: "CA00000000000000000000000000000001",
    CallStatus: "ringing",
    AccountSid: env("TWILIO_ACCOUNT_SID") || "AC00000000000000000000000000000001",
  };
  const signature = twilio.getExpectedTwilioSignature(authToken, callbackUrl, params);

  console.log(
    JSON.stringify(
      {
        method: "POST",
        path: targetPath,
        callbackUrlRedacted: callbackUrl.replace(/\/\/[^/]+/, "//***"),
        headers: {
          "X-Twilio-Signature": signature,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        form: params,
        note: "Use this synthetic request locally against your running backend. Do not use a real customer Call SID.",
      },
      null,
      2,
    ),
  );
}

void main();
