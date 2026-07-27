import { Router } from "express";
import {
  callInbound,
  getPendingOutboundForProvider,
  metaWhatsAppInbound,
  metaWhatsAppVerify,
  updateOutboundFromProvider,
  whatsappInbound,
} from "../controllers/webhook.controller";

const router = Router();

router.get("/meta/whatsapp", metaWhatsAppVerify);
router.post("/meta/whatsapp", metaWhatsAppInbound);

router.post("/whatsapp/inbound", whatsappInbound);
router.post("/calls/inbound", callInbound);

router.get("/outbound/pending", getPendingOutboundForProvider);
router.patch("/outbound/:id", updateOutboundFromProvider);

export default router;