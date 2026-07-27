# Live Hume + Twilio Validation Guide

## Preflight checklist

- [ ] `node -v` reports v24.x
- [ ] Backend `.env` and frontend `.env` are local only (not tracked)
- [ ] `PUBLIC_WEBHOOK_URL` points to the active ngrok tunnel
- [ ] `TWILIO_AUTH_TOKEN` and `HUME_WEBHOOK_SIGNING_KEY` are configured
- [ ] Unsigned Twilio callbacks return HTTP 401/403
- [ ] Unsigned Hume webhooks return HTTP 401
- [ ] `npm run hume:validate-config` passes
- [ ] `npm run twilio:validate-config` passes
- [ ] Hume data retention confirmed in the Hume dashboard
- [ ] Frontend auth session remains stable on Settings navigation

## Twilio signature validation

All Twilio-originated routes under `/api/voice/twilio/*` (except authenticated app routes) require `X-Twilio-Signature`.

Validation uses the official Twilio SDK with:

- `TWILIO_AUTH_TOKEN`
- canonical callback URL: `PUBLIC_WEBHOOK_URL + req.originalUrl`
- all received form parameters

Generate a safe synthetic request:

```bash
cd backend
npm run twilio:verify-webhook
```

## Hume signature validation

Hume webhooks are mounted before `express.json()` with raw body capture.

Signature message:

```text
${timestamp}.${rawBody}
```

Headers:

- `X-Hume-AI-Webhook-Signature`
- `X-Hume-AI-Webhook-Timestamp`

Replay window: 180 seconds.

## Hume config validation

```bash
cd backend
npm run hume:validate-config
```

Required webhook destination (redacted host only in reports):

`/api/webhooks/hume/evi`

Required events:

- `chat_started`
- `chat_ended`
- `tool_call`

Required custom tools:

- `airadesk_get_call_context`
- `airadesk_capture_lead_details`
- `airadesk_schedule_meeting`
- `airadesk_request_human_handoff`

Built-in requirement:

- `hang_up` enabled

Remote mutation requires an explicit `--apply` flag and a reviewed patch script.

## Twilio config validation

```bash
cd backend
npm run twilio:validate-config
```

Verify:

- phone number exists
- voice URL points to Hume `/v0/evi/twilio`
- `config_id` matches `HUME_CONFIG_ID`
- voice method is `POST`
- status callback is `PUBLIC_WEBHOOK_URL/api/voice/twilio/status`
- legacy AiraDesk incoming route is not active

## Data retention confirmation

**DATA RETENTION: USER DASHBOARD CONFIRMATION REQUIRED**

Confirm in the Hume portal that chat history, expression measurements, and audio reconstruction retention are enabled for production voice calls.

## AI disclosure requirement

The agent must clearly state it is an AI at the start of every live call.

## Inbound test script

1. Call the configured Twilio number.
2. Confirm the agent clearly states it is an AI.
3. Provide clearly marked test requirements (services, budget, timeline, language).
4. Interrupt once to verify turn-taking.
5. Request a meeting at an exact future date/time (at least 24 hours ahead).
6. Ask the agent to repeat the confirmed meeting time.
7. End naturally or disconnect.

## Outbound test safety gate

Outbound live tests require all of:

- `NODE_ENV=development`
- `LIVE_E2E_CALL_TESTS=true`
- `LIVE_TEST_CONSENT_CONFIRMED=true`
- `LIVE_TEST_RECIPIENT` set to a valid E.164 test number

Never call production customers automatically.

## Database verification queries

Use company-scoped queries only. Redact phone numbers, chat IDs, and call SIDs in reports.

- `Call` created once with `direction=INBOUND`, `telephonyProvider=TWILIO`, `voiceAgentProvider=HUME_EVI`
- `Conversation` finalized under the correct `companyId`
- `HumeToolCallReceipt` idempotent per `tool_call_id`
- `HumeChatSyncJob` created for transcript sync
- `CallPostAnalysis` and `HumeExpressionAnalysis` populated asynchronously
- `Booking` linked to call without silent reassignment side effects

## Expected worker states

- Hume sync worker: `healthy` when enabled and schema is present
- Post-call analysis worker: enabled unless explicitly disabled
- Recording reconstruction: `QUEUED` → `IN_PROGRESS` → `COMPLETE` or explicit `ERROR`

## Transcript verification

- Sync job created once
- User/agent messages ordered
- System prompts and tool JSON excluded
- Retries remain idempotent

## Expression verification

- Stored separately from business intent
- UI labels them as Hume conversation insights

## Recording verification

- Signed playback URLs are never persisted as permanent `recordingUrl`
- Authenticated media proxy remains company-scoped
- Transcript failure must not erase recording state and vice versa

## Call/Meetings UI verification

- Call owner and meeting owner shown separately when different
- Assignment control visible to authorized roles
- Meeting acceptance remains on booking workflow

## Redaction rules

Never print:

- provider API keys or auth tokens
- complete Hume Twilio URL
- customer phone numbers (mask to last four digits)
- transcripts
- signed recording URLs
- JWTs

## Failure troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Unsigned Twilio callback returns 204 | Twilio middleware not mounted |
| Hume webhook 401 | Clock skew, wrong signing key, or body parser order |
| No transcript | Retention disabled or sync worker unhealthy |
| No recording | Reconstruction still pending or retention disabled |
| Settings login bounce | Auth still hydrating; verify `AuthStatus` lifecycle |

## Rollback instructions

1. Revert Twilio phone number to previous safe handler only if live traffic must be stopped immediately.
2. Disable ngrok tunnel to stop remote webhook delivery.
3. Set `HUME_SYNC_WORKER_ENABLED=false` and `POST_CALL_ANALYSIS_WORKER_ENABLED=false` if workers must be paused.
4. Redeploy previous backend build if signature validation regression is suspected.
5. Do not delete production call data during rollback.
