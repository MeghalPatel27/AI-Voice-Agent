import { Router } from "express";
import {
  createBooking,
  getBookingById,
  getBookings,
  updateBooking,
} from "../controllers/booking.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, getBookings);
router.get("/:id", authMiddleware, getBookingById);
router.post("/", authMiddleware, createBooking);
router.patch("/:id", authMiddleware, updateBooking);

export default router;