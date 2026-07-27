import { Router } from "express";
import {
  addHumanNote,
  getHandoverQueue,
  updateHandoverConversation,
} from "../controllers/handover.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getHandoverQueue);
router.patch("/:id", authMiddleware, updateHandoverConversation);
router.post("/:id/notes", authMiddleware, addHumanNote);

export default router;