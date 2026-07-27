# Voice Performance Test Suite

Production validation profiler for the realtime voice engine.

**Measure first. Do not optimise blindly.**

## What it measures

| # | Metric |
|---|---|
| 1 | Commit → First OpenAI Delta |
| 2 | Commit → First ElevenLabs Byte |
| 3 | Commit → First Twilio Audio |
| 4 | End-to-End First Audio Latency |
| 5 | Playback Completion |
| 6 | Average latency across a 10-minute call |
| 7 | Average latency across 100 turns |
| 8 | Barge-in response time |
| 9 | Dropped audio packets |
| 10 | Cancelled responses |
| 11 | WebSocket reconnects / transport recoveries |
| 12 | Twilio playback buffer depth |
| 13 | CPU usage during active calls |
| 14 | Memory usage over long conversations |
| 15 | Event loop blocking time |

## Live calls

Enabled by default on every Twilio Media Stream session. After each call ends:

1. Structured log: `voice_performance_summary`
2. JSON report: `backend/voice-perf-reports/voice-perf-<callSid>-<timestamp>.json`

Each call is graded:

- **Excellent** — avg commit→first-audio ≤ 450ms and health counters clean
- **Good** — within the 800ms budget but not Excellent
- **Needs Improvement** — over budget, or packet/reconnect/event-loop thresholds exceeded

When commit→first-audio exceeds **800ms**, the suite identifies the slowest critical-path stage (OpenAI first token, ElevenLabs first byte, Twilio send, etc.).

### Env knobs

| Variable | Default | Purpose |
|---|---|---|
| `VOICE_PERF_SUITE_ENABLED` | `true` | Master switch |
| `VOICE_PERF_REPORTS_ENABLED` | `true` | Write JSON report files |
| `VOICE_PERF_REPORT_DIR` | `./voice-perf-reports` | Report output directory |

## Offline harness

Validates grading + bottleneck logic without Twilio/CRM:

```bash
cd backend && npm run voice:perf
```

## Scope

- Does **not** change CRM writes, lead/meeting logic, or call business rules
- Hooks only the voice hot path (latency marks, playback, barge-in, sockets)
