# Frontend Stabilization Audit

Date: 2026-07-27  
Scope: AiraDesk frontend production-stabilization and Calls/Meetings UI pass  
Node: v24.18.0 (`/opt/homebrew/opt/node@24`)  
Package: `AI/` (Vite + React 19 + TypeScript 5.9)

## Baseline commands

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
cd AI
npm install
npm run lint
npm run build
```

## Baseline results

| Check | Result |
|-------|--------|
| `npm run lint` | **54 errors**, **19 warnings** |
| `npm run build` | **Failed** (`tsc -b`) — 42 diagnostics |

### TypeScript build counts

| Code | Count | Meaning |
|------|------:|---------|
| TS1484 | 18 | Type imported as value under `verbatimModuleSyntax` |
| TS6133 | 24 | Unused locals / imports (`noUnusedLocals`) |
| Other | 0 | — |

### ESLint counts (by rule)

| Rule | Count | Notes |
|------|------:|-------|
| `@typescript-eslint/no-unused-vars` | 24 | Unused imports/helpers |
| `react-hooks/exhaustive-deps` | 19 | Missing deps on loaders / sync effects |
| `react-hooks/set-state-in-effect` | 18 | Sync `setState` in effects (fetch kickoff + draft sync) |
| `@typescript-eslint/no-explicit-any` | 11 | API helpers, settings metadata, call metadata |

### Other failure classes observed

| Class | Approx. | Notes |
|-------|--------:|-------|
| Unsafe state initialization | several | Draft forms synced from selection via effect |
| Incorrect / incomplete API typing | Calls/Meetings | Missing acceptance, post-call analysis, Hume types |
| Unreachable / stale copy | Calls | Mentions OpenAI Realtime / Twilio-only recording |
| Invalid JSX/React patterns | 0 hard build breaks | Hook architecture issues only |

### Calls / Meetings relevance

| File | In Calls/Meetings? | Failure type |
|------|--------------------|--------------|
| `src/calls.tsx` | Yes | TS1484, explicit `any`, incomplete UI contract |
| `src/bookings.tsx` | Yes | TS1484, incomplete acceptance/outcome UI |
| `src/lib/api.ts` | Shared | explicit `any` |
| `src/lib/postCallAnalysis.ts` | Shared | Present; underused by Calls page |
| `src/inbox.tsx` | Related | Hook deps; already has Hume/recording patterns |
| Remaining pages | No | Mechanical TS/lint + hook architecture |

Routing note at baseline: `/calls` redirected to Inbox and `/bookings` redirected to Leads, so dedicated Calls/Meetings pages were not reachable from nav.

## TypeScript architecture decision

Keep a coherent **Vite ESM + bundler** configuration:

- `package.json` → `"type": "module"`
- `module`: `ESNext`
- `moduleResolution`: `bundler`
- `verbatimModuleSyntax`: **enabled** (do not weaken)
- `strict` / `noUnusedLocals` / `noUnusedParameters`: **keep**

Correction strategy: convert type-only symbols to `import type { … }`; remove unused imports; do not switch to CommonJS; do not disable `verbatimModuleSyntax`.

## Planned correction strategy

1. **Module contract** — Fix TS1484 with targeted `import type`; leave runtime imports unchanged.
2. **Unused symbols** — Remove unused Lucide icons and helpers (TS6133 / no-unused-vars).
3. **API contracts** — Add typed Call / Booking / PostCallAnalysis / HumeExpressionAnalysis DTOs; remove `any` from those surfaces. Backend call detail must include `postAnalysis` serialized as `postCallAnalysis`.
4. **Hooks** — Replace draft-sync effects with keyed editors or selection-time init; keep async fetch effects with abort/stale guards; avoid sync `setState` at effect entry by starting from correct initial loading state.
5. **Calls UI** — Complete detail: ownership, requirements chips, business intent, separate Hume insights, recording states, collapsed transcript.
6. **Meetings UI** — List + detail with acceptance, outcome, proposal, related call link; wire dedicated nav routes.
7. **Tests** — Add Vitest + Testing Library focused coverage for Calls/Meetings.
8. **Verify** — `lint` 0 errors, `build` success, backend typecheck/tests/build green; no real Twilio/Hume calls.

## Final verification (2026-07-27, Node v24.18.0)

| Check | Result |
|-------|--------|
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **successful** |
| `npm test` (Vitest) | **15/15 passed** |
| Backend `typecheck` | **0 errors** |
| Backend `npm test` | **40 passed** (schema integration 21 skipped without dedicated env gate in this run) |
| Backend `npm run build` | **successful** |

No real Twilio/Hume calls were placed.
