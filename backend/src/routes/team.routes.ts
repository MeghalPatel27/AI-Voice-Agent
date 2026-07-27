import { Router } from "express";
import {
  deactivateTeamMember,
  getTeamOverview,
  inviteTeamMember,
  reactivateTeamMember,
  updateTeamMember,
} from "../controllers/team.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/overview", authMiddleware, getTeamOverview);
router.post("/invite", authMiddleware, inviteTeamMember);
router.patch("/members/:id", authMiddleware, updateTeamMember);
router.post("/members/:id/deactivate", authMiddleware, deactivateTeamMember);
router.post("/members/:id/reactivate", authMiddleware, reactivateTeamMember);

export default router;