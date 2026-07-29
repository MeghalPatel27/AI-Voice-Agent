# Per-Call Data Isolation and Inbound Calls

## Identity invariants

### Customer identity
- Phone number locates/reuses **one Customer per Company** (`@@unique([companyId, phone])`).
- Phone number must **never** identify a Call.

### Call identity
- `Call.id` is the canonical key for one telephone session.
- Every real session creates a distinct `Call`.
- Transcript, recording, analysis, requirements, meetings, and Hume insights are owned by `Call.id`.

### Provider identity
- `Call.providerCallId` stores the exact Twilio Call SID (`@unique`).
- `Call.humeChatId` stores the exact Hume Chat ID (`@unique`).
- Hume Chat Group ID is supplemental only.

### Message / transcript identity
- Voice transcript `Message` rows include optional `callId`.
- Hume sync writes messages with `callId` and idempotent `(callId, providerMessageId)`.
- Call detail APIs filter messages and bookings by exact `Call.id`.

## Root cause: previous Calls changing

1. **Conversation-wide transcript reads** — `getCallById`, `finalizeCall`, and `loadCallTranscriptForAnalysis` read all `Conversation.messages`, mixing multiple Calls when present.
2. **Hume sync transcript rebuild** — `syncHumeChatForCall` queried all `hume_evi` messages on the Conversation, not scoped to the syncing Call.
3. **Frontend fallbacks** — Calls UI used `conversation.latestCallAnalysis`, `conversation.aiSummary`, and `conversation.computedTranscript` when Call-specific fields were empty.
4. **Customer projection bleed** — `Customer.requirementSummary` could appear indirectly via UI fallbacks (not via Call record mutation).

## Root cause: latest same-number Call missing Hume data

- `Call.humeChatId` was not persisted before reconciliation.
- Reconciliation requires exact Twilio SID match via `resolveHumeChatForCall` — never phone/latest-chat heuristics.
- Run: `npm run hume:reconcile-chat-history -- --dry-run` then `--apply` for exact matches only.

## Inbound calls

`bootstrapInboundVoiceCall()` is the canonical entry:
- **chat_started** webhook attaches Hume Chat identity and creates Call+Conversation when needed.
- **Twilio status callback** bootstraps when Call SID is unknown, then applies lifecycle.
- Company resolved from configured voice tenant (`HUME voiceCompanyId`).
- Customer resolved by `companyId + normalized caller phone`.
- No Task required.

## Commands

```bash
npm run calls:audit-isolation -- --dry-run
npm run calls:audit-isolation -- --apply
npm run hume:reconcile-chat-history -- --dry-run
npm run hume:reconcile-chat-history -- --apply
```

## Troubleshooting

| Symptom | Check |
|--------|--------|
| Old Call summary changed after new Call | Call detail must use `call.postCallAnalysis` only; verify `Message.callId` |
| Old Call transcript mixed | `Call.transcript` and scoped messages for that `callId` |
| Latest Call missing Hume data | `Call.providerCallId`, `Call.humeChatId`, reconciliation dry-run |
| Inbound missing from dashboard | `bootstrapInboundVoiceCall`, Twilio `Direction=inbound`, webhook receipts |
