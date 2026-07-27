# HUME EVI Migration Audit

## Baseline Call Flow (Before)
- Inbound: `Twilio webhook -> /api/voice/twilio/incoming -> <Connect><Stream> -> /api/voice/twilio/realtime WebSocket -> OpenAI Realtime -> optional ElevenLabs -> Twilio playback`.
- Outbound: `CRM request -> /api/calls/outbound-ai -> Twilio call -> /api/voice/twilio/outbound-answer -> /api/voice/twilio/realtime`.
- Status and recording: Twilio status callback and Twilio recording callback populate `Call`.
- CRM completion: `callFinalization.service.ts` + `postCallAnalysisWorker.service.ts`.

## Target Call Flow (After)
- Inbound: `Twilio number -> Hume /v0/evi/twilio -> signed Hume webhook -> AiraDesk persistence -> async sync worker`.
- Outbound: `CRM request -> Twilio Calls API Url points to Hume /v0/evi/twilio -> Twilio status callbacks + Hume webhooks`.
- Transcript/expression/recording: Async Hume chat sync + recording reconstruction proxy endpoint.

## Old-to-New Component Mapping
- `voice.controller.ts` realtime bridge -> replaced by `integrations/hume/*` + `integrations/twilio/*` + `voiceHume.controller.ts`.
- `/api/voice/twilio/realtime` WebSocket runtime -> removed from active server wiring.
- OpenAI realtime client-secret route -> removed from route registration.
- Twilio recording callback path kept for historical Twilio recordings.

## Files To Retain
- `callFinalization.service.ts`
- `postCallAnalysis.service.ts`
- `postCallAnalysisWorker.service.ts`
- existing CRM controllers/routes/services for non-voice channels
- historical Twilio recording support

## Files To Delete (Post-cutover cleanup)
- `backend/src/controllers/voice.controller.ts` (after final compile-safe removal)
- `backend/src/voice/elevenlabsTts.ts`
- `backend/src/voice/elevenlabsWsTts.ts`
- remaining unused `backend/src/voice/*` realtime bridge files

## Database Changes (Additive)
- Added provider-separation enums and fields on `Call`.
- Added webhook idempotency table, tool-call idempotency table, chat sync jobs, and expression analysis table.
- No destructive column/table removals included in this migration.

## Configuration Changes
- Added required server-only Hume env contract:
  - `HUME_API_KEY`
  - `HUME_CONFIG_ID`
  - `HUME_WEBHOOK_SIGNING_KEY`
  - `HUME_API_BASE_URL`
  - `HUME_WEBHOOK_PUBLIC_URL`
  - `VOICE_COMPANY_ID`
- Added explicit Twilio/Hume URL constructor in `hume.config.ts`.

## Live Setup Steps
1. Configure Hume EVI config (version 3) with `chat_started`, `chat_ended`, `tool_call` webhooks.
2. Set Twilio inbound voice webhook to Hume endpoint generated from config/api key.
3. Set backend webhook endpoint: `/api/webhooks/hume/evi`.
4. Keep Twilio status callback configured to backend `/api/voice/twilio/status`.

## Verified Limitations / Blockers
- Gujarati support cannot be claimed from repository code alone; requires validated Hume config/voice behavior in live calls.
- Supabase live schema audit requires safe non-production DB access; repository-only analysis cannot prove RLS/policies/functions/triggers state.
- Full dead-code deletion from legacy `voice.controller.ts` is pending final compile-safe cleanup pass.
