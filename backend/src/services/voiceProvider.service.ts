type PlaceVoiceCallInput = {
  to: string;
  reason?: string | null;
  customerName?: string | null;
  companyName?: string | null;

  providerMode?: string | null;
  providerName?: string | null;
  apiKey?: string | null;
  agentId?: string | null;
  fromNumber?: string | null;
  transferNumber?: string | null;
};

type PlaceVoiceCallResult = {
  provider: string;
  providerCallId: string;
  status: "LIVE" | "FAILED";
  raw?: unknown;
};

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function createMockProviderCallId() {
  return `mock_voice_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function placeVoiceCall(
  input: PlaceVoiceCallInput
): Promise<PlaceVoiceCallResult> {
  const providerMode = input.providerMode || "mock";
  const providerName = input.providerName || "mock";

  const to = normalizePhone(input.to);

  if (!to) {
    throw new Error("Customer phone number is missing");
  }

  if (providerMode === "mock") {
    const providerCallId = createMockProviderCallId();

    console.log("[Voice Mock] Outbound call created", {
      providerCallId,
      to,
      customerName: input.customerName,
      companyName: input.companyName,
      reason: input.reason,
    });

    return {
      provider: "mock",
      providerCallId,
      status: "LIVE",
      raw: {
        mocked: true,
        to,
        reason: input.reason,
      },
    };
  }

  if (!input.apiKey) {
    throw new Error("Voice provider API key is missing");
  }

  if (!input.agentId) {
    throw new Error("Voice provider agent ID is missing");
  }

  if (!input.fromNumber) {
    throw new Error("Voice provider from number is missing");
  }

  throw new Error(
    `Real provider "${providerName}" is not connected yet. Keep voiceProviderMode as "mock" for now.`
  );
}