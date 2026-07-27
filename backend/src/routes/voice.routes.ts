import { Router } from "express";
import {
  handleStartAiOutboundCall,
  handleTwilioFallback,
  handleTwilioIncomingCall,
  handleTwilioIncomingRealtimeCall,
  handleTwilioOutboundAnswer,
  handleTwilioRealtimeConnection,
  handleTwilioRecordingMedia,
  handleTwilioRecordingStatus,
  handleTwilioRepeat,
  handleTwilioSpeech,
  handleTwilioStatus,
} from "../controllers/voice.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post("/twilio/incoming", handleTwilioIncomingRealtimeCall);
router.post("/twilio/incoming-legacy", handleTwilioIncomingCall);

router.post("/twilio/outbound-ai", authMiddleware, handleStartAiOutboundCall);
router.post("/twilio/outbound-answer", handleTwilioOutboundAnswer);

router.post("/twilio/speech", handleTwilioSpeech);
router.post("/twilio/repeat", handleTwilioRepeat);
router.post("/twilio/fallback", handleTwilioFallback);
router.post("/twilio/status", handleTwilioStatus);
router.post("/twilio/recording", handleTwilioRecordingStatus);

router.get(
  "/twilio/recording/:callId/media",
  authMiddleware,
  handleTwilioRecordingMedia
);

export { handleTwilioRealtimeConnection };
export default router;