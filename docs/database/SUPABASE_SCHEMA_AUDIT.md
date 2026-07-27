# Supabase Schema Audit (Read-Only)

- Inspection timestamp: 2026-07-27
- Environment inspected: repository-configured local development contract (`DATABASE_URL` points to Supabase host pattern)
- Prisma schema: `backend/prisma/schema.prisma`
- Migration history: `backend/prisma/migrations/*`
- Production database modified: **No**

## Migration History Status (Repository)
- Found migrations:
  - `20260704103332_init`
  - `20260705105149_add_agent_instructions`
  - `20260705174759_add_webhook_secret`
  - `20260706153950_add_outbound_messages`
  - `20260723143000_expand_call_status`
  - `20260725023000_add_call_post_analysis`
- Live `_prisma_migrations` status could not be queried in this run (no safe direct DB query executed from agent).

## Schema Drift
- Repository-only analysis found no drift evidence.
- Live drift check is pending non-production DB introspection with approved credentials.

## Current Provider / Recording / Analysis Columns
- `Call.provider`, `Call.providerCallId`, `Call.recordingUrl`, `Call.recordingSid`, `Call.recordingStatus`, `Call.recordingSource`, `Call.transcript`, `Call.metadata`
- `CallPostAnalysis` stores business-intent scoring and requirement extraction.

## Proposed Additive Hume Objects
- New enums:
  - `TelephonyProvider`
  - `VoiceAgentProvider`
  - `ProviderSyncStatus`
  - `RecordingReconstructionStatus`
- New `Call` fields:
  - `telephonyProvider`, `voiceAgentProvider`, `twilioCallSid`, `humeChatId`, `humeChatGroupId`, `humeConfigId`, `humeEndReason`
  - `transcriptSyncStatus`, `humeSyncStatus`, `recordingReconstructionStatus`, `expressionAnalysisStatus`, `providerMetadataVersion`
- New tables:
  - `HumeWebhookReceipt`
  - `HumeToolCallReceipt`
  - `HumeChatSyncJob`
  - `HumeExpressionAnalysis`

## RLS, Views, Functions, Triggers
- Could not be verified without direct SQL access in this run.
- Recommended explicit SQL audit in non-production Supabase project before apply.

## Usage Matrix (Potentially Affected Objects)
| Database object | Prisma reference | Backend reference | Frontend reference | Data present | External DB dependency | Classification | Action |
|---|---|---|---|---|---|---|---|
| `Call.provider` | yes | yes | yes | unknown | possible | COMPATIBILITY | RETAIN |
| `Call.providerCallId` | yes | yes | yes | unknown | possible | ACTIVE | RETAIN |
| `Call.recordingUrl` | yes | yes | yes | unknown | possible | HISTORICAL | RETAIN |
| `Call.recordingSid` | yes | yes | yes | unknown | possible | HISTORICAL | RETAIN |
| `Call.transcript` | yes | yes | yes | unknown | possible | ACTIVE | RETAIN |
| `Call.metadata` | yes | yes | no direct | unknown | possible | ACTIVE | RETAIN |
| `CallPostAnalysis.intentScore` | yes | yes | yes | unknown | possible | ACTIVE | RETAIN |
| `Conversation.provider` | yes | yes | indirect | unknown | possible | COMPATIBILITY | RETAIN |

## Unresolved Risks
- Live duplicate checks (`humeChatId`, tool IDs, webhook keys) need non-production SQL verification before production migration apply.
- RLS/policy impact for new tables is unknown until direct audit.
- Backfill strategy is not applied in this change set.

## Recommendation
- Proceed with additive migration only.
- Do not drop/rename existing columns in this provider migration.
- Run non-production SQL verification and migration dry-run before production approval.
