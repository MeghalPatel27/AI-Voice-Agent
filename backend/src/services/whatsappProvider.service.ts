export type WhatsAppSendStatus = "SENT" | "FAILED" | "SKIPPED";

export type WhatsAppSendResult = {
  ok: boolean;
  status: WhatsAppSendStatus;
  provider: "whatsapp_cloud" | "mock";
  providerMessageId?: string | null;
  errorMessage?: string | null;
  raw?: any;
};

type SendWhatsAppTextInput = {
  to: string;
  body: string;
  providerMode?: string | null;
  accessToken?: string | null;
  phoneNumberId?: string | null;
  graphApiVersion?: string | null;
};

function normalizeGraphApiVersion(value?: string | null) {
  const version = String(value || "v20.0").trim();
  return version.startsWith("v") ? version : `v${version}`;
}

function normalizeWhatsAppRecipient(value: string) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function cleanBody(value: string) {
  return String(value || "").replace(/\s+$/g, "").trim();
}

export function isWhatsAppCloudConfigured(input: {
  providerMode?: string | null;
  accessToken?: string | null;
  phoneNumberId?: string | null;
}) {
  return Boolean(
    String(input.providerMode || "").toLowerCase() === "cloud" &&
      String(input.accessToken || "").trim() &&
      String(input.phoneNumberId || "").trim()
  );
}

export async function sendWhatsAppTextMessage(
  input: SendWhatsAppTextInput
): Promise<WhatsAppSendResult> {
  const providerMode = String(input.providerMode || "mock").toLowerCase();
  const accessToken = String(input.accessToken || "").trim();
  const phoneNumberId = String(input.phoneNumberId || "").trim();
  const graphApiVersion = normalizeGraphApiVersion(input.graphApiVersion);
  const to = normalizeWhatsAppRecipient(input.to);
  const body = cleanBody(input.body);

  if (providerMode !== "cloud") {
    return {
      ok: false,
      status: "SKIPPED",
      provider: "mock",
      errorMessage:
        "WhatsApp is not in Cloud API live mode. Go to Settings > Channels > WhatsApp and connect Meta Cloud API.",
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      status: "FAILED",
      provider: "whatsapp_cloud",
      errorMessage: "WhatsApp access token is missing.",
    };
  }

  if (!phoneNumberId) {
    return {
      ok: false,
      status: "FAILED",
      provider: "whatsapp_cloud",
      errorMessage: "WhatsApp phone number ID is missing.",
    };
  }

  if (!to) {
    return {
      ok: false,
      status: "FAILED",
      provider: "whatsapp_cloud",
      errorMessage: "Customer WhatsApp number is invalid.",
    };
  }

  if (!body) {
    return {
      ok: false,
      status: "FAILED",
      provider: "whatsapp_cloud",
      errorMessage: "WhatsApp message body is empty.",
    };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(
        graphApiVersion
      )}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: {
            preview_url: false,
            body,
          },
        }),
      }
    );

    const json: any = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage =
        json?.error?.error_data?.details ||
        json?.error?.message ||
        `Meta WhatsApp API failed with ${response.status}`;

      return {
        ok: false,
        status: "FAILED",
        provider: "whatsapp_cloud",
        errorMessage,
        raw: json,
      };
    }

    const providerMessageId =
      Array.isArray(json?.messages) && json.messages[0]?.id
        ? String(json.messages[0].id)
        : null;

    return {
      ok: true,
      status: "SENT",
      provider: "whatsapp_cloud",
      providerMessageId,
      raw: json,
    };
  } catch (error) {
    return {
      ok: false,
      status: "FAILED",
      provider: "whatsapp_cloud",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}