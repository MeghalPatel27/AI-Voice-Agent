import { Router } from "express";
import { askAiCeo } from "../controllers/aiCeo.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post("/chat", authMiddleware, askAiCeo);

export default router;