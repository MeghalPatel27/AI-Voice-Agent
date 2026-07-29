## Meeting linkage expectations

- A call is linked to a meeting only when a booking row exists.
- Transcript text or verbal confirmation alone must never mark `bookingCreated=true`.
- When reconciliation finds terminal calls with missing post-call jobs, those jobs can be safely enqueued without reopening terminal tasks.
# Call Lifecycle and Task Sync

## Purpose

Keep AiraDesk **Call**, **Task**, **Conversation**, and post-call processing consistent when Twilio and Hume emit overlapping, delayed, duplicated, or out-of-order events.

A Task must never remain **Doing** after its related Call is terminal. Post-call transcript/analysis/recording work is separate from Task execution status.

## Source-of-truth boundaries

| System | Owns |
|--------|------|
| **Twilio** | Telephony progress: queued, initiated, ringing, in-progress, completed, busy, no-answer, failed, canceled |
| **Hume EVI** | Chat identity, `chat_started` / `chat_ended`, tool calls, end reason, transcript/history, expression data, recording reconstruction availability |
| **AiraDesk Call** | Canonical aggregate: normalized `CallStatus`, provider SIDs, Hume IDs, timestamps, processing flags |
| **AiraDesk Task** | Scheduled business execution (`OPEN` → `DOING` → `DONE` / `BLOCKED`) |
| **AiraDesk Conversation** | CRM conversation lifecycle |
| **Post-call jobs** | Transcript sync, business analysis, expression analysis, recording reconstruction |

## Prisma enums (authoritative)

- `CallStatus`: `RINGING`, `IN_PROGRESS`, `LIVE`, `COMPLETED`, `NO_ANSWER`, `BUSY`, `CANCELED`, `FAILED`, `MISSED`, `TRANSFERRED`
- `TaskStatus`: `OPEN`, `DOING`, `BLOCKED`, `DONE`
- `ConversationStatus`: `NEW`, `IN_PROGRESS`, `FOLLOW_UP`, `CONVERTED`, `HUMAN_REQUIRED`, `LOST`

There is no separate Task `FAILED` / `CANCELED` enum. Non-success call outcomes map Task → `BLOCKED` with `blockedReason` + `aiNotes.status` (`FAILED` / `BUSY` / `NO_ANSWER` / `CANCELED`).

## Conceptual phases → enums

| Phase | Call statuses |
|-------|----------------|
| PRE_CALL / dialing | Call created as `RINGING` |
| ACTIVE | `RINGING`, `IN_PROGRESS`, `LIVE` |
| TERMINAL_SUCCESS | `COMPLETED`, `TRANSFERRED` |
| TERMINAL_NON_SUCCESS | `BUSY`, `NO_ANSWER`, `MISSED`, `FAILED`, `CANCELED` |

## Canonical services

| Service | Role |
|---------|------|
| `callLifecycle.service.ts` | Authoritative Twilio/Hume lifecycle transitions, Task sync helpers, post-call orchestration |
| `callFinalization.service.ts` | Transactional Call + Conversation + Customer + analysis queue + **Task terminalization** |
| `callReconciliation.service.ts` | Dry-run / apply repair for stale Doing Tasks and missing jobs |
| `twilioStatus.service.ts` | Thin adapter → `applyTwilioLifecycleEvent` |
| `humeWebhook.service.ts` | `chat_started` attach/create; `chat_ended` → `applyHumeChatEndedLifecycle` |

## Twilio status mapping

| Twilio | CallStatus |
|--------|------------|
| queued / initiated / ringing | `RINGING` |
| answered / in-progress | `IN_PROGRESS` |
| completed | `COMPLETED` |
| busy | `BUSY` |
| failed | `FAILED` |
| no-answer (outbound) | `NO_ANSWER` |
| no-answer (inbound) | `MISSED` |
| canceled / cancelled | `CANCELED` |
| unknown | **ignored** (no transition) |

## Hume event mapping

| Event | Behavior |
|-------|----------|
| `chat_started` | Attach `humeChatId` to Call by Twilio SID, or create inbound Conversation+Call; status → `IN_PROGRESS` when allowed; store `metadata.answeredAt`; asynchronously prewarm call context cache |
| `tool_call` | Canonical dispatcher: idempotent business execution once; Control Plane Tool Response/Error with exact `tool_call_id`; race-safe resolve via chat id or verified Twilio SID |
| `chat_ended` | Persist `humeEndReason`, enqueue sync, **finalize Call + Task** without forcing success over an existing non-success Twilio terminal |
| `hang_up` tool | Intention only; terminalization waits for verified `chat_ended` and/or Twilio terminal callback |

## Task ↔ Call link

Deterministic relation (no phone/name matching):

1. `Call.metadata.taskId` (set at scheduled-call prepare)
2. Else Task on same `conversationId` with `aiNotes.kind = AI_SCHEDULED_CALL` matching `callSid` / active notes status / `DOING`

## Task transition rules

| Call terminal | Task status | `aiNotes.status` |
|---------------|-------------|------------------|
| `COMPLETED` / `TRANSFERRED` | `DONE` | `COMPLETED` |
| `BUSY` | `BLOCKED` | `BUSY` |
| `NO_ANSWER` / `MISSED` | `BLOCKED` | `NO_ANSWER` |
| `FAILED` | `BLOCKED` | `FAILED` |
| `CANCELED` | `BLOCKED` | `CANCELED` |

Rules:

- `completedAt` set once
- Terminal Task never reopened by late ringing/in-progress
- Pre-dial `BLOCKED`/`FAILED` without `callSid` is not marked `DONE`
- Post-call processing never returns Task to `DOING`

## Conversation rules

- Active call: Conversation `IN_PROGRESS`
- Terminal call: Conversation → `FOLLOW_UP` unless already `CONVERTED` / `HUMAN_REQUIRED`
- `lastMessageAt` updates only when transcript/message content exists

## Post-call orchestrator

`enqueuePostCallProcessing(callId)` (idempotent):

1. If Hume chat exists: enqueue transcript sync once (`HumeChatSyncJob` unique on `callId+chatId`; does not reopen `COMPLETED`)
2. Queue recording reconstruction flag (`QUEUED`) once when previously `NOT_REQUESTED`
3. Ensure expression analysis row once (unique on `callId`)
4. Business analysis created inside `finalizeCall` (unique on `callId`)

Call/Task terminalization **does not wait** for these jobs.

## Duplicate / out-of-order handling

- Terminal → active transitions rejected (`shouldApplyCallStatus` / `canTransitionCallStatus`)
- Duplicate terminal events are idempotent (preserve first `endedAt` / `endReason` / Task `completedAt`)
- `chat_ended` before Twilio: finalize from Hume; later Twilio merges provider duration/status without downgrade
- Twilio before Hume: Call/Task already terminal; Hume adds end reason + jobs only
- Concurrent finalizers: unique constraints on analysis/sync/expression jobs

## Dashboard realtime

No CRM WebSocket. Pages use **bounded polling (4s)** while active records exist:

- Tasks: while any Task is `DOING` or scheduled-call notes/call is live
- Calls: while any listed/selected call is live
- Inbox / Command Center: existing live polls retained

Polling stops when all visible records are terminal. Refresh always reloads persisted server status.

UI separates:

- **Task status** chip (`Doing` / `Done` / `Blocked`)
- **Call status** (from Call row / `latestCallStatus`, not Task status fallback)
- **Processing** chips (transcript / analysis / recording)

## Reconciliation

```bash
cd backend
npm run calls:reconcile              # dry-run (default)
npm run calls:reconcile -- --apply   # repair provably stale rows
```

Env: `CALL_RECONCILE_STALE_ACTIVE_MINUTES` (default 45).

Safe repairs:

1. Terminal Call + active Task → terminalize Task
2. Terminal Call + active Conversation → finalize Conversation
3. Terminal Call + missing eligible jobs → enqueue once

Unsafe / not auto-completed:

- Stale active Calls without verified provider terminal evidence (reported only)

### Post-meeting termination reconciliation

```bash
cd backend
npm run calls:reconcile-termination -- --dry-run
npm run calls:reconcile-termination -- --apply
```

- Operates on exact `CallTerminationIntent` rows only.
- Never matches by customer phone.
- Never terminates ambiguous records.
- Terminal Twilio/Hume lifecycle evidence still drives canonical finalization.

## Troubleshooting Task stuck in Doing

1. Confirm related Call via `metadata.taskId` / `aiNotes.callSid`
2. If Call is already terminal: `npm run calls:reconcile -- --apply`
3. If Call is still active: wait for Twilio status callback / Hume `chat_ended`, or inspect Twilio SID
4. Confirm Tasks page polling or refresh — UI must reflect API status

## Lifecycle event matrix (post-fix)

| Source | Event | Call | Task | Conversation | Jobs | Frontend |
|--------|-------|------|------|--------------|------|----------|
| Scheduler | prepare/dial | `RINGING` | `DOING` | `IN_PROGRESS` | — | poll shows Doing |
| Twilio | ringing / in-progress | advance if allowed | stays `DOING` | unchanged | — | poll |
| Hume | chat_started | `IN_PROGRESS` + chat IDs | stays `DOING` | — | — | poll |
| Twilio | completed / busy / … | terminal | `DONE`/`BLOCKED` | `FOLLOW_UP` | analysis (+ sync if chat) | poll stops when terminal |
| Hume | chat_ended | terminal (or keep non-success) | sync | finalize | sync/expression/recording | poll |
| Reconciler | apply | unchanged terminal | repair | repair | restore | next fetch |

## Previous bug (root cause)

`finalizeCall` updated Call + Conversation + queued analysis but **never updated the related Task**. Scheduled AI calls set Task to `DOING` at dial time and only `BLOCKED` on dial/config failure. Successful hang-ups left Tasks in **Doing** forever. The Tasks page also did not poll, so even after a manual Task fix the UI looked stale until refresh.
