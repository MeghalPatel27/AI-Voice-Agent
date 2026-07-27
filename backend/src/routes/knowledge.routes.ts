import { Router } from "express";
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  getKnowledgeItems,
  updateKnowledgeItem,
} from "../controllers/knowledge.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getKnowledgeItems);
router.post("/", authMiddleware, createKnowledgeItem);
router.patch("/:id", authMiddleware, updateKnowledgeItem);
router.delete("/:id", authMiddleware, deleteKnowledgeItem);

export default router;