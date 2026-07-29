## Scheduling truthfulness rule

- The agent must only confirm a meeting after a successful `airadesk_schedule_meeting` tool response.
- `tool_call` webhook acknowledgement and `FUNCTION_CALL` chat events do not mean booking success.
- Prompt variable `{{now}}` must be present so relative dates are resolved from current runtime context.
# Hume EVI Setup (Twilio Telephony + AiraDesk CRM)

## Required Environment Variables
- `HUME_API_KEY`
- `HUME_CONFIG_ID`
- `HUME_WEBHOOK_SIGNING_KEY`
- `HUME_API_BASE_URL` (`https://api.hume.ai`)
- `HUME_WEBHOOK_PUBLIC_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `PUBLIC_WEBHOOK_URL`
- `VOICE_COMPANY_ID`
- `HUME_TOOL_EXECUTION_TIMEOUT_MS` (default `1500`)
- `HUME_CONTROL_PLANE_TIMEOUT_MS` (default `1500`)
- `HUME_TOOL_DELIVERY_MAX_ATTEMPTS` (default `3`)
- `HUME_TOOL_DELIVERY_RETRY_BASE_MS` (default `200`)
- `HUME_CONTEXT_CACHE_TTL_SECONDS` (default `120`)

## Where Values Come From
- Hume keys/config from Hume dashboard (EVI config + API keys).
- Twilio credentials from Twilio Console.
- Public webhook URL from production domain or tunnel.
- `VOICE_COMPANY_ID` from AiraDesk `Company.id` for inbound fail-closed tenant mapping.

## Hume Data Retention
- Enable data retention in Hume for:
  - chat history
  - expression measurements
  - audio reconstruction

## Webhook Configuration
- URL: `https://<backend-domain>/api/webhooks/hume/evi`
- Required events:
  - `chat_started`
  - `chat_ended`
  - `tool_call`

## Required Tool Names and Schemas

Backend Zod validators in `backend/src/integrations/hume/humeToolSchemas.ts` are the source of truth.

### `airadesk_get_call_context`
No required params. Must not accept tenant/database identifiers.

```json
{
  "type": "object",
  "required": [],
  "properties": {}
}
```

### `airadesk_capture_lead_details`
All fields optional:

- `fullName?`, `businessType?`, `requiredServices?[]`, `requirementSummary?`, `budget?`, `timeline?`, `preferredLanguage?`, `preferredMeetingTime?`, `additionalNotes?`

### `airadesk_schedule_meeting`
Required:

- `preferredTimeText` (string): caller's stated date/time wording, verbatim. Do not invent an exact calendar date/time when ambiguous; ask for clarification.

Optional:

- `timezone?`, `purpose?`, `notes?`

Must not accept: `companyId`, `tenantId`, `callId`, `customerId`, `assignedUserId`.

```json
{
  "type": "object",
  "required": ["preferredTimeText"],
  "properties": {
    "preferredTimeText": {
      "type": "string",
      "description": "The date and time the caller stated, in their own words (for example next Tuesday at 3pm or tomorrow morning). Pass their wording verbatim. Do not invent or assume a specific calendar date or time when the request is ambiguous; ask the caller to clarify first."
    },
    "timezone": {
      "type": "string",
      "description": "Optional IANA timezone if the caller mentioned one."
    },
    "purpose": {
      "type": "string",
      "description": "Optional purpose or topic for the meeting."
    },
    "notes": {
      "type": "string",
      "description": "Optional additional notes about the meeting request."
    }
  }
}
```

Ambiguous times: backend parses `preferredTimeText` with `new Date(...)`. If parsing fails, the tool response returns `needsClarification: true` and the agent should ask the caller for a clearer date/time.

### `airadesk_request_human_handoff`
Required:

- `reason` (string)
- `urgency` (string): free-form caller wording, **not** a fixed enum

Optional:

- `notes?`

Must not accept: `companyId`, `tenantId`, `callId`, `customerId`, `userId`, assignee identifiers.

```json
{
  "type": "object",
  "required": ["reason", "urgency"],
  "properties": {
    "reason": {
      "type": "string",
      "description": "Why the caller needs a human agent."
    },
    "urgency": {
      "type": "string",
      "description": "How urgent the handoff is, in the callers own words (for example need someone today or whenever available). Capture what the caller said; there is no fixed enum."
    },
    "notes": {
      "type": "string",
      "description": "Optional extra context for the human agent."
    }
  }
}
```

Hume Platform tip: keep parameter schemas to the documented subset (`type`, `properties`, `required`, `description`, `enum`, `items`). Extra keywords such as `additionalProperties` or `minLength` can make the website editor show **Invalid JSON** even though the API accepts them.
## Configure and Validate Scripts

```bash
cd backend
npm run hume:configure -- --dry-run
npm run hume:configure -- --apply
npm run hume:validate-config
```

Dry-run/apply must report prompt metadata only (version/checksum change and preservation checks), without printing secrets or tenant private data.
If dry-run shows unrelated config drift (voice, model, tools, webhook, latency settings, or retention metadata), block apply and resolve the drift first.

## Config vs Prompt Version Fields

`npm run hume:validate-config` reports these separately:

| Field | Meaning |
| --- | --- |
| `humeConfigId` | Redacted active EVI config identifier |
| `humeConfigVersion` | Remote EVI **configuration** revision (for example `2`) |
| `humePromptId` | Redacted prompt resource identifier attached to the config |
| `humePromptRemoteVersion` | Remote **prompt** revision on Hume (for example `1`) |
| `localCanonicalPromptVersion` | Repository canonical prompt label (for example `2026-07-28.1`) |
| `localCanonicalPromptChecksum` / `remotePromptChecksum` | Canonical prompt integrity check |

Do not describe `humePromptRemoteVersion` or `localCanonicalPromptVersion` as "config version". A low config revision after migration does not imply prompt regression when checksums match.

## Canonical Prompt Source

- Source of truth: `backend/src/integrations/hume/humeSystemPrompt.ts`
- Active version: `2026-07-29.8`
- Character count (normalized): `6886` (must remain `< 7000`)
- UTF-8 byte count (normalized): `6968`
- SHA-256 checksum (canonical normalization): `18ca864f451f8fa3e3fe4eb3dc1c40ca3ff3de7c6f89ba94c8fef7b7b7d89bbd`
- Exports:
  - `HUME_SYSTEM_PROMPT_TEXT`
  - `HUME_SYSTEM_PROMPT_VERSION`
  - `HUME_SYSTEM_PROMPT_CHECKSUM`
  - `HUME_SYSTEM_PROMPT_CHAR_COUNT`
- Hard fail when prompt reaches or exceeds 7,000 characters.
- Target: under 6,500 characters. Current concise prompt starts with **VOICE AND RESPONSE STYLE** (brisk pace, ~25 spoken words, one question per turn).
- The prompt is global behavior only. Company details and call objectives are injected dynamically via `airadesk_get_call_context`.
- Do not hardcode tenant company names or customer data in this global prompt.

## Prompt Responsibilities vs Call Objective

- Global prompt controls: identity/disclosure, opening/turn-taking, safety, tool sequencing, opt-out behavior, non-deception, hang-up policy, silence recovery, and tool-failure fallback.
- Call objective controls: `collectionGoal`, `callPurpose`, `extraNotes`, language, schedule details.
- Changing one scheduled call objective must not require global prompt edits.
- Dashboard **"What should AI collect"** only applies to **scheduled outbound** tasks. Direct inbound calls to the Twilio number use inbound discovery context from `airadesk_get_call_context` (or a soft company fallback if chat mapping is still linking).
- The agent must keep speaking if context is delayed; it must not go silent waiting on tools.
- One allowed silence check-in: "Hello, are you there?" — do not repeat.

## Tool Response vs Webhook Acknowledgement

- HTTP 200 from `/api/webhooks/hume/evi` only acknowledges receipt.
- `response_required: true` custom tools must send Control Plane `tool_response` or `tool_error` to `/v0/evi/chat/:chat_id/send` with the exact `tool_call_id`.
- Canonical dispatcher: `backend/src/integrations/hume/humeToolDispatcher.service.ts`
- Delivery metadata lives on `HumeToolCallReceipt` (attempts, timestamps, bounded `responsePayload`).
- Reconcile undelivered results: `npm run hume:reconcile-tool-responses -- --dry-run` (default) / `--apply`.

## Context Prewarming

- On verified `chat_started`, AiraDesk asynchronously prewarms `buildAiradeskCallContext` into tenant-scoped `HumeCallContextCache` (short TTL).
- `airadesk_get_call_context` prefers cache, falls back to DB builder, and times out ≤1.5s with Tool Error + discovery fallback.

## Latency / Turn Settings (configure targets)

Applied via `npm run hume:configure` without changing config ID, voice (Kora), model (GPT-4o), tools, or webhook URL:

| Setting | Target |
|---------|--------|
| `turn_detection.end_of_turn_silence_ms` | 500 |
| `turn_detection.prefix_padding_ms` | 300 |
| `turn_detection.speech_detection_threshold` | 0.45 (tuned after missed-speech stall; more false activations possible) |
| `interruption.min_interruption_ms` | 300 |
| `ellm_model.allow_short_responses` | true |
| `timeouts.inactivity.duration_secs` | 30 (Hume API minimum; 12–15s not supported) |
| `event_messages.on_inactivity_timeout` | "Hello, are you still there?" |
| `event_messages.on_new_chat` | "Hello?" |

GPT-4o is intentionally unchanged. Faster model candidates are documented only in `humeLanguageModel.ts`.

## Troubleshooting “Hello?” then silence

See `docs/integrations/HUME_RESPONSE_LATENCY_AND_STALLS.md` for the verified event timeline and root-cause matrix.

Operational prerequisite: the public webhook host must be reachable. A 404/offline tunnel leaves Calls without `humeChatId` and prevents custom-tool completion.

## Hume Data Retention Confirmation

Hume does not expose data retention through the validation API. After confirming retention is ON in the Hume dashboard, set:

`HUME_DATA_RETENTION_USER_CONFIRMED=true`

The validator reports `dataRetention: USER_CONFIRMED_ON` when this operational flag is set.

## Built-in hang_up
- Enable Hume built-in `hang_up` tool in the same EVI configuration.
- After scheduling success, prompt policy must enforce one brief closing then immediate `hang_up` (no extra question / no wait for goodbye).

## Post-meeting fallback guardrails

- Prompt-only hang-up is not a sufficient production guarantee.
- Backend fallback watchdog (`callTermination.service.ts`) enforces bounded exact-call closure using the exact Twilio Call SID when Hume does not end the call in time.
- Recommended defaults:
  - `POST_MEETING_HANGUP_GRACE_MS=10000`
  - `POST_MEETING_HANGUP_MAX_ATTEMPTS=2`
  - `POST_MEETING_HANGUP_RETRY_MS=2000`

## Twilio Configuration
- Inbound number voice webhook must be:
  - `https://api.hume.ai/v0/evi/twilio?config_id=<HUME_CONFIG_ID>&api_key=<HUME_API_KEY>`
- Outbound calls from AiraDesk use the same Hume Twilio URL via Twilio Calls API.
- Keep Twilio status callback pointed to:
  - `POST /api/voice/twilio/status`

## Recording Behavior
- New Hume calls: recording source is Hume reconstructed audio.
- Historical calls: Twilio recording proxy remains supported.
- Frontend must handle "Recording is being prepared" during Hume reconstruction.

## Transcript Sync Behavior
- On `chat_ended`: persist lifecycle, finalize Call/Task, enqueue sync job, return 200 quickly.
- See `docs/integrations/CALL_LIFECYCLE_AND_TASK_SYNC.md` for Call/Task terminalization rules.
- Worker fetches paginated Hume events, persists transcript messages idempotently, updates `Call.transcript`.

## Expression vs Lead Intent
- Existing lead intent/score continues from post-call analyzer.
- Hume expression data is stored separately and never overwrites business intent score.

## Language Status
- English: supported path implemented.
- Hindi: supported path implemented.
- Gujarati: requires live validation against active Hume config and chosen voice/model before production claim.

## Local Tunnel
- Use ngrok or equivalent and set:
  - `PUBLIC_WEBHOOK_URL`
  - `HUME_WEBHOOK_PUBLIC_URL`

## Manual Test Matrix
- Inbound/outbound English, Hindi.
- Gujarati only if explicitly verified on live config.
- Caller interrupt, caller hang-up, AI hang-up.
- Busy/no-answer/failed statuses.
- Duplicate webhook idempotency and invalid signature rejection.

## Security Notes
- Never expose `HUME_API_KEY` or `HUME_WEBHOOK_SIGNING_KEY` to frontend.
- Verify HMAC signature and webhook timestamp.
- Redact sensitive URL query params in logs.

## Rollback
1. Repoint Twilio number away from Hume if required.
2. Deploy previous application version.
3. Keep additive Hume DB tables/columns; do not drop them during rollback.
4. Do not silently restore ElevenLabs runtime without explicit approval.
