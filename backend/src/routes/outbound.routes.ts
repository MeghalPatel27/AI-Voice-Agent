import { Router } from "express";
import {
  getOutboundMessages,
  getPendingOutboundMessages,
  sendPendingOutboundMessages,
  sendSingleOutboundMessage,
  updateOutboundMessage,
} from "../controllers/outbound.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getOutboundMessages);
router.get("/pending", authMiddleware, getPendingOutboundMessages);
router.post("/send-pending", authMiddleware, sendPendingOutboundMessages);
router.post("/:id/send", authMiddleware, sendSingleOutboundMessage);
router.patch("/:id", authMiddleware, updateOutboundMessage);

export default router;