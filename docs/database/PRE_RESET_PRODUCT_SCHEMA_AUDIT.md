# Pre-Reset Product Schema Audit

- Inspection timestamp: 2026-07-27T11:28:39Z
- Supabase project reference: `tqmwrmlswbwngblxkibm`
- Environment: `NODE_ENV=development`
- Database hostname: `db.tqmwrmlswbwngblxkibm.supabase.co`
- Port: `5432`
- Database name: `postgres`
- Development-only confirmation: **yes** — only 1 company, 1 user, 4 customers, 1 conversation, 1 call, 1 booking, 2 tasks, 7 CRM stages, 2 integration connections, no Hume receipts/jobs/expression rows

## Pre-Reset Row Counts

| Table | Rows |
|---|---:|
| Company | 1 |
| CompanySettings | 1 |
| User | 1 |
| Customer | 4 |
| Conversation | 1 |
| Message | 15 |
| Call | 1 |
| CallPostAnalysis | 1 |
| Task | 2 |
| Booking | 1 |
| AiAgent | 0 |
| OutboundMessage | 0 |
| KnowledgeItem | 0 |
| CrmStage | 7 |
| HandoffRule | 0 |
| NotificationRule | 0 |
| AuditLog | 0 |
| IntegrationConnection | 2 |
| HumeWebhookReceipt | 0 |
| HumeToolCallReceipt | 0 |
| HumeChatSyncJob | 0 |
| HumeExpressionAnalysis | 0 |

No evidence of production/customer-scale data was observed.

## Current Prisma Models (pre-reset repository schema)

Company, CompanySettings, IntegrationConnection, User, Customer, Conversation, Message, Call, HumeWebhookReceipt, HumeToolCallReceipt, HumeChatSyncJob, HumeExpressionAnalysis, CallPostAnalysis, Task, AiAgent, Booking, OutboundMessage, KnowledgeItem, CrmStage, HandoffRule, NotificationRule, AuditLog

## Live Database Tables Before Reset

23 public application tables plus `_prisma_migrations`.

## Migration Directories Before Reset

1. `20260704103332_init`
2. `20260705105149_add_agent_instructions`
3. `20260705174759_add_webhook_secret`
4. `20260706153950_add_outbound_messages`
5. `20260723143000_expand_call_status`
6. `20260725023000_add_call_post_analysis`
7. `20260727160000_add_hume_evi_runtime`

Database also recorded applied migration `20260725010000_add_lead_buying_interest` missing from repository.

## `_prisma_migrations` Before Reset

Eight finished migrations, including the unrecoverable `20260725010000_add_lead_buying_interest`.

## Schema Drift Before Reset

Live database contained drift-only objects absent from repository Prisma schema:

- Enum `InterestTier`
- `Customer.interestTier`, `interestScore`, `interestReasons`, `interestConfidence`, `interestSource`, `interestUpdatedAt`
- `Call.interestTier`, `interestScore`, `interestReasons`, `interestConfidence`, `interestSource`, `interestAnalyzedAt`, `interestVoiceAnalyzedAt`, `voiceAffect`
- Related interest indexes

Repository schema lacked canonical Calls/Meetings fields such as booking acceptance, `callId`, proposal state, and typed lead stage.

## Missing Migration Evidence

See `docs/database/MISSING_MIGRATION_20260725010000_FORENSICS.md` and `docs/database/LEGACY_MIGRATION_HISTORY.md`.

## Active Product Features Audited

Multi-tenancy, JWT auth, customers/leads, conversations/messages, AI calls, Twilio status callbacks, Hume EVI runtime, post-call business analysis, Hume expression analysis, recordings, bookings/meetings, tasks, WhatsApp outbox, reports/analytics, settings/integrations.

## Database Dependencies By Feature

| Feature | Primary tables |
|---|---|
| Auth / tenancy | Company, User |
| Customers / leads | Customer, Conversation, CallPostAnalysis |
| Conversations / messages | Conversation, Message |
| Calls | Call, Conversation, CallPostAnalysis, Hume* |
| Meetings | Booking, Call, Conversation, User |
| Tasks | Task, User |
| WhatsApp outbox | OutboundMessage |
| Provider idempotency | HumeWebhookReceipt, HumeToolCallReceipt |

## Target Canonical Schema

One baseline migration generated from final audited `schema.prisma`, including:

- Typed `LeadStage`, `BookingStatus`, `BookingAcceptanceStatus`, `BookingOutcome`, `PreferredLanguage`
- Booking assignment/acceptance/proposal/outcome fields
- `Booking.callId`
- `Conversation.assignedUserId`, `Call.assignedUserId`
- `Customer` requirement and lead projection fields
- `CallPostAnalysis.failureMessage`
- `Customer(companyId, phone)` uniqueness
- No `InterestTier` or `voiceAffect`

## Reset Plan

1. Replace executable migrations with `20260727120000_canonical_product_baseline`
2. Run `npx prisma migrate reset --force` against verified development project only
3. Re-seed one development tenant through `db:seed-dev` or normal registration
4. Rotate exposed development secrets
5. Verify migration status, schema drift, tests, builds, and route health

## Rollback / Reference Plan

- Retired migration names and checksums preserved in `LEGACY_MIGRATION_HISTORY.md`
- Forensics for missing migration preserved in `MISSING_MIGRATION_20260725010000_FORENSICS.md`
- Old test data was intentionally not migrated
