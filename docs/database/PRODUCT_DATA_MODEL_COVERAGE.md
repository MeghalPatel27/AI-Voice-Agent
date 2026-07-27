# Product Data Model Coverage

- Audit timestamp: 2026-07-27
- Canonical schema source: `backend/prisma/schema.prisma`
- Baseline migration: `20260727120000_canonical_product_baseline`

## Coverage Matrix

| Product feature | Backend files | Frontend files | Prisma model/table | Required fields | Constraints/indexes | Tests | Coverage status |
|---|---|---|---|---|---|---|---|
| Authentication / companies | `auth.controller.ts`, `auth.middleware.ts` | `auth/AuthPage.tsx` | `Company`, `User` | name, email, password, role, companyId | `User.email` unique | `schema.integration.test.ts` | COMPLETE |
| Server-side sessions | JWT middleware only | n/a | n/a | JWT claims only | n/a | `schema.integration.test.ts` #2 | NOT_APPLICABLE |
| Employees / team membership | `team.controller.ts` | `settings.tsx` | `User` | companyId, role, isActive | company index | unit tests indirect | COMPLETE |
| Customers / leads | `customer.controller.ts` | `customers.tsx`, `pipeline.tsx` | `Customer` | phone, leadStage, leadScore, requirementSummary | `@@unique([companyId, phone])` | schema #3-5 | COMPLETE |
| Conversations / messages | `conversation.controller.ts` | `inbox.tsx`, `whatsapp.tsx` | `Conversation`, `Message` | channel, status, nextAction, senderType | conversation/customer indexes | schema #6 | COMPLETE |
| Conversation assignment | `conversation.controller.ts` | `inbox.tsx` | `Conversation.assignedUserId` | assigned employee | FK SetNull | schema indirect | COMPLETE |
| Voice calls | `call.controller.ts`, `voiceHume.controller.ts`, `twilioCall.service.ts` | `calls.tsx`, `inbox.tsx` | `Call` | direction, status, transcript, provider IDs | `providerCallId`, `humeChatId` unique | schema #7-10, `callFinalization.service.test.ts` | COMPLETE |
| Call summary | `call.controller.ts`, `conversation.controller.ts` | `calls.tsx`, `inbox.tsx` | `Conversation.aiSummary`, `Call.summary` | aiSummary | n/a | schema #31 | COMPLETE |
| Customer requirements | `postCallAnalysisWorker.service.ts`, `postCallAnalysisApi.service.ts` | `inbox.tsx`, `customers.tsx`, `lib/postCallAnalysis.ts` | `CallPostAnalysis`, `Customer.requirementSummary` | requirementSummary, requirementDetails | callId unique | `postCallAnalysis*.test.ts`, schema #15 | COMPLETE |
| Business intent | `postCallAnalysisWorker.service.ts` | `customers.tsx`, `inbox.tsx` | `CallPostAnalysis` | intentLevel, intentScore, evidenceSignals | status indexes | `postCallAnalysis*.test.ts` | COMPLETE |
| Hume expression analysis | `humeChatSync.service.ts`, `humeWebhook.service.ts` | `inbox.tsx`, `calls.tsx` | `HumeExpressionAnalysis` | topExpressions, expressionTimeline | callId unique | `humeSyncWorker.service.test.ts`, schema #13-14 | COMPLETE |
| Transcript | `call.controller.ts`, `humeChatSync.service.ts` | `calls.tsx`, `inbox.tsx` | `Call.transcript`, `Message` | transcript, sender role | n/a | schema #31 | COMPLETE |
| Recording (Twilio historical) | `twilioLegacyRecording.service.ts`, `call.controller.ts` | `calls.tsx`, `bookings.tsx` | `Call.recordingSid`, `recordingUrl`, `recordingSource` | recording metadata | recordingSid index | schema #29 | COMPLETE |
| Recording (Hume reconstruction) | `humeRecording.service.ts` | `calls.tsx` | `Call.recordingReconstructionStatus` | reconstruction state | n/a | schema #30 | COMPLETE |
| Meetings / bookings | `booking.controller.ts`, `humeTool.service.ts` | `bookings.tsx`, `inbox.tsx` | `Booking` | dateTime, status, callId, purpose | company/customer/call indexes | schema #17-26 | COMPLETE |
| Meeting ownership | `booking.controller.ts` | `bookings.tsx` | `Booking.assignedUserId` | assigned employee | FK SetNull | schema #17-26 | COMPLETE |
| Meeting acceptance | `booking.controller.ts` | `bookings.tsx` (API ready) | `Booking.acceptanceStatus`, `acceptedAt`, `acceptedByUserId` | PENDING_ACCEPTANCE, ACCEPTED | acceptance index | schema #17-26 | COMPLETE |
| Meeting notes | `booking.controller.ts` | `bookings.tsx` | `Booking.notes` | notes | n/a | schema #17-26 | COMPLETE |
| Proposal sent | `booking.controller.ts`, `customer.controller.ts` | `customers.tsx` filter | `Booking.proposalSent`, `proposalSentAt` | boolean + timestamp | proposalSent index | schema #17-26 | COMPLETE |
| Outcome | `booking.controller.ts` | `bookings.tsx` | `Booking.outcome` | WON/LOST/FOLLOW_UP/PENDING | outcome index | schema #17-26 | COMPLETE |
| Next action | `conversation.controller.ts`, `booking.controller.ts` | `calls.tsx`, `inbox.tsx`, `customers.tsx` | `Conversation.nextAction`, `Booking.nextAction`, `Call.nextAction` | nextAction text | n/a | schema #17-26 | COMPLETE |
| Tasks / employee ownership | `task.controller.ts` | `tasks.tsx`, `customers.tsx` | `Task` | assignedUserId, status, dueAt | assignee index | schema #27 | COMPLETE |
| WhatsApp outbox | `outboxWorker.service.ts`, `outboundDelivery.service.ts` | `whatsapp.tsx` | `OutboundMessage` | status, providerMessageId | status/channel indexes | schema #28 | COMPLETE |
| Hume webhook idempotency | `humeWebhook.service.ts` | n/a | `HumeWebhookReceipt` | idempotencyKey | unique | schema #11 | COMPLETE |
| Hume tool-call idempotency | `humeTool.service.ts` | n/a | `HumeToolCallReceipt` | toolCallId | unique | schema #12 | COMPLETE |
| Hume transcript sync jobs | `humeSyncWorker.service.ts`, `humeChatSync.service.ts` | n/a | `HumeChatSyncJob` | status, attempts, nextAttemptAt | unique(callId, chatId) | `humeSyncWorker.service.test.ts` | COMPLETE |
| Provider health / readiness | `aiProvider.controller.ts` | `settings.tsx` | multiple | config + worker state | n/a | manual route verification | COMPLETE |
| Reports / analytics | `reports.controller.ts`, `analytics.controller.ts`, `dashboard.controller.ts` | `analytics.tsx`, `commandcenter.tsx` | aggregate over Call, Booking, Task, Customer | status/date indexes | existing indexes | unit tests partial | COMPLETE |
| InterestTier legacy drift | forensics only | n/a | removed | n/a | n/a | n/a | LEGACY_ONLY |
| Session revocation table | not implemented | n/a | n/a | JWT only | n/a | n/a | NOT_APPLICABLE |

## Canonical Lead Intent Architecture

| Need | Canonical owner | Notes |
|---|---|---|
| Per-call business intent | `CallPostAnalysis.intentLevel`, `intentScore`, `evidenceSignals` | Written by post-call analysis worker |
| Customer projection | `Customer.leadScore`, `requirementSummary`, `requirementDetails` | Updated when post-call analysis completes |
| Pipeline stage | `Customer.leadStage` (`LeadStage` enum) | Distinct from per-call intent |
| Vocal expression / affect | `HumeExpressionAnalysis` | Separate from business intent |
| Legacy `InterestTier` / `voiceAffect` | **not recreated** | Replaced by structures above |

## Remaining Explicit Gaps

| Gap | Status | Notes |
|---|---|---|
| Dedicated booking acceptance UI panel | PARTIAL | API `POST /api/bookings/:id/accept` exists; bookings page can surface acceptance state next |
| Server-enforced session timeout | NOT_APPLICABLE | JWT-only architecture; timeout stored in settings JSON only |
| Full quotation workflow beyond `proposalSent` | PARTIAL | Proposal flag and `QUOTATION_SENT` lead filter now persisted; no separate quotation document model |

## InterestTier Decision

The old `InterestTier`, interest columns, and `voiceAffect` were **not** recreated. Product hot/warm/cold behavior is represented by:

- `CallPostAnalysis.intentLevel` for per-call business intent
- `Customer.leadScore` and `leadStage` for CRM projection
- `HumeExpressionAnalysis` for vocal-expression insights

## Calls / Meetings Specification Mapping

| Calls-section requirement | Canonical storage |
|---|---|
| AI Summary | `Conversation.aiSummary` |
| Customer Requirements | `CallPostAnalysis.requirementSummary` + `Customer.requirementSummary` |
| Meeting status | `Booking.status` |
| Meeting date/time | `Booking.dateTime`, `Booking.timezone` |
| Assigned To | `Booking.assignedUserId`, `Conversation.assignedUserId`, `Call.assignedUserId` |
| Pending acceptance | `Booking.acceptanceStatus = PENDING_ACCEPTANCE` |
| Accepted state | `Booking.acceptanceStatus = ACCEPTED`, `acceptedAt`, `acceptedByUserId` |
| Recording | `Call.recordingUrl` / `recordingSid` + reconstruction status |
| Transcript | `Call.transcript` + `Message` history |
| Next action | `Conversation.nextAction`, `Booking.nextAction`, `Call.nextAction` |
| Related call | `Booking.callId` |
