# Canonical Baseline Verification

- Verified at: 2026-07-27
- Supabase project reference: `tqmwrmlswbwngblxkibm`
- Environment: `NODE_ENV=development`

## Migration Status

- `npx prisma migrate status`: **Database schema is up to date**
- Applied migrations: **1**
  - `20260727120000_canonical_product_baseline`
- Failed migrations: **0**
- Missing migrations: **0**
- Extra database migrations: **0**
- Baseline checksum (SHA-256): `df0a56e33c57d59cedd1895fa597e7efab4121344cbd215567c2496e8ddd7fd3`

## Schema Drift

- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: **No difference detected**

## InterestTier Drift Removal

- `InterestTier` enum: **absent**
- `interest*` drift columns: **absent**
- `voiceAffect`: **absent**

## Application Tables Created

AiAgent, AuditLog, Booking, Call, CallPostAnalysis, Company, CompanySettings, Conversation, CrmStage, Customer, HandoffRule, HumeChatSyncJob, HumeExpressionAnalysis, HumeToolCallReceipt, HumeWebhookReceipt, IntegrationConnection, KnowledgeItem, Message, NotificationRule, OutboundMessage, Task, User

## Enums Created

AgentStatus, BookingAcceptanceStatus, BookingOutcome, BookingStatus, CallIntentLevel, CallPostAnalysisStatus, CallStatus, ConversationChannel, ConversationStatus, Industry, LeadStage, MessageSender, OutboundStatus, PreferredLanguage, Priority, ProviderSyncStatus, RecordingReconstructionStatus, TaskStatus, TelephonyProvider, UserRole, VoiceAgentProvider

## Key Constraints And Indexes Verified In Baseline SQL

- `Customer(companyId, phone)` unique
- `Call.providerCallId` unique
- `Call.humeChatId` unique
- `HumeWebhookReceipt.idempotencyKey` unique
- `HumeToolCallReceipt.toolCallId` unique
- `HumeChatSyncJob(callId, chatId)` unique
- `CallPostAnalysis.callId` unique
- `HumeExpressionAnalysis.callId` unique
- Booking acceptance, outcome, proposal, assignment indexes
- Hume worker query indexes on sync status and next attempt time

## Post-Reset Row Counts

Immediately after reset (before tenant init): all application tables **0 rows**.

After development tenant initialization:

| Table | Rows |
|---|---:|
| Company | 1 |
| User | 1 |
| All other application tables | 0 |

## Hume Structures

| Table | Present |
|---|---|
| HumeWebhookReceipt | yes |
| HumeToolCallReceipt | yes |
| HumeChatSyncJob | yes |
| HumeExpressionAnalysis | yes |

## Calls / Meetings Fields Present

| Area | Fields |
|---|---|
| Call | assignedUserId, purpose, notes, nextAction, preferredLanguage, preferredCallTime, summary, Twilio/Hume provider fields, recording metadata |
| Booking | callId, assignedUserId, acceptanceStatus, acceptedAt, acceptedByUserId, timezone, purpose, notes, proposalSent, proposalSentAt, outcome, nextAction, cancelledAt, completedAt |
| Conversation | assignedUserId, aiSummary, nextAction |
| Customer | leadStage, leadScore, requirementSummary, requirementDetails, preferredLanguage, businessType, budget, timeline |
| CallPostAnalysis | intentLevel, intentScore, requirementSummary, failureMessage |

## Verification Commands Run

- `npx prisma migrate reset --force`
- `npx prisma migrate status`
- `npx prisma generate`
- `npm run db:audit`
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
- `RUN_SCHEMA_INTEGRATION_TESTS=1 npm test -- tests/schema.integration.test.ts`

## Runtime Verification

- Backend typecheck: **0 errors**
- Backend unit tests: **40/40 passing**
- Schema integration tests: **21/21 passing**
- Backend production build: **successful**
- Compiled backend startup: **stable on port 5001**
- Workers started: Outbox, Post-Call Analysis, Hume Sync
- No P2021/P2022 observed during startup/worker ticks

## Route Verification

| Route | Result |
|---|---|
| `POST /api/voice/twilio/status` | `204` registered response, no crash |
| `POST /api/webhooks/hume/evi` unsigned | `401` missing-signature rejection, no crash |

## Secret Rotation

- `JWT_SECRET`: rotated locally, not printed
- `VOICE_WEBHOOK_SECRET`: rotated locally, not printed
- Values differ and old exposed values were removed from `.env`

## VOICE_COMPANY_ID

- Set in `backend/.env`
- References an existing `Company` row after tenant initialization

## Remaining Notes

- Frontend TypeScript build still has pre-existing `verbatimModuleSyntax` import issues unrelated to the database baseline; one Calls recording type bug was fixed in `AI/src/calls.tsx`.
- Booking acceptance UI can be expanded on `bookings.tsx`; API support exists at `POST /api/bookings/:id/accept`.
