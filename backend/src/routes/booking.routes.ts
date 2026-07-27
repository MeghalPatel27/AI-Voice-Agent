import { Router } from "express";
import {
  acceptBooking,
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
router.post("/:id/accept", authMiddleware, acceptBooking);

export default router;