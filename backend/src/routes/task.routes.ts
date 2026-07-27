import { Router } from "express";
import {
  createTask,
  deleteTask,
  getTaskOperations,
  runTaskAction,
  scheduleAiCallTask,
  updateTask,
} from "../controllers/task.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/operations", authMiddleware, getTaskOperations);
router.post("/", authMiddleware, createTask);
router.post("/ai-call", authMiddleware, scheduleAiCallTask);
router.patch("/:id", authMiddleware, updateTask);
router.delete("/:id", authMiddleware, deleteTask);
router.post("/:id/actions", authMiddleware, runTaskAction);

export default router;