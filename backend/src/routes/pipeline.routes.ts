import { Router } from "express";
import {
  getPipeline,
  updatePipelineConversation,
} from "../controllers/pipeline.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getPipeline);
router.patch("/:id", authMiddleware, updatePipelineConversation);

export default router;