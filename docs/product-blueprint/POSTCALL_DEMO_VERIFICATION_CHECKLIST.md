# Demo verification checklist — Post-call intent & call finalization

Do not record credentials or full phone numbers in evidence notes.

## Customer hangs up

1. Start a demo voice call (inbound or outbound).
2. Customer ends the call.
3. Backend marks the call terminal (`COMPLETED` or mapped provider status) with `endedAt` / `endReason`.
4. Dashboard `Live AI calls` count decreases; inbox badge shows **Call ended** (not **Call ongoing**).
5. Analysis row becomes `PENDING` then `PROCESSING`.
6. After worker completion, Customer Intent + Lead Requirement appear on inbox and leads.

## AI ends the call

1. Start a call that reaches the existing AI goodbye / hangup path.
2. AI ends the call (Twilio hangup still occurs).
3. Backend marks it ended via the same `finalizeCall` path.
4. Duplicate Twilio `completed` status callback does not create a second analysis row or reset a `COMPLETED` analysis.
5. Analysis completes once.

## Insufficient transcript

1. End a call before meaningful customer conversation.
2. Call status becomes ended.
3. Analysis becomes `INSUFFICIENT_DATA` / intent unclear.
4. No fabricated requirement summary or score is stored.

## Provider failure

1. Simulate OpenAI analysis failure (revoke key / mock reject in tests).
2. Call remains ended.
3. Dashboard shows **Analysis unavailable**.
4. No fake score is stored.

## Automated coverage

- Backend unit tests cover finalization idempotency, worker claim/failure, and validation.
- Frontend has no dedicated test runner; UI states were verified by typecheck/build and code-path review.
