import "dotenv/config";
import { prisma } from "../src/db/prisma";
import {
  normalizePhoneToE164,
  redactPhone,
} from "../src/services/inboundVoiceRouting.service";

type Args = {
  apply: boolean;
  companyId: string;
  phoneNumber: string;
  provider: "TWILIO";
  channel: "VOICE";
};

function parseArgs(argv: string[]): Args {
  let companyId = "";
  let phoneNumber = "";
  let provider = "TWILIO";
  let channel = "VOICE";
  const apply = argv.includes("--apply");

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--company-id") {
      companyId = String(argv[i + 1] || "");
      i += 1;
    } else if (arg === "--phone-number") {
      phoneNumber = String(argv[i + 1] || "");
      i += 1;
    } else if (arg === "--provider") {
      provider = String(argv[i + 1] || provider).toUpperCase();
      i += 1;
    } else if (arg === "--channel") {
      channel = String(argv[i + 1] || channel).toUpperCase();
      i += 1;
    }
  }

  return {
    apply,
    companyId,
    phoneNumber,
    provider: provider as "TWILIO",
    channel: channel as "VOICE",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeMajor = Number(process.versions.node.split(".")[0] || 0);
  if (nodeMajor !== 24) {
    throw new Error("node_24_required");
  }
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
    throw new Error("development_environment_required");
  }
  if (!args.companyId) throw new Error("company_id_required");
  if (args.provider !== "TWILIO") throw new Error("unsupported_provider");
  if (args.channel !== "VOICE") throw new Error("unsupported_channel");

  const normalized = normalizePhoneToE164(args.phoneNumber);
  if (!normalized) throw new Error("invalid_phone_number");

  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { id: true, name: true },
  });
  if (!company) throw new Error("company_not_found");

  const existing = await prisma.channelEndpoint.findUnique({
    where: {
      provider_routingKey: {
        provider: "TWILIO",
        routingKey: normalized,
      },
    },
  });

  const proposed = {
    companyId: company.id,
    companyName: company.name,
    provider: "TWILIO",
    channel: "VOICE",
    routingKeyRedacted: redactPhone(normalized),
    status: "ACTIVE",
  };

  if (!existing) {
    if (!args.apply) {
      console.log(
        JSON.stringify(
          { dryRun: true, action: "create", proposed, writePerformed: false },
          null,
          2,
        ),
      );
      return;
    }
    const created = await prisma.channelEndpoint.create({
      data: {
        companyId: company.id,
        provider: "TWILIO",
        channel: "VOICE",
        routingKey: normalized,
        status: "ACTIVE",
      },
    });
    console.log(
      JSON.stringify(
        {
          dryRun: false,
          action: "created",
          endpointId: created.id,
          proposed,
          writePerformed: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (existing.companyId !== company.id) {
    throw new Error("endpoint_belongs_to_another_company");
  }

  const needsUpdate =
    existing.status !== "ACTIVE" ||
    existing.provider !== "TWILIO" ||
    existing.channel !== "VOICE";

  if (!needsUpdate) {
    console.log(
      JSON.stringify(
        {
          dryRun: !args.apply,
          action: "noop",
          reason: "existing_endpoint_matches",
          endpointId: existing.id,
          proposed,
          writePerformed: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          action: "update",
          endpointId: existing.id,
          proposed,
          writePerformed: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  await prisma.channelEndpoint.update({
    where: { id: existing.id },
    data: { status: "ACTIVE", provider: "TWILIO", channel: "VOICE" },
  });

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        action: "updated",
        endpointId: existing.id,
        proposed,
        writePerformed: true,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          scope: "voice_register_inbound_endpoint",
          event: "failed",
          error: error instanceof Error ? error.message : "unknown_error",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
