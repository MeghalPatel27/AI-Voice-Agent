import { prisma } from "../db/prisma";

export function normalizePhoneToE164(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const normalized = `${hasPlus ? "+" : "+"}${digits}`;
  if (!/^\+\d{8,15}$/.test(normalized)) return null;
  return normalized;
}

export function redactPhone(value?: string | null) {
  const normalized = normalizePhoneToE164(value);
  if (!normalized) return "***";
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}

export async function resolveInboundCompanyByCalledNumber(input: {
  calledNumber?: string | null;
}) {
  const normalizedCalledNumber = normalizePhoneToE164(input.calledNumber);
  if (!normalizedCalledNumber) {
    throw new Error("invalid_called_number");
  }

  const endpoints = await prisma.channelEndpoint.findMany({
    where: {
      provider: "TWILIO",
      channel: "VOICE",
      routingKey: normalizedCalledNumber,
      status: "ACTIVE",
    },
    include: {
      company: {
        select: { id: true, name: true },
      },
    },
    take: 2,
  });

  if (endpoints.length === 0) {
    throw new Error("inbound_endpoint_not_found");
  }
  if (endpoints.length > 1) {
    throw new Error("inbound_endpoint_multiple_matches");
  }

  const endpoint = endpoints[0];
  if (!endpoint?.company?.id) {
    throw new Error("inbound_endpoint_company_missing");
  }

  return {
    endpointId: endpoint.id,
    company: endpoint.company,
    normalizedCalledNumber,
  };
}
