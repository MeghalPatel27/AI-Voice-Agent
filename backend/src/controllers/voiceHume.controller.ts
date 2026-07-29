import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { applyTwilioStatusCallback } from "../integrations/twilio/twilioStatus.service";
import { startHumeOutboundCall } from "../integrations/twilio/twilioCall.service";
import { proxyTwilioRecordingForCall } from "../integrations/twilio/twilioLegacyRecording.service";
import { getHumeRecordingMediaForCall } from "../integrations/hume/humeRecording.service";

function getPublicUrl(req: AuthRequest) {
  const fromEnv = String(process.env.PUBLIC_WEBHOOK_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function sendXml(res: Response, xml: string) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(xml);
}

export async function handleStartAiOutboundCall(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const result = await startHumeOutboundCall({
      companyId: req.user.companyId,
      requestedBy: req.user.userId,
      fullName: String(req.body.fullName || req.body.name || "").trim() || undefined,
      phone: String(req.body.phone || req.body.toPhone || ""),
      purpose: String(req.body.purpose || "").trim() || undefined,
      notes: String(req.body.notes || "").trim() || undefined,
      preferredTime: String(req.body.preferredTime || "").trim() || undefined,
      preferredLanguage: String(req.body.preferredLanguage || "AUTO").trim().toUpperCase(),
      publicWebhookUrl: getPublicUrl(req),
    });
    return res.status(201).json({
      ok: true,
      callSid: result.callSid,
      call: result.call,
      customer: result.customer,
      conversation: result.conversation,
      status: result.status,
      message: "AI outbound call started via Hume EVI.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to start AI outbound call.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleTwilioStatus(req: AuthRequest, res: Response) {
  try {
    const callSid = String(req.body.CallSid || "");
    const callStatus = String(req.body.CallStatus || "").toLowerCase();
    const durationSeconds = Number(req.body.CallDuration || 0);
    if (callSid) {
      await applyTwilioStatusCallback({
        callSid,
        twilioStatus: callStatus,
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined,
        fromNumber: String(req.body.From || ""),
        toNumber: String(req.body.To || ""),
        direction: String(req.body.Direction || ""),
      });
    }
    return res.status(204).send();
  } catch (error) {
    console.error("Twilio status callback error:", error);
    return res.status(500).json({ message: "Failed to process Twilio status callback" });
  }
}

export async function handleTwilioRecordingMedia(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const callId = String(req.params.callId || "");
    const companyId = req.user.companyId;
    const humeMedia = await getHumeRecordingMediaForCall(callId, companyId).catch(() => null);
    if (humeMedia?.status === 200 && humeMedia.buffer && humeMedia.headers) {
      for (const [k, v] of Object.entries(humeMedia.headers)) res.setHeader(k, v);
      return res.status(200).send(humeMedia.buffer);
    }
    if (humeMedia && humeMedia.status !== 404) {
      return res.status(humeMedia.status).json(humeMedia.body);
    }
    const twilioMedia = await proxyTwilioRecordingForCall(callId, companyId);
    if (twilioMedia.status === 200 && twilioMedia.buffer && twilioMedia.headers) {
      for (const [k, v] of Object.entries(twilioMedia.headers)) res.setHeader(k, v);
      return res.status(200).send(twilioMedia.buffer);
    }
    return res.status(twilioMedia.status).json(twilioMedia.body);
  } catch (error) {
    return res.status(500).json({
      message: "Recording media failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Legacy endpoints kept for safe fallback while Twilio number points to Hume URL.
export async function handleTwilioIncomingCall(req: AuthRequest, res: Response) {
  return sendXml(res, "<Response><Hangup/></Response>");
}
export async function handleTwilioIncomingRealtimeCall(req: AuthRequest, res: Response) {
  return sendXml(res, "<Response><Hangup/></Response>");
}
export async function handleTwilioOutboundAnswer(req: AuthRequest, res: Response) {
  return sendXml(res, "<Response><Hangup/></Response>");
}
export async function handleTwilioSpeech(req: AuthRequest, res: Response) {
  return sendXml(res, "<Response><Hangup/></Response>");
}
export async function handleTwilioRepeat(req: AuthRequest, res: Response) {
  return sendXml(res, "<Response><Hangup/></Response>");
}
export async function handleTwilioFallback(req: AuthRequest, res: Response) {
  return sendXml(res, "<Response><Hangup/></Response>");
}
export async function handleTwilioRecordingStatus(req: AuthRequest, res: Response) {
  return res.status(204).send();
}
