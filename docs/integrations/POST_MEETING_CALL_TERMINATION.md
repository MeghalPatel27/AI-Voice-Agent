# Post-Meeting Call Termination

## Verified Root Cause

- The canonical prompt previously said to use `hang_up` only after caller confirmation of completion.
- That instruction allows the model to keep waiting after a successful booking tool response.
- In production behavior this maps to failure category **A/C/G**: ambiguous termination rule, closing spoken, no guaranteed immediate `hang_up`.
- In this workspace snapshot, the currently connected database does not contain a recent booking-linked call record for timeline replay; root cause was validated from canonical prompt behavior and existing lifecycle/tool code paths.

## Termination Contract (Terminal Business Outcome)

After `airadesk_schedule_meeting` returns `success: true`:

1. Speak one brief closing.
2. Immediately invoke built-in `hang_up`.
3. Do not ask another question.
4. Do not ask "Is there anything else?"
5. Do not wait for caller goodbye.
6. Do not call another business tool.

If `needsClarification: true`, keep the call open and ask exactly the clarification question.
If scheduling fails, do not claim booking success.

## Primary + Fallback Layers

### Primary (Hume)

- Prompt now requires immediate post-success `hang_up`.
- `hume:validate-config` confirms `hangupEnabled: true`.

### Fallback (Twilio watchdog)

- Service: `backend/src/services/callTermination.service.ts`
- Intent persistence: `CallTerminationIntent` (exact `callId` scoped).
- Default bounded controls:
  - `POST_MEETING_HANGUP_GRACE_MS=10000`
  - `POST_MEETING_HANGUP_MAX_ATTEMPTS=2`
  - `POST_MEETING_HANGUP_RETRY_MS=2000`
- Fallback checks terminal proof first, then fetches exact Twilio call by exact provider SID, and only requests `Status=completed` when provider state is active.
- No phone-based matching, no "latest call" heuristics.

## Lifecycle Integration

- `chat_ended` and terminal Twilio callbacks mark termination intent as satisfied.
- Fallback exits once terminal proof exists.
- Call/Task finalization remains canonical in lifecycle/finalization services.
- Post-call workers continue independently; watchdog does not enqueue post-call jobs.

## Reconciliation Command

```bash
cd backend
npm run calls:reconcile-termination -- --dry-run
npm run calls:reconcile-termination -- --apply
```

- Dry-run is default.
- Applies only to exact stale `CallTerminationIntent` + exact active call SID.

## Troubleshooting

### Meeting booked but call remained connected

1. Check `HumeToolCallReceipt` accepted response for schedule tool.
2. Check `CallTerminationIntent` state and grace deadline.
3. Check whether `chat_ended` arrived.
4. Check Twilio callback status and provider-active state.
5. Run `calls:reconcile-termination -- --dry-run`.

### Hume did not invoke `hang_up`

- Verify remote prompt checksum/version matches local canonical prompt.
- Confirm prompt rules include post-meeting immediate hang-up constraints.

### Twilio fallback failed

- Check `lastErrorCategory` on `CallTerminationIntent`.
- `401/403` are permanent auth failures; `429/5xx` retry within configured bounds only.
