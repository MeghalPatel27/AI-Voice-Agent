import { Router } from "express";
import {
  createConversationBooking,
  createConversationTask,
  createWhatsAppConversation,
  getConversationDetail,
  getInbox,
  runConversationAction,
  sendHumanMessage,
  updateConversation,
} from "../controllers/conversation.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { deleteConversation } from "../controllers/conversationDelete.controller";

const router = Router();

router.get("/inbox", authMiddleware, getInbox);
router.post("/whatsapp", authMiddleware, createWhatsAppConversation);

router.get("/:id", authMiddleware, getConversationDetail);

router.patch("/:id", authMiddleware, updateConversation);
router.post("/:id/messages", authMiddleware, sendHumanMessage);
router.post("/:id/actions", authMiddleware, runConversationAction);
router.post("/:id/tasks", authMiddleware, createConversationTask);
router.post("/:id/bookings", authMiddleware, createConversationBooking);
router.delete("/:id", authMiddleware, deleteConversation);

export default router;