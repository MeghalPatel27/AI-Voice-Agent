import { Router } from "express";
import { getReportsOverview } from "../controllers/reports.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/overview", authMiddleware, getReportsOverview);

export default router;