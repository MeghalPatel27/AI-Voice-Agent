import { Router } from "express";
import {
  generateAiReply,
  getAiProviderStatus,
} from "../controllers/aiProvider.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/status", authMiddleware, getAiProviderStatus);
router.post("/reply", authMiddleware, generateAiReply);

export default router;