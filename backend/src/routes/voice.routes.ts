import { Router } from "express";
import {
  handleStartAiOutboundCall,
  handleTwilioFallback,
  handleTwilioIncomingCall,
  handleTwilioIncomingRealtimeCall,
  handleTwilioOutboundAnswer,
  handleTwilioRecordingMedia,
  handleTwilioRecordingStatus,
  handleTwilioRepeat,
  handleTwilioSpeech,
  handleTwilioStatus,
} from "../controllers/voiceHume.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { createTwilioWebhookMiddleware } from "../integrations/twilio/twilioWebhookValidation.service";

const router = Router();
const twilioWebhook = createTwilioWebhookMiddleware();

router.post("/twilio/incoming", twilioWebhook, handleTwilioIncomingRealtimeCall);
router.post("/twilio/incoming-legacy", twilioWebhook, handleTwilioIncomingCall);

router.post("/twilio/outbound-ai", authMiddleware, handleStartAiOutboundCall);
router.post("/twilio/outbound-answer", twilioWebhook, handleTwilioOutboundAnswer);

router.post("/twilio/speech", twilioWebhook, handleTwilioSpeech);
router.post("/twilio/repeat", twilioWebhook, handleTwilioRepeat);
router.post("/twilio/fallback", twilioWebhook, handleTwilioFallback);
router.post("/twilio/status", twilioWebhook, handleTwilioStatus);
router.post("/twilio/recording", twilioWebhook, handleTwilioRecordingStatus);

router.get(
  "/twilio/recording/:callId/media",
  authMiddleware,
  handleTwilioRecordingMedia
);

export default router;