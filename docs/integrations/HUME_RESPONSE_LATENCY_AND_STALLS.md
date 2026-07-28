# Hume response latency and greeting stalls

## Verified stall (most recent)

**Inspected chat:** `96f0…b2f5` (Hume config `e52f…b03b` version 4, voice Kora, model GPT-4o)  
**Local Call correlation:** none (`humeChatId` was never attached; webhook receipts for real chats are absent)  
**Wall-clock window:** 2026-07-28T13:02:37Z → 13:03:06Z (~29s)

### Exact event timeline (redacted)

| # | Event | Timestamp (UTC) | Offset from chat start | Observed? |
|---|--------|-----------------|------------------------|-----------|
| 1 | Twilio call connected / audio session | ~13:02:46 (SESSION_SETTINGS with Twilio metadata) | ~8.4s | Yes |
| 2 | Hume `chat_started` webhook received by AiraDesk | — | — | **No** (public webhook host returned HTTP 404; DB has no real `chat_started` receipts) |
| 3 | Hume `on_new_chat` greeting | 13:02:46.048 | +8.484s | Yes — AGENT_MESSAGE `"Hello?"` |
| 4 | Greeting audio (ASSISTANT_PROSODY) | 13:02:46.527 | +8.963s | Yes |
| 5 | Caller’s first audio / message | — | — | **Not transcribed** |
| 6 | First Hume `USER_MESSAGE` | — | — | **No** |
| 7 | First GPT-4o response decision after greeting | — | — | **No** |
| 8 | `airadesk_get_call_context` tool call | — | — | **No** |
| 9–12 | Tool webhook / execution / Control Plane | — | — | **N/A** (no tool call) |
| 13–14 | Next assistant message / audio | — | — | **No** |
| 15 | Chat ended | 13:03:06.296 | +28.7s | Yes — `USER_ENDED` after ~20s of post-greeting silence |

Related recent chats:

- `bfda…f105` (12:44Z, config v2): same pattern — `"Hello?"` then no `USER_MESSAGE`, end ~14s later. Aligns with outbound Call `87a0…12cb` stuck `RINGING` (Twilio status still `queued` / never answered in AiraDesk).
- `dd8a…6c82` (12:53Z, config v3): speech **was** detected; agent continued without a context tool call. Responses were warm but longer than the new brevity target (~1.7s first reply after user “Hello?”; ~3.5s after a longer user turn).
- `5a1a…7a6f` (12:40Z): user said “Bye.”; builtin `hang_up` fired (not a custom tool webhook).

### Classification

| Code | Hypothesis | Verdict for chat `96f0…b2f5` |
|------|------------|------------------------------|
| **A** | Caller speech not detected | **Primary** — no `USER_MESSAGE` after greeting |
| B | Tool-call deadlock | No — no `FUNCTION_CALL` / tool webhook |
| C | Chat-mapping race | Contributing systemic gap — webhooks never reached AiraDesk |
| D | Tool execution failure | No |
| E | Control Plane failure | No (no tool response required) |
| F | LLM / provider error | No evidence in chat events |
| G | Paused assistant | No |
| **H** | Prompt logic failure | **Contributing** — prompt forbade silence fill / “are you there?” check-ins |
| I | Call ended early | Chat stayed open ~20s after greeting, then ended |

### Root cause (verified)

1. **Primary:** After the scripted `"Hello?"`, Hume recorded **no user transcription**. The assistant therefore never entered a second LLM turn.
2. **Contributing:** Canonical prompt instructed the model **not** to fill silence or check whether the caller was present, and remote `on_inactivity_timeout` was **disabled**. With no user turn and no inactivity message, Kora stayed silent until the chat ended.
3. **Systemic:** The configured webhook destination (`*.ngrok-free.dev`) returned **HTTP 404** during inspection. Consequently:
   - no real `chat_started` / `tool_call` / `chat_ended` receipts
   - zero `HumeToolCallReceipt` rows
   - zero Calls with `humeChatId`
   - if a `response_required` custom tool had fired, EVI would wait indefinitely (tool deadlock risk)

**Not** the primary cause of this specific stall: prompt length alone, Control Plane delivery, or GPT-4o unavailability.

Speech-detection note: other chats on the same day show successful `USER_MESSAGE` transcripts, so telephony audio can work. For this stall, quiet / missed speech is the evidenced failure mode → tune `speech_detection_threshold` to **0.45** (false-activation tradeoff: more noise may be treated as speech).

---

## Webhook acknowledgement vs Tool Response

- HTTP **200** from `/api/webhooks/hume/evi` only means AiraDesk **received** the signed webhook.
- For `tool_call` with `response_required: true`, EVI remains blocked until AiraDesk sends a Control Plane message to  
  `POST /v0/evi/chat/:chat_id/send` with the **exact** `tool_call_id`:
  - `type: "tool_response"` + bounded `content`, or
  - `type: "tool_error"` + bounded `content`
- Duplicate webhooks must **not** re-run CRM mutations; they **may** safely retry undelivered Control Plane responses.

## Control Plane flow

1. Verify signature → persist webhook receipt (idempotent).
2. Resolve Call via `humeChatId` or verified Twilio Call SID (+ config / tenant checks).
3. Persist tool receipt; execute business logic **once**.
4. Send Tool Response / Tool Error with timeouts + bounded retries.
5. Persist delivery timestamps / attempt count / final state.

## Race handling

`tool_call` may arrive before `chat_started` finishes. Resolver order:

1. Existing `chatId → Call`
2. Else verified Twilio Call SID from Hume Twilio metadata
3. Verify Hume config ID and company scope
4. Attach chat / chat-group IDs transactionally
5. Never resolve by phone-only, name-only, “latest Call”, or model-supplied Call ID

## Context prewarming

On verified `chat_started` correlation, asynchronously precompute `buildAiradeskCallContext` into a short-TTL, tenant-scoped DB cache. `airadesk_get_call_context` reads the cache first, falls back to the DB builder, and hard-times out (≤1.5s) with Tool Error + generic discovery fallback so Kora never waits silently.

## Latency targets (observability)

| Stage | Target |
|-------|--------|
| Context tool business execution | typically &lt;300ms; hard ≤1.5s |
| Tool webhook → Control Plane acceptance | typically &lt;750ms; hard stall ≤2s |
| User turn end → first assistant output | &lt;2s when provider permits |
| Unexplained silence | none &gt;3s (prompt + inactivity recovery) |

## Troubleshooting

### Agent says “Hello?” and stops

1. Open Hume chat events; confirm whether a `USER_MESSAGE` exists after the greeting.
2. If none → speech detection / audio / inactivity recovery (category A/H).
3. If `USER_MESSAGE` exists and a `FUNCTION_CALL` / tool webhook exists without Tool Response → category B/E; run `npm run hume:reconcile-tool-responses -- --dry-run`.
4. Confirm webhook host is reachable and signatures verify; check `HumeWebhookReceipt` for the chat id.

### Slow response start

Check turn detection (`end_of_turn_silence_ms`, `prefix_padding_ms`), prompt size, and tool-blocking before first reply.

### Slow spoken pace

Prompt VOICE AND RESPONSE STYLE (brisk pace, ≤~25 words, one question). No unsupported TTS rate params are encoded.

### Inspect Hume chat events safely

Use the API with redaction: never log full phone numbers, complete SIDs, private notes, full tool payloads, or recording URLs.

### Roll back Hume config version

Create a new config version from a prior known-good prompt/settings via `npm run hume:configure`, or pin the previous prompt version id in the Hume dashboard. Config **ID** stays stable; only the version number changes.

## Operational prerequisite

Webhook URL reachability is required for chat mapping and custom tools. A 404/offline tunnel explains missing Call↔chat correlation even when Twilio↔Hume audio works.
