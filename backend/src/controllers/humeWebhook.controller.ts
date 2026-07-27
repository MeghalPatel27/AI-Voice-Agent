import { Request, Response } from "express";
import { verifyHumeWebhookSignature } from "../integrations/hume/hume.config";
import { processHumeWebhook } from "../integrations/hume/humeWebhook.service";
import type { HumeWebhookPayload } from "../integrations/hume/hume.types";

export async function handleHumeEviWebhook(req: Request, res: Response) {
  try {
    const signature = String(req.header("X-Hume-AI-Webhook-Signature") || "");
    const timestamp = String(req.header("X-Hume-AI-Webhook-Timestamp") || "");
    if (!signature || !timestamp) {
      return res.status(401).json({ message: "Missing signature headers" });
    }
    const rawBody = Buffer.isBuffer((req as any).rawBody)
      ? ((req as any).rawBody as Buffer)
      : Buffer.from(JSON.stringify(req.body || {}));
    const verified = verifyHumeWebhookSignature({
      rawBody,
      timestampHeader: timestamp,
      signatureHeader: signature,
    });
    if (!verified.ok) {
      return res.status(401).json({ message: `Invalid webhook signature: ${verified.reason}` });
    }
    const payload = req.body as HumeWebhookPayload;
    if (!payload?.event_name || !payload?.chat_id) {
      return res.status(400).json({ message: "Malformed webhook payload" });
    }
    if (!["chat_started", "chat_ended", "tool_call"].includes(payload.event_name)) {
      return res.status(400).json({ message: "Unsupported webhook event" });
    }
    await processHumeWebhook(payload);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to process Hume webhook",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
