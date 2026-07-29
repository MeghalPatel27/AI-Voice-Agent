# Hume Meeting Scheduling

## Verified Root Cause (Latest Development Call)

- Exact correlated call had one `FUNCTION_CALL` for `airadesk_schedule_meeting`.
- No corresponding webhook/tool receipt existed in AiraDesk for that tool call.
- No booking existed for the call.
- Failure category: **C** (`FUNCTION_CALL` happened in Hume chat history, but webhook delivery to AiraDesk was not observed).
- The agent later verbally confirmed scheduling despite no backend success response (`FUNCTION_CALL_RESPONSE` missing in chat events).

## Success Definition

A meeting is scheduled only when all backend steps succeed:

1. request validated,
2. date/time/timezone resolved deterministically,
3. UTC computed,
4. booking committed,
5. company/customer/call links verified,
6. duplicate prevention passes,
7. tool response reports success.

Webhook HTTP 200 alone is never business success.

## Canonical Service

`scheduleMeetingForVerifiedCall(...)` is the authoritative scheduling path for Hume:

- inputs come from verified call/chat context (not model IDs),
- uses deterministic resolver with explicit `referenceInstant`,
- preserves caller phrase and timezone,
- writes booking transactionally,
- links company, conversation, customer, and call,
- enforces idempotency using exact `tool_call_id` marker plus call+timeslot dedupe,
- returns success only after commit.

## Relative Date Resolution

- Live tool calls resolve from backend invocation time.
- Historical recovery resolves in this order:
  1. function-call event timestamp,
  2. user meeting-request timestamp,
  3. call `startedAt`,
  4. call `createdAt`.
- Example: `tomorrow at 7 PM`, local date `28 Jul 2026`, timezone `Asia/Kolkata` resolves to:
  - local `2026-07-29 19:00`,
  - UTC `2026-07-29T13:30:00.000Z`.

## Tool Response vs Acknowledgement

- `tool_call` webhook receipt confirms transport only.
- `tool_response`/`tool_error` confirms what the model can safely say next.
- Meeting confirmation speech is allowed only for `success: true`.

## Historical Recovery

Use:

- `npm run meetings:reconcile-hume -- --dry-run`
- `npm run meetings:reconcile-hume -- --apply`

Behavior:

- inspects terminal correlated calls with Hume chat history,
- extracts `airadesk_schedule_meeting` calls,
- refuses ambiguous/missing-time/missing-timezone/conflicting requests,
- never writes in dry-run,
- on apply uses canonical scheduling service only,
- never sends tool responses to ended chats,
- preserves idempotency and avoids duplicate bookings.

## Troubleshooting: "Agent said booked, no meeting"

1. Inspect exact call ↔ chat mapping.
2. Confirm `FUNCTION_CALL` tool name and args.
3. Check webhook receipt and `HumeToolCallReceipt`.
4. Check booking for call and tool marker.
5. If deterministic and unambiguous, run meeting reconciliation apply.
6. If ambiguous or past-time resolution, keep unresolved and request manual review.

## Post-success call closure contract

- Successful `airadesk_schedule_meeting` is a terminal business outcome for short qualification calls.
- Tool response now includes termination hints: `conversationComplete: true`, `nextAction: "close_and_hang_up"`, `mustHangUp: true`.
- Clarification responses keep the call open and never include hang-up flags.
- Failure responses remain truthful and must not claim meeting success.
