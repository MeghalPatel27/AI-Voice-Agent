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
- Exports:
  - `HUME_SYSTEM_PROMPT_TEXT`
  - `HUME_SYSTEM_PROMPT_VERSION`
  - `HUME_SYSTEM_PROMPT_CHECKSUM`
- The prompt is global behavior only. Company details and call objectives are injected dynamically via `airadesk_get_call_context`.
- Do not hardcode tenant company names or customer data in this global prompt.

## Prompt Responsibilities vs Call Objective

- Global prompt controls: identity/disclosure, safety, tool sequencing, opt-out behavior, non-deception, and hang-up policy.
- Call objective controls: `collectionGoal`, `callPurpose`, `extraNotes`, language, schedule details.
- Changing one scheduled call objective must not require global prompt edits.

## Hume Data Retention Confirmation

Hume does not expose data retention through the validation API. After confirming retention is ON in the Hume dashboard, set:

`HUME_DATA_RETENTION_USER_CONFIRMED=true`

The validator reports `dataRetention: USER_CONFIRMED_ON` when this operational flag is set.

## Built-in hang_up
- Enable Hume built-in `hang_up` tool in the same EVI configuration.

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
