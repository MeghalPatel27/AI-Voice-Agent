import { Router } from "express";
import {
  createLead,
  createLeadBooking,
  createLeadTask,
  getLeadDetail,
  getLeads,
  runLeadAction,
  updateLead,
} from "../controllers/customer.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/leads", authMiddleware, getLeads);
router.post("/leads", authMiddleware, createLead);

router.get("/:id/lead", authMiddleware, getLeadDetail);
router.patch("/:id/lead", authMiddleware, updateLead);

router.post("/:id/lead/actions", authMiddleware, runLeadAction);
router.post("/:id/lead/tasks", authMiddleware, createLeadTask);
router.post("/:id/lead/bookings", authMiddleware, createLeadBooking);

export default router;