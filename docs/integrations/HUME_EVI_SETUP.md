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
  "additionalProperties": false,
  "required": [],
  "properties": {}
}
```

### `airadesk_capture_lead_details`
All fields optional:

- `fullName?`, `businessType?`, `requiredServices?[]`, `requirementSummary?`, `budget?`, `timeline?`, `preferredLanguage?`, `preferredMeetingTime?`, `additionalNotes?`

### `airadesk_schedule_meeting`
Required:

- `preferredTimeText` (string, minLength 1): caller's stated date/time wording, verbatim. Do not invent an exact calendar date/time when ambiguous; ask for clarification.

Optional:

- `timezone?`, `purpose?`, `notes?`

Must not accept: `companyId`, `tenantId`, `callId`, `customerId`, `assignedUserId`.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["preferredTimeText"],
  "properties": {
    "preferredTimeText": {
      "type": "string",
      "minLength": 1,
      "description": "The date and time the caller stated, in their own words (for example 'next Tuesday at 3pm' or 'tomorrow morning'). Pass their wording verbatim. Do not invent or assume a specific calendar date or time when the request is ambiguous; ask the caller to clarify first."
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

- `reason` (string, minLength 1)
- `urgency` (string, minLength 1): free-form caller wording, **not** a fixed enum

Optional:

- `notes?`

Must not accept: `companyId`, `tenantId`, `callId`, `customerId`, `userId`, assignee identifiers.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["reason", "urgency"],
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1,
      "description": "Why the caller needs a human agent."
    },
    "urgency": {
      "type": "string",
      "minLength": 1,
      "description": "How urgent the handoff is, in the caller's own words (for example 'need someone today' or 'whenever available'). Capture what the caller said; there is no fixed enum."
    },
    "notes": {
      "type": "string",
      "description": "Optional extra context for the human agent."
    }
  }
}
```

## Configure and Validate Scripts

```bash
cd backend
npm run hume:configure -- --dry-run
npm run hume:configure -- --apply
npm run hume:validate-config
```

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
- On `chat_ended`: persist lifecycle + enqueue sync job + return 200 quickly.
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
