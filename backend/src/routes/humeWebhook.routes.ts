import { Router } from "express";
import { handleHumeEviWebhook } from "../controllers/humeWebhook.controller";

const router = Router();

router.post("/evi", handleHumeEviWebhook);

export default router;
