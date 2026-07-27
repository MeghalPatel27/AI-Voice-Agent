-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('AI_CALL', 'WHATSAPP', 'WEBSITE_CHAT');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'FOLLOW_UP', 'CONVERTED', 'HUMAN_REQUIRED', 'LOST');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('CUSTOMER', 'AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'IN_PROGRESS', 'LIVE', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED', 'MISSED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DOING', 'BLOCKED', 'DONE');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('LIVE', 'TESTING', 'PAUSED', 'NOT_CONNECTED');

-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('HOSPITAL', 'CLINIC', 'HOTEL', 'RESTAURANT', 'REAL_ESTATE', 'OTHER');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CallPostAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "TelephonyProvider" AS ENUM ('TWILIO');

-- CreateEnum
CREATE TYPE "VoiceAgentProvider" AS ENUM ('OPENAI_REALTIME', 'HUME_EVI', 'LEGACY_ELEVENLABS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProviderSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingReconstructionStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETE', 'ERROR', 'CANCELED', 'NOT_REQUESTED');

-- CreateEnum
CREATE TYPE "CallIntentLevel" AS ENUM ('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'NOT_INTERESTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'MEETING_REQUESTED', 'MEETING_BOOKED', 'QUOTATION_SENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "PreferredLanguage" AS ENUM ('AUTO', 'ENGLISH', 'HINDI', 'GUJARATI');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingAcceptanceStatus" AS ENUM ('PENDING_ACCEPTANCE', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "BookingOutcome" AS ENUM ('PENDING', 'WON', 'LOST', 'FOLLOW_UP');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" "Industry" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "businessType" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "timezone" TEXT DEFAULT 'Asia/Kolkata',
    "websiteUrl" TEXT,
    "brandTone" TEXT,
    "defaultLanguage" TEXT DEFAULT 'English',
    "supportedLanguages" JSONB,
    "businessHours" JSONB,
    "closedDays" JSONB,
    "mainWhatsappNumber" TEXT,
    "mainCallNumber" TEXT,
    "callForwardingNumber" TEXT,
    "emergencyEscalationNumber" TEXT,
    "whatsappNumber" TEXT,
    "escalationPhone" TEXT,
    "handoverRules" TEXT,
    "aiTone" TEXT,
    "webhookSecret" TEXT,
    "aiName" TEXT DEFAULT 'AI Assistant',
    "aiReplyMode" TEXT DEFAULT 'DRAFT_ONLY',
    "aiReplyLength" TEXT DEFAULT 'MEDIUM',
    "aiConfidenceThreshold" INTEGER NOT NULL DEFAULT 75,
    "aiAllowedActions" JSONB,
    "aiRestrictedActions" JSONB,
    "aiFallbackResponse" TEXT,
    "channelSettings" JSONB,
    "handoffSettings" JSONB,
    "notificationSettings" JSONB,
    "taskWorkflowSettings" JSONB,
    "securitySettings" JSONB,
    "billingSettings" JSONB,
    "whatsappProviderMode" TEXT DEFAULT 'mock',
    "whatsappPhoneNumberId" TEXT,
    "whatsappAccessToken" TEXT,
    "whatsappBusinessAccountId" TEXT,
    "whatsappGraphApiVersion" TEXT DEFAULT 'v20.0',
    "whatsappWebhookVerifyToken" TEXT,
    "voiceProviderMode" TEXT DEFAULT 'mock',
    "voiceProviderName" TEXT DEFAULT 'mock',
    "voiceApiKey" TEXT,
    "voiceAgentId" TEXT,
    "voiceFromNumber" TEXT,
    "voiceTransferNumber" TEXT,
    "voiceWebhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" "ConversationChannel",
    "status" "AgentStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "displayName" TEXT,
    "accountId" TEXT,
    "phoneNumber" TEXT,
    "webhookUrl" TEXT,
    "mode" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "department" TEXT,
    "jobTitle" TEXT,
    "workloadCapacity" INTEGER NOT NULL DEFAULT 8,
    "permissions" JSONB,
    "lastActiveAt" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "leadScore" INTEGER,
    "leadStage" "LeadStage",
    "requirementSummary" TEXT,
    "requirementDetails" JSONB,
    "preferredLanguage" "PreferredLanguage",
    "businessType" TEXT,
    "budget" TEXT,
    "timeline" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "intent" TEXT,
    "aiSummary" TEXT,
    "nextAction" TEXT,
    "aiConfidence" INTEGER NOT NULL DEFAULT 0,
    "humanNeeded" BOOLEAN NOT NULL DEFAULT false,
    "bookingCreated" BOOLEAN NOT NULL DEFAULT false,
    "assignedUserId" TEXT,
    "provider" TEXT,
    "providerThreadId" TEXT,
    "providerContactId" TEXT,
    "providerExternalId" TEXT,
    "lastMessage" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" "MessageSender" NOT NULL,
    "body" TEXT NOT NULL,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "transcript" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'COMPLETED',
    "provider" TEXT,
    "providerCallId" TEXT,
    "direction" TEXT DEFAULT 'INBOUND',
    "telephonyProvider" "TelephonyProvider" DEFAULT 'TWILIO',
    "voiceAgentProvider" "VoiceAgentProvider" DEFAULT 'UNKNOWN',
    "twilioCallSid" TEXT,
    "humeChatId" TEXT,
    "humeChatGroupId" TEXT,
    "humeConfigId" TEXT,
    "humeEndReason" TEXT,
    "transcriptSyncStatus" "ProviderSyncStatus" DEFAULT 'PENDING',
    "humeSyncStatus" "ProviderSyncStatus" DEFAULT 'PENDING',
    "recordingReconstructionStatus" "RecordingReconstructionStatus" DEFAULT 'NOT_REQUESTED',
    "expressionAnalysisStatus" "ProviderSyncStatus" DEFAULT 'PENDING',
    "providerMetadataVersion" TEXT,
    "recordingUrl" TEXT,
    "recordingSid" TEXT,
    "recordingStatus" TEXT,
    "recordingDurationSeconds" INTEGER,
    "recordingChannels" INTEGER,
    "recordingSource" TEXT,
    "recordingAvailableAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "assignedUserId" TEXT,
    "purpose" TEXT,
    "notes" TEXT,
    "nextAction" TEXT,
    "preferredLanguage" "PreferredLanguage",
    "preferredCallTime" TIMESTAMP(3),
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumeWebhookReceipt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "chatId" TEXT,
    "callId" TEXT,
    "companyId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumeWebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumeToolCallReceipt" (
    "id" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumeToolCallReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumeChatSyncJob" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "ProviderSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumeChatSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumeExpressionAnalysis" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "status" "ProviderSyncStatus" NOT NULL DEFAULT 'PENDING',
    "userTurnCount" INTEGER NOT NULL DEFAULT 0,
    "averageScores" JSONB,
    "topExpressions" JSONB,
    "expressionTimeline" JSONB,
    "insightSummary" TEXT,
    "rawSchemaVersion" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumeExpressionAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallPostAnalysis" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "status" "CallPostAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "intentLevel" "CallIntentLevel",
    "intentScore" INTEGER,
    "confidence" DOUBLE PRECISION,
    "requirementSummary" TEXT,
    "requirementDetails" JSONB,
    "evidenceSignals" JSONB,
    "promptVersion" TEXT,
    "modelName" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "truncatedTranscript" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallPostAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerId" TEXT,
    "assignedUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "aiNotes" TEXT,
    "blockedReason" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "language" TEXT,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "callId" TEXT,
    "title" TEXT NOT NULL,
    "dateTime" TIMESTAMP(3),
    "timezone" TEXT,
    "purpose" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "acceptanceStatus" "BookingAcceptanceStatus" NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    "outcome" "BookingOutcome" NOT NULL DEFAULT 'PENDING',
    "assignedUserId" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "notes" TEXT,
    "proposalSent" BOOLEAN NOT NULL DEFAULT false,
    "proposalSentAt" TIMESTAMP(3),
    "nextAction" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerId" TEXT,
    "channel" "ConversationChannel" NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutboundStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "requiredFields" JSONB,
    "automationRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "notificationChannel" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'HIGH',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoffRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "recipients" JSONB,
    "channels" JSONB,
    "quietHours" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_companyId_key" ON "CompanySettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_webhookSecret_key" ON "CompanySettings"("webhookSecret");

-- CreateIndex
CREATE INDEX "IntegrationConnection_companyId_idx" ON "IntegrationConnection"("companyId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_provider_idx" ON "IntegrationConnection"("provider");

-- CreateIndex
CREATE INDEX "IntegrationConnection_channel_idx" ON "IntegrationConnection"("channel");

-- CreateIndex
CREATE INDEX "IntegrationConnection_status_idx" ON "IntegrationConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_companyId_provider_key" ON "IntegrationConnection"("companyId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "Customer_companyId_idx" ON "Customer"("companyId");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_source_idx" ON "Customer"("source");

-- CreateIndex
CREATE INDEX "Customer_leadStage_idx" ON "Customer"("leadStage");

-- CreateIndex
CREATE INDEX "Customer_leadScore_idx" ON "Customer"("leadScore");

-- CreateIndex
CREATE INDEX "Customer_updatedAt_idx" ON "Customer"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_phone_key" ON "Customer"("companyId", "phone");

-- CreateIndex
CREATE INDEX "Conversation_companyId_idx" ON "Conversation"("companyId");

-- CreateIndex
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");

-- CreateIndex
CREATE INDEX "Conversation_assignedUserId_idx" ON "Conversation"("assignedUserId");

-- CreateIndex
CREATE INDEX "Conversation_channel_idx" ON "Conversation"("channel");

-- CreateIndex
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

-- CreateIndex
CREATE INDEX "Conversation_priority_idx" ON "Conversation"("priority");

-- CreateIndex
CREATE INDEX "Conversation_humanNeeded_idx" ON "Conversation"("humanNeeded");

-- CreateIndex
CREATE INDEX "Conversation_provider_idx" ON "Conversation"("provider");

-- CreateIndex
CREATE INDEX "Conversation_providerThreadId_idx" ON "Conversation"("providerThreadId");

-- CreateIndex
CREATE INDEX "Conversation_providerExternalId_idx" ON "Conversation"("providerExternalId");

-- CreateIndex
CREATE INDEX "Conversation_createdAt_idx" ON "Conversation"("createdAt");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_senderType_idx" ON "Message"("senderType");

-- CreateIndex
CREATE INDEX "Message_provider_idx" ON "Message"("provider");

-- CreateIndex
CREATE INDEX "Message_providerMessageId_idx" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_providerStatus_idx" ON "Message"("providerStatus");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_providerCallId_key" ON "Call"("providerCallId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_humeChatId_key" ON "Call"("humeChatId");

-- CreateIndex
CREATE INDEX "Call_conversationId_idx" ON "Call"("conversationId");

-- CreateIndex
CREATE INDEX "Call_assignedUserId_idx" ON "Call"("assignedUserId");

-- CreateIndex
CREATE INDEX "Call_phone_idx" ON "Call"("phone");

-- CreateIndex
CREATE INDEX "Call_status_idx" ON "Call"("status");

-- CreateIndex
CREATE INDEX "Call_provider_idx" ON "Call"("provider");

-- CreateIndex
CREATE INDEX "Call_providerCallId_idx" ON "Call"("providerCallId");

-- CreateIndex
CREATE INDEX "Call_twilioCallSid_idx" ON "Call"("twilioCallSid");

-- CreateIndex
CREATE INDEX "Call_humeChatId_idx" ON "Call"("humeChatId");

-- CreateIndex
CREATE INDEX "Call_humeChatGroupId_idx" ON "Call"("humeChatGroupId");

-- CreateIndex
CREATE INDEX "Call_telephonyProvider_idx" ON "Call"("telephonyProvider");

-- CreateIndex
CREATE INDEX "Call_voiceAgentProvider_idx" ON "Call"("voiceAgentProvider");

-- CreateIndex
CREATE INDEX "Call_recordingSid_idx" ON "Call"("recordingSid");

-- CreateIndex
CREATE INDEX "Call_createdAt_idx" ON "Call"("createdAt");

-- CreateIndex
CREATE INDEX "Call_updatedAt_idx" ON "Call"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HumeWebhookReceipt_idempotencyKey_key" ON "HumeWebhookReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "HumeWebhookReceipt_eventType_idx" ON "HumeWebhookReceipt"("eventType");

-- CreateIndex
CREATE INDEX "HumeWebhookReceipt_chatId_idx" ON "HumeWebhookReceipt"("chatId");

-- CreateIndex
CREATE INDEX "HumeWebhookReceipt_callId_idx" ON "HumeWebhookReceipt"("callId");

-- CreateIndex
CREATE INDEX "HumeWebhookReceipt_companyId_idx" ON "HumeWebhookReceipt"("companyId");

-- CreateIndex
CREATE INDEX "HumeWebhookReceipt_createdAt_idx" ON "HumeWebhookReceipt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HumeToolCallReceipt_toolCallId_key" ON "HumeToolCallReceipt"("toolCallId");

-- CreateIndex
CREATE INDEX "HumeToolCallReceipt_chatId_idx" ON "HumeToolCallReceipt"("chatId");

-- CreateIndex
CREATE INDEX "HumeToolCallReceipt_callId_idx" ON "HumeToolCallReceipt"("callId");

-- CreateIndex
CREATE INDEX "HumeToolCallReceipt_companyId_idx" ON "HumeToolCallReceipt"("companyId");

-- CreateIndex
CREATE INDEX "HumeToolCallReceipt_toolName_idx" ON "HumeToolCallReceipt"("toolName");

-- CreateIndex
CREATE INDEX "HumeChatSyncJob_status_nextAttemptAt_idx" ON "HumeChatSyncJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "HumeChatSyncJob_chatId_idx" ON "HumeChatSyncJob"("chatId");

-- CreateIndex
CREATE INDEX "HumeChatSyncJob_companyId_idx" ON "HumeChatSyncJob"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "HumeChatSyncJob_callId_chatId_key" ON "HumeChatSyncJob"("callId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "HumeExpressionAnalysis_callId_key" ON "HumeExpressionAnalysis"("callId");

-- CreateIndex
CREATE INDEX "HumeExpressionAnalysis_companyId_idx" ON "HumeExpressionAnalysis"("companyId");

-- CreateIndex
CREATE INDEX "HumeExpressionAnalysis_chatId_idx" ON "HumeExpressionAnalysis"("chatId");

-- CreateIndex
CREATE INDEX "HumeExpressionAnalysis_status_idx" ON "HumeExpressionAnalysis"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CallPostAnalysis_callId_key" ON "CallPostAnalysis"("callId");

-- CreateIndex
CREATE INDEX "CallPostAnalysis_companyId_idx" ON "CallPostAnalysis"("companyId");

-- CreateIndex
CREATE INDEX "CallPostAnalysis_status_nextAttemptAt_idx" ON "CallPostAnalysis"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CallPostAnalysis_status_processingStartedAt_idx" ON "CallPostAnalysis"("status", "processingStartedAt");

-- CreateIndex
CREATE INDEX "CallPostAnalysis_createdAt_idx" ON "CallPostAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");

-- CreateIndex
CREATE INDEX "Task_conversationId_idx" ON "Task"("conversationId");

-- CreateIndex
CREATE INDEX "Task_customerId_idx" ON "Task"("customerId");

-- CreateIndex
CREATE INDEX "Task_assignedUserId_idx" ON "Task"("assignedUserId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "Task"("priority");

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "AiAgent_companyId_idx" ON "AiAgent"("companyId");

-- CreateIndex
CREATE INDEX "AiAgent_channel_idx" ON "AiAgent"("channel");

-- CreateIndex
CREATE INDEX "AiAgent_status_idx" ON "AiAgent"("status");

-- CreateIndex
CREATE INDEX "Booking_companyId_idx" ON "Booking"("companyId");

-- CreateIndex
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");

-- CreateIndex
CREATE INDEX "Booking_conversationId_idx" ON "Booking"("conversationId");

-- CreateIndex
CREATE INDEX "Booking_callId_idx" ON "Booking"("callId");

-- CreateIndex
CREATE INDEX "Booking_assignedUserId_idx" ON "Booking"("assignedUserId");

-- CreateIndex
CREATE INDEX "Booking_acceptedByUserId_idx" ON "Booking"("acceptedByUserId");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_acceptanceStatus_idx" ON "Booking"("acceptanceStatus");

-- CreateIndex
CREATE INDEX "Booking_outcome_idx" ON "Booking"("outcome");

-- CreateIndex
CREATE INDEX "Booking_proposalSent_idx" ON "Booking"("proposalSent");

-- CreateIndex
CREATE INDEX "Booking_dateTime_idx" ON "Booking"("dateTime");

-- CreateIndex
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_idx" ON "OutboundMessage"("companyId");

-- CreateIndex
CREATE INDEX "OutboundMessage_conversationId_idx" ON "OutboundMessage"("conversationId");

-- CreateIndex
CREATE INDEX "OutboundMessage_customerId_idx" ON "OutboundMessage"("customerId");

-- CreateIndex
CREATE INDEX "OutboundMessage_channel_idx" ON "OutboundMessage"("channel");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_idx" ON "OutboundMessage"("status");

-- CreateIndex
CREATE INDEX "OutboundMessage_toPhone_idx" ON "OutboundMessage"("toPhone");

-- CreateIndex
CREATE INDEX "OutboundMessage_provider_idx" ON "OutboundMessage"("provider");

-- CreateIndex
CREATE INDEX "OutboundMessage_providerMessageId_idx" ON "OutboundMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "OutboundMessage_createdAt_idx" ON "OutboundMessage"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_companyId_idx" ON "KnowledgeItem"("companyId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_category_idx" ON "KnowledgeItem"("category");

-- CreateIndex
CREATE INDEX "KnowledgeItem_isActive_idx" ON "KnowledgeItem"("isActive");

-- CreateIndex
CREATE INDEX "KnowledgeItem_enabled_idx" ON "KnowledgeItem"("enabled");

-- CreateIndex
CREATE INDEX "CrmStage_companyId_idx" ON "CrmStage"("companyId");

-- CreateIndex
CREATE INDEX "CrmStage_isEnabled_idx" ON "CrmStage"("isEnabled");

-- CreateIndex
CREATE INDEX "CrmStage_order_idx" ON "CrmStage"("order");

-- CreateIndex
CREATE INDEX "HandoffRule_companyId_idx" ON "HandoffRule"("companyId");

-- CreateIndex
CREATE INDEX "HandoffRule_isEnabled_idx" ON "HandoffRule"("isEnabled");

-- CreateIndex
CREATE INDEX "HandoffRule_priority_idx" ON "HandoffRule"("priority");

-- CreateIndex
CREATE INDEX "NotificationRule_companyId_idx" ON "NotificationRule"("companyId");

-- CreateIndex
CREATE INDEX "NotificationRule_event_idx" ON "NotificationRule"("event");

-- CreateIndex
CREATE INDEX "NotificationRule_isEnabled_idx" ON "NotificationRule"("isEnabled");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumeToolCallReceipt" ADD CONSTRAINT "HumeToolCallReceipt_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumeChatSyncJob" ADD CONSTRAINT "HumeChatSyncJob_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumeExpressionAnalysis" ADD CONSTRAINT "HumeExpressionAnalysis_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallPostAnalysis" ADD CONSTRAINT "CallPostAnalysis_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallPostAnalysis" ADD CONSTRAINT "CallPostAnalysis_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffRule" ADD CONSTRAINT "HandoffRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
