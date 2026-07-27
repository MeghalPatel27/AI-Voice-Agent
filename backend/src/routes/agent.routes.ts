import { Router } from "express";
import { createAgent, getAgents, updateAgent } from "../controllers/agent.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getAgents);
router.post("/", authMiddleware, createAgent);
router.patch("/:id", authMiddleware, updateAgent);

export default router;