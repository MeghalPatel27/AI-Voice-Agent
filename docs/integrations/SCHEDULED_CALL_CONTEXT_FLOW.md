# Scheduled Call Context Flow

## Current canonical contract

- `collectionGoal` (required): call-specific objective for what the live agent should collect.
- `extraNotes` (optional, private): internal context for the agent, not for verbatim playback.
- `preferredLanguage` (optional): `AUTO | ENGLISH | HINDI | GUJARATI`.
- `callPurpose` (optional): short reason for the call.
- `scheduledAt` (required): ISO datetime.
- `timezone` (required): IANA timezone string.
- `customerId` (optional): validated in company scope when provided.

## Frontend field mapping

- Form label `What should AI collect?` -> API `collectionGoal`.
- Form label `Extra notes for AI` -> API `extraNotes`.
- Form label `Short call purpose` -> API `callPurpose`.
- Form label `AI speaking language` -> API `preferredLanguage`.
- Form label `Call time` -> API `scheduledAt`.
- Form label `Timezone` -> API `timezone`.

## API and validation

Endpoint: `POST /api/tasks/ai-call`

- `collectionGoal` is required, trimmed, and bounded.
- `extraNotes` and `callPurpose` are bounded.
- `preferredLanguage` is enum-validated.
- `scheduledAt` must be valid and not in the past.
- `companyId` is always derived from authenticated user.
- optional `customerId` is validated in authenticated tenant scope.

## Database persistence

- `Task.aiNotes` stores typed JSON (`kind: AI_SCHEDULED_CALL`, versioned payload).
- `Task.dueAt` stores scheduled time.
- `Task.customerId` stores scoped customer relation.
- `Call.purpose` stores `collectionGoal` (canonical call objective).
- `Call.notes` stores `extraNotes` (private context).
- `Call.preferredLanguage` stores language enum.
- `Call.preferredCallTime` stores scheduled time.
- `Call.metadata` stores bounded auxiliary fields (`callPurpose`, `timezone`, worker tracing).

## Worker flow

`runAiScheduledCallWorkerOnce`:

1. Picks due scheduled AI call tasks (`dueAt <= now`).
2. Parses typed `Task.aiNotes`.
3. Runs `prepareScheduledAiCallForTask` to create conversation/message/call records and copy canonical context.
4. Runs `dialPreparedScheduledAiCall` through the Twilio adapter in production.
5. Prevents duplicate call creation on retries when existing `callSid`/`conversationId` mapping exists.
6. Updates task lifecycle state in typed `aiNotes` (`CALLING` / `RINGING`).

When the related Call becomes terminal (Twilio status callback and/or Hume `chat_ended`), `finalizeCall` / `callLifecycle.service` terminalizes the Task (`DONE` or `BLOCKED`) in the same transaction as Call finalization. See `docs/integrations/CALL_LIFECYCLE_AND_TASK_SYNC.md`.

Development verification uses `npm run dev:verify-scheduled-call-context -- --apply` with:

- `NODE_ENV=development`
- `ALLOW_DEV_SCHEDULED_CONTEXT_SEED=true`
- Node 24
- known development Supabase project ref (`DEV_SUPABASE_PROJECT_REF`)
- transactional rollback for temporary call/conversation verification records (Task/customer seed remains)

## Shared context builder

`buildAiradeskCallContext(callId, companyId)` is the tenant-safe internal builder used by:

- `airadesk_get_call_context` (after verified `chat_id -> Call` resolution)
- development verification/tests

The Hume tool wrapper still resolves verified chat identity first; the builder accepts only server-resolved identifiers.

## Hume version fields

Validation/reporting distinguishes:

- `humeConfigVersion` — remote EVI config revision
- `humePromptRemoteVersion` — remote prompt revision attached to the config
- `localCanonicalPromptVersion` — repository canonical prompt label (for example `2026-07-28.1`)

These must not be conflated in reports or scripts.

## Private notes

- `extraNotes` are stored on `Call.notes` and included only in internal Hume context with a non-disclosure marker.
- They are not rendered on customer-facing frontend surfaces or spoken greetings.
- The canonical Hume system prompt forbids reading private notes verbatim.

## Seed command safety

`backend/.env.example` includes `ALLOW_DEV_SCHEDULED_CONTEXT_SEED=false`.

The seed command creates or reuses one `[SEED] Scheduled Context Verification` customer and one future scheduled Task marked with `DEV_SCHEDULED_CONTEXT_VERIFICATION`. It performs no Twilio, Hume, OpenAI, or telephony provider calls.

To inspect: open Tasks in the dashboard and filter for `[SEED]`. To remove safely: delete the labelled Task and customer from the development tenant only.

## Hume context-tool usage

`airadesk_get_call_context`:

- Resolves context from verified `chat_id -> Call -> Conversation -> Company`.
- Ignores model-supplied tenant or object identifiers.
- Returns bounded structured data for:
  - company profile/tone
  - customer name/language
  - call objective (`collectionGoal`), `callPurpose`, private `extraNotes`, schedule language/timezone
  - recent summary + bounded known requirements
- Provides inbound fallback discovery objective when no scheduled objective exists.

## Frontend display usage

- Tasks panel renders scheduled-call summary from `Task.aiNotes`.
- Scheduled-call details show purpose/objective, language, and status.
- Private notes remain internal context and are not shown in customer-facing surfaces.

## Previous loss points (before this update)

- `purpose/notes` were untyped JSON keys with no canonical contract.
- `Call.purpose` and `Call.notes` were not reliably populated from scheduled tasks.
- timezone was not part of scheduled-call payload contract.
- context-tool response used broad fields and leaked low-value internals.
- inbound fallback objective for unscheduled calls was not explicit.

## Current fallback behavior

- If no scheduled objective exists (typical inbound), the context tool returns tenant-aware generic discovery goals:
  - understand requirements/services
  - capture budget/timeline when appropriate
  - confirm exact meeting date/time/timezone before scheduling
