import { Router } from "express";
import {
  getCallById,
  getCallConversationById,
  getCallConversations,
  getCallRecordings,
  markCallConversationHumanRequired,
  markCallConversationResolved,
  updateCallTranscript,
} from "../controllers/call.controller";
import {
  handleStartAiOutboundCall,
  handleTwilioRecordingMedia,
} from "../controllers/voice.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getCallConversations);
router.get("/recordings", authMiddleware, getCallRecordings);

router.post("/outbound-ai", authMiddleware, handleStartAiOutboundCall);

router.get("/:callId/recording/media", authMiddleware, handleTwilioRecordingMedia);

router.get("/calls/:id", authMiddleware, getCallById);
router.patch("/calls/:id/transcript", authMiddleware, updateCallTranscript);

router.get("/:id", authMiddleware, getCallConversationById);
router.post("/:id/human-required", authMiddleware, markCallConversationHumanRequired);
router.post("/:id/resolve", authMiddleware, markCallConversationResolved);

export default router;