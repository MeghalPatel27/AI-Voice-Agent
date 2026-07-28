import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { getHumeChatStatus } from "../src/integrations/hume/hume.client";
import { deliverStoredToolResult } from "../src/integrations/hume/humeToolDispatcher.service";
import { getHumeToolRuntimeConfig } from "../src/integrations/hume/humeToolRuntime.config";
import type { HumeToolControlPlaneMessage } from "../src/integrations/hume/hume.client";

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const runtime = getHumeToolRuntimeConfig();

  const candidates = await prisma.humeToolCallReceipt.findMany({
    where: {
      responseRequired: true,
      businessStatus: { in: ["COMPLETED", "FAILED"] },
      deliveryStatus: { in: ["PENDING", "SENDING", "FAILED"] },
      deliveryAttempts: { lt: runtime.toolDeliveryMaxAttempts },
      responsePayload: { not: null as any },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const reportRows: Array<Record<string, unknown>> = [];

  for (const receipt of candidates) {
    let terminal = false;
    try {
      const status = await getHumeChatStatus(receipt.chatId);
      terminal = status.terminal;
    } catch {
      terminal = false;
    }

    const row: Record<string, unknown> = {
      toolCallId: redactId(receipt.toolCallId),
      chatId: redactId(receipt.chatId),
      callId: redactId(receipt.callId),
      toolName: receipt.toolName,
      businessStatus: receipt.businessStatus,
      deliveryStatus: receipt.deliveryStatus,
      deliveryAttempts: receipt.deliveryAttempts,
      chatTerminal: terminal,
      action: terminal
        ? "skip_terminal"
        : receipt.deliveryStatus === "FAILED" &&
            receipt.deliveryAttempts >= runtime.toolDeliveryMaxAttempts
          ? "skip_max_attempts"
          : apply
            ? "resend"
            : "would_resend",
    };

    if (!apply || row.action !== "resend") {
      reportRows.push(row);
      continue;
    }

    const payload = receipt.responsePayload as HumeToolControlPlaneMessage;
    const result = await deliverStoredToolResult({
      toolCallId: receipt.toolCallId,
      chatId: receipt.chatId,
      payload: {
        type: payload.type,
        tool_call_id: receipt.toolCallId,
        content: payload.content,
      },
      allowRetry: true,
    });
    row.result = result;
    reportRows.push(row);
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        examined: candidates.length,
        unresolvedAfter: reportRows.filter(
          (row) => row.action === "would_resend" || row.action === "resend",
        ).length,
        rows: reportRows,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
