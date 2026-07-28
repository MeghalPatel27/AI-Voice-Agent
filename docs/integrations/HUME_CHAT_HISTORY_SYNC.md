## Meeting recovery note

- `FUNCTION_CALL` presence in Hume Chat History is evidence of intent, not proof of local booking commit.
- For missed schedule-meeting executions, use `npm run meetings:reconcile-hume -- --dry-run` first, then `--apply` only for deterministic cases.
- Recovery uses historical reference timestamps from chat events to resolve relative dates safely.
# Hume Chat History Synchronization

## Verified root cause (July 2026 development calls)

Audit of the most recent completed outbound call (`48912304…`, Twilio `CAceff…eff2`) found:

1. **Hume Chat existed** in Hume Chat History with matching Twilio Call SID metadata (`524f7c86…`, 74 events).
2. **`Call.humeChatId` was never persisted** on the AiraDesk Call, so `chat_ended` could not enqueue sync jobs.
3. **No `HumeChatSyncJob` rows** were created; transcript/expression/recording pipelines never ran.
4. **Dashboard transcript** contained only the scheduled-call system message, not Hume `USER_MESSAGE` / `AGENT_MESSAGE` events.
5. **Post-call analysis** remained `INSUFFICIENT_DATA` because no usable conversation transcript existed.
6. **Customer requirements UI** fell back to the scheduled **collection goal** (`Call.purpose` / task instruction) instead of actual caller requirements.

### Failure category

| Code | Finding |
|------|---------|
| B | `chat_started` did not attach Chat ID to the pre-created outbound Call (webhook race / missed delivery window) |
| D | No sync job because `humeChatId` was null at `chat_ended` |
| E | Legacy event parser read `message.content` instead of Hume EVI v3 `message_text` and `events_page` |
| I | Collection goal was displayed as customer requirements |

## Correlation contract

**Preferred order**

1. `chat_started` webhook Chat ID → persist on Call
2. Stored `Call.humeChatId`
3. Exact Hume metadata Twilio Call SID ↔ `Call.providerCallId`
4. Config ID match
5. Chat start time within call window
6. Direction compatibility

**Never match using only**

- newest Hume chat
- phone number
- customer name
- call creation order
- Chat Group ID without inspecting member chats

**On ambiguity:** fail closed → `NEEDS_REVIEW`, do not populate transcript/recording/requirements.

## Pipeline

```
Twilio Call
  → chat_started / reconcile (Twilio SID)
  → persist humeChatId + humeChatGroupId
  → chat_ended / terminal Twilio
  → HumeChatSyncJob
  → fetch all chat event pages (ascending)
  → persist Message rows + Call.transcript
  → HumeExpressionAnalysis
  → audio reconstruction (poll, no permanent signed URL)
  → post-call OpenAI analysis
  → dashboard projection
```

## Event filtering

Included in customer transcript:

- `USER_MESSAGE` → CUSTOMER
- `AGENT_MESSAGE` → AI
- `USER_INTERRUPTION` → marker only

Excluded:

- `SYSTEM_PROMPT`, `SESSION_SETTINGS`, `FUNCTION_CALL`, `FUNCTION_CALL_RESPONSE`, `ASSISTANT_PROSODY`

## Recording playback

- `GET /api/calls/:callId/recording/media` proxies Hume audio server-side
- Signed URLs are **not** stored permanently
- Tenant scoping enforced via `Call.conversation.companyId`

## Call objective vs customer requirements

| Field | Meaning |
|-------|---------|
| `Call.purpose` / `callObjective` | Scheduled instruction to the agent |
| `postCallAnalysis.requirementSummary` | Actual customer needs (tool or transcript) |
| `capturedRequirementSummary` | Immediate projection from `airadesk_capture_lead_details` |

UI must **not** use collection goal as a requirements fallback.

## Relative date resolution

- Hume prompt includes `{{now}}` and Asia/Kolkata default
- Backend `resolveMeetingDateTime()` is authoritative
- `new Date(preferredTimeText)` is not used for natural language
- Ambiguous phrases return `needsClarification`

Example: reference 28 July 2026 + “tomorrow at 7 PM” → 29 July 2026 19:00 Asia/Kolkata.

## Reconciliation

```bash
npm run hume:reconcile-chat-history -- --dry-run
npm run hume:reconcile-chat-history -- --apply
```

Bounded by:

- `HUME_CHAT_RECONCILE_LOOKBACK_DAYS`
- `HUME_CHAT_MATCH_TIME_WINDOW_SECONDS`
- `HUME_CHAT_SYNC_PAGE_SIZE`
- `HUME_CHAT_SYNC_MAX_PAGES`
- `HUME_AUDIO_POLL_MAX_ATTEMPTS`
- `HUME_AUDIO_POLL_BASE_MS`

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Missing transcript | `Call.humeChatId`, `HumeChatSyncJob` status, webhook receipts |
| Wrong requirements | `postCallAnalysis.status`, collection goal separation |
| Wrong meeting date | Booking `dateTime`, original phrase in notes, resolver logs |
| Missing recording | `recordingReconstructionStatus`, audio poll attempts |
| Wrong chat attached | Twilio SID + config ID + timestamp delta in reconcile dry-run |

## Hume portal Call Summary

No documented AiraDesk integration for Hume’s portal-only business summary. AiraDesk uses:

- Hume events → transcript
- OpenAI post-call analyzer → summary + requirements
- Hume expression events → separate voice insights panel
