import { Router } from "express";
import {
  getIntegrationSecret,
  rotateIntegrationSecret,
} from "../controllers/integration.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/secret", authMiddleware, getIntegrationSecret);
router.post("/secret/rotate", authMiddleware, rotateIntegrationSecret);

export default router;