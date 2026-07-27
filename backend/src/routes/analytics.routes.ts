import { Router } from "express";
import { getAnalyticsOverview } from "../controllers/analytics.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/overview", authMiddleware, getAnalyticsOverview);

export default router;