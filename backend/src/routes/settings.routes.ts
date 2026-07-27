import { Router } from "express";
import {
  createCrmStage,
  createHandoffRule,
  createKnowledgeItem,
  createNotificationRule,
  deleteCrmStage,
  deleteHandoffRule,
  deleteKnowledgeItem,
  deleteNotificationRule,
  getSettingsControlRoom,
  resetTeamPassword,
  testChannel,
  testKnowledgeAnswer,
  updateAiBehavior,
  updateChannelSettings,
  updateCompanySettings,
  updateCrmStage,
  updateHandoffRule,
  updateKnowledgeItem,
  updateNotificationRule,
  updateSecuritySettings,
  updateTaskWorkflowSettings,
  updateTeamSettings,
} from "../controllers/settings.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/control-room", authMiddleware, getSettingsControlRoom);

router.patch("/company", authMiddleware, updateCompanySettings);
router.patch("/ai-behavior", authMiddleware, updateAiBehavior);

router.patch("/channels/:channel", authMiddleware, updateChannelSettings);
router.post("/channels/:channel/test", authMiddleware, testChannel);

router.post("/knowledge", authMiddleware, createKnowledgeItem);
router.patch("/knowledge/:id", authMiddleware, updateKnowledgeItem);
router.delete("/knowledge/:id", authMiddleware, deleteKnowledgeItem);
router.post("/knowledge/test-answer", authMiddleware, testKnowledgeAnswer);

router.post("/crm-stages", authMiddleware, createCrmStage);
router.patch("/crm-stages/:id", authMiddleware, updateCrmStage);
router.delete("/crm-stages/:id", authMiddleware, deleteCrmStage);

router.post("/handoff-rules", authMiddleware, createHandoffRule);
router.patch("/handoff-rules/:id", authMiddleware, updateHandoffRule);
router.delete("/handoff-rules/:id", authMiddleware, deleteHandoffRule);

router.post("/notification-rules", authMiddleware, createNotificationRule);
router.patch("/notification-rules/:id", authMiddleware, updateNotificationRule);
router.delete("/notification-rules/:id", authMiddleware, deleteNotificationRule);

router.patch("/team/:id", authMiddleware, updateTeamSettings);
router.post("/team/:id/reset-password", authMiddleware, resetTeamPassword);

router.patch("/task-workflow", authMiddleware, updateTaskWorkflowSettings);
router.patch("/security", authMiddleware, updateSecuritySettings);

export default router;