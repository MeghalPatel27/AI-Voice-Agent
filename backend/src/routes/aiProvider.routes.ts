import { Router } from "express";
import {
  createRealtimeClientSecret,
  generateAiReply,
  getAiProviderStatus,
} from "../controllers/aiProvider.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/status", authMiddleware, getAiProviderStatus);
router.post("/reply", authMiddleware, generateAiReply);
router.post("/realtime/client-secret", authMiddleware, createRealtimeClientSecret);

export default router;