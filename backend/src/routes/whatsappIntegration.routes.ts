import { Router } from "express";
import {
  getWhatsAppIntegration,
  testWhatsAppIntegrationSend,
  updateWhatsAppIntegration,
} from "../controllers/whatsappIntegration.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getWhatsAppIntegration);
router.patch("/", authMiddleware, updateWhatsAppIntegration);
router.post("/test-send", authMiddleware, testWhatsAppIntegrationSend);

export default router;