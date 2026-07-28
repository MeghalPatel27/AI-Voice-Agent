import "dotenv/config";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import conversationRoutes from "./routes/conversation.routes";
import customerRoutes from "./routes/customer.routes";
import handoverRoutes from "./routes/handover.routes";
import pipelineRoutes from "./routes/pipeline.routes";
import taskRoutes from "./routes/task.routes";
import analyticsRoutes from "./routes/analytics.routes";
import settingsRoutes from "./routes/settings.routes";
import integrationRoutes from "./routes/integration.routes";
import whatsappIntegrationRoutes from "./routes/whatsappIntegration.routes";
import agentRoutes from "./routes/agent.routes";
import bookingRoutes from "./routes/booking.routes";
import outboundRoutes from "./routes/outbound.routes";
import callRoutes from "./routes/call.routes";
import knowledgeRoutes from "./routes/knowledge.routes";
import webhookRoutes from "./routes/webhook.routes";
import { startOutboxWorker, stopOutboxWorker } from "./services/outboxWorker.service";
import {
  startPostCallAnalysisWorker,
  stopPostCallAnalysisWorker,
} from "./services/postCallAnalysisWorker.service";
import teamRoutes from "./routes/team.routes";
import voiceRoutes from "./routes/voice.routes";
import reportsRoutes from "./routes/reports.routes";
import aiCeoRoutes from "./routes/aiCeo.routes";
import aiProviderRoutes from "./routes/aiProvider.routes";
import humeWebhookRoutes from "./routes/humeWebhook.routes";
import {
  startHumeSyncWorker,
  stopHumeSyncWorker,
} from "./integrations/hume/humeSyncWorker.service";
import { assertHumeToolRuntimeConfig } from "./integrations/hume/humeToolRuntime.config";

assertHumeToolRuntimeConfig();

const app = express();

const PORT = process.env.PORT || 5000;

app.set("trust proxy", true);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

app.use(
  "/api/webhooks/hume",
  express.raw({
    type: "application/json",
    verify: (req, _res, buf) => {
      (req as any).rawBody = Buffer.from(buf);
    },
  }),
  (req, _res, next) => {
    try {
      if (Buffer.isBuffer(req.body)) {
        req.body = JSON.parse(req.body.toString("utf8"));
      }
    } catch {
      req.body = {};
    }
    next();
  },
  humeWebhookRoutes
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({
    message: "AiraDesk backend is running",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "airadesk-backend",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use("/api/conversations", conversationRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/handover", handoverRoutes);
app.use("/api/pipeline", pipelineRoutes);

app.use("/api/tasks", taskRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/reports", reportsRoutes);

app.use("/api/integrations", integrationRoutes);
app.use("/api/whatsapp-integration", whatsappIntegrationRoutes);

app.use("/api/agents", agentRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/outbound", outboundRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/knowledge", knowledgeRoutes);

app.use("/api/webhooks", webhookRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/ai-ceo", aiCeoRoutes);
app.use("/api/ai-provider", aiProviderRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    path: req.originalUrl,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startOutboxWorker();
  startPostCallAnalysisWorker();
  startHumeSyncWorker();
});

function shutdownWorkers(signal: string) {
  console.log(`Received ${signal}, stopping background workers`);
  stopOutboxWorker();
  stopPostCallAnalysisWorker();
  stopHumeSyncWorker();
}

process.once("SIGINT", () => shutdownWorkers("SIGINT"));
process.once("SIGTERM", () => shutdownWorkers("SIGTERM"));