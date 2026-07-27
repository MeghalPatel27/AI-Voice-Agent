# Production Readiness Plan

## 1. Current readiness summary

```text
Assessment: Advanced demo / internal prototype — not an external beta or production candidate
```

The repository demonstrates a real multi-tenant CRM shell plus a serious Twilio/OpenAI voice path and WhatsApp Cloud integration code. It is suitable for controlled demos and continued build-out. It is **not** ready for untrusted multi-tenant production traffic because webhook authentication, tenant mapping, RBAC, packaging/CI, tests, observability, and several product workflows (billing, website chat, email, logout UX) are incomplete or unsafe.

| Area | Score | Explanation |
| -------------------- | ----: | ----------- |
| Product completeness | 2 | Core CRM + voice/WA paths exist; billing, website chat, email, several UX affordances missing |
| UI/UX completeness | 3 | Cohesive dark workspace; gaps in logout, search/notifications, a11y, CSV, billing CTAs |
| Backend completeness | 3 | Broad API surface and workers; fat controllers; stubbed/unused paths remain |
| Data integrity | 2 | Good company scoping on JWT APIs; dangerous ingress fallbacks for voice/WA |
| Authentication | 3 | Register/login/JWT work; weak password policy; no verification/refresh/revocation |
| Authorization | 1 | Role checks only on some team/settings mutations; permissions JSON unused as ACL |
| Security | 1 | Missing webhook signatures; tracked FE env; localStorage JWT; no rate limits |
| Testing | 0 | No automated tests found |
| Reliability | 2 | Single-process worker+WS; limited retries; no DR plan |
| Performance | 2 | Voice latency tooling exists; FE/BE build typecheck unhealthy; scale model unclear |
| Observability | 1 | console logs + local voice reports; no APM/alerts |
| Deployment | 1 | No CI/CD/Docker/IaC; incomplete backend package.json |
| Documentation | 3 | Rich but partially stale `PRODUCT.md`; this audit set now provides SoT |

Scores are intentionally conservative and evidence-based.

---

## 2. Production blockers

| ID | Blocker | Severity | User/business impact | Technical impact | Dependencies | Evidence |
| -- | ------- | -------- | -------------------- | ---------------- | ------------ | -------- |
| BLOCKER-001 | Unauthenticated/unsigned Meta WhatsApp inbound webhook + unsafe company fallbacks | Critical | Wrong-tenant chats; forged messages; trust collapse | Data integrity & abuse | Meta app secret; mapping table | `webhook.controller.ts` |
| BLOCKER-002 | Unsigned Twilio voice webhooks / media WS | Critical | Call fraud, TwiML abuse, privacy incidents | Compromised voice plane | Twilio auth token validation | `voice.routes.ts`, voice controller |
| BLOCKER-003 | Inbound voice tenant resolution via env / oldest company | Critical | Cross-tenant call transcripts & CRM writes | Breaks multi-tenancy promise | Number→company DB map | `VOICE_COMPANY_ID` fallback logic |
| BLOCKER-004 | Incomplete RBAC / unenforced permissions | High | Staff can access/admin-like APIs | Privilege abuse within tenant | Role matrix product decision | `auth.middleware.ts`, team/settings only checks |
| BLOCKER-005 | No automated tests + failing FE lint/build + broken BE `tsc` config | High | Cannot safely change voice/CRM code | Ship risk / onboarding failure | Package.json restore; CI | Validation commands 2026-07-24 |
| BLOCKER-006 | Secrets/config hygiene (`AI/.env` tracked; hollow backend manifest; empty root gitignore) | High | Secret leakage / unreproducible deploys | Supply-chain & ops failures | gitignore + example envs | `git ls-files`, `backend/package.json` |
| BLOCKER-007 | Production observability & deployment undefined | High | Silent outages; no rollback discipline | Cannot operate SaaS | Hosting choice; Sentry/metrics | No CI/Docker |
| BLOCKER-008 | WhatsApp default mock mode without prod fail-closed guard | High | “Connected” demos that do not message customers | False confidence | Config policy | `whatsappProviderMode` default `mock` |

---

## 3. Feature completion backlog

| ID | Feature/Task | Current state | Required production behavior | Priority | Complexity | Dependencies | Acceptance criteria |
| -- | ------------ | ------------- | ---------------------------- | -------- | ---------- | ------------ | ------------------- |
| F-001 | Webhook signature verification (Meta + Twilio) | Missing | Reject invalid signatures | P0 | M | Vendor docs, secrets | Forged requests return 401/403; valid traffic accepted |
| F-002 | Strict channel→company routing | Env/fallback | Unique DB mapping; fail closed | P0 | M | F-001, product decision | Unmapped inbound never writes to arbitrary company |
| F-003 | Central RBAC middleware | Partial | Enforce role/permission on every protected route | P0 | L | Role matrix | STAFF denied admin settings; tests prove matrix |
| F-004 | Restore backend package.json + scripts | Broken manifest | Reproducible install/migrate/seed/dev/test | P0 | S | Lockfile | Fresh clone `npm install` works; scripts documented |
| F-005 | Fix FE typecheck/lint; BE ESM/`tsc` | Failing | Green CI gates | P0 | M | F-004 | `lint`, `build`, `tsc --noEmit` pass |
| F-006 | Untrack secrets; `.env.example` files | `AI/.env` tracked | Examples only in git | P0 | S | — | No env secrets tracked; examples list names |
| F-007 | Logout + session lifecycle UX | logout fn only | Visible logout; optional revoke | P0 | S | — | User can end session from shell |
| F-008 | Prod config guards (ban mock WA/voice stubs) | Mock default | Startup/runtime refuse unsafe modes in prod | P0 | S | NODE_ENV | App boots only with required integrations or explicit staging flag |
| F-009 | Self-service password reset / invite email | Missing (EMAIL unused) | Secure invite + reset links | P1 | L | Email provider decision | Invite email received; reset works E2E |
| F-010 | Refresh tokens / shorter access TTL | 7d JWT only | Access+refresh; revocation list | P1 | M | Auth redesign | Stolen access token window reduced |
| F-011 | Rate limiting (auth, webhooks, AI) | Missing | Per-IP/per-tenant limits | P1 | M | Reverse proxy or middleware | Burst abuse mitigated |
| F-012 | Persist AI CEO threads (optional) | Session-only | Stored history with retention | P2 | M | RBAC | User can reopen prior chats |
| F-013 | Website chat ingress | Schema only | Widget + webhook/API | P2 | L | Product scope | Website visitor appears in Inbox |
| F-014 | Email channel | Missing | Or remove dead UI/env | P2 | M | Product scope | Either live or fully removed |
| F-015 | Billing/payments | Honest stub | Processor + invoices or hide UI | P1 | XL | Business model | Revenue metrics real or UI removed from prod |
| F-016 | CSV lead import | Disabled button | Validated import w/ dry-run | P2 | M | — | Import creates customers with errors report |
| F-017 | Header search / notifications | UI only | Global search + in-app notifications | P2 | L | NotificationRule runtime | Search returns entities; bell shows real events |
| F-018 | NotificationRule execution | Stored rules | Deliver via WA/email/SMS/push | P1 | L | Channels | Triggered events notify configured recipients |
| F-019 | HandoffRule enforcement audit | Partial/unverified | Deterministic escalation | P1 | M | AI decision pipeline | Rules covered by tests |
| F-020 | Recording retention & access policy | Proxy exists | TTL, role gates, audit | P1 | M | Legal decision | Access logged; auto-delete works |
| F-021 | Extract outbox worker process | In-process | Separate worker deployable | P1 | M | Queue/locking | API reboot does not require dual duty long-term |
| F-022 | Delete/archive legacy FE modules | Orphaned | Single UI implementation | P3 | S | Parity checklist | No dead pages causing typecheck noise |
| F-023 | Per-company voice branding | Env defaults Kadam | CompanySettings-driven | P1 | M | F-002 | No demo brand leakage across tenants |
| F-024 | Observability baseline | console | Structured logs + error tracking + metrics | P0 | M | Hosting | Errors visible in Sentry; golden signals dashboard |
| F-025 | Staging environment + launch checklist | Missing | Prod-like staging | P0 | L | F-004..F-008 | Staging passes E2E voice+WA smoke |

---

## 4. UI/UX completion plan

Tie work to existing screens:

| Area | Required work | Screens |
| ---- | ------------- | ------- |
| Navigation | Live badge counts; role-aware items; logout control | `landingpage.tsx` |
| Onboarding | Post-register checklist (connect WA/calls, add knowledge, invite team) | Dashboard/Settings |
| Forms | Replace `window.prompt` lead actions with modal forms + Zod-aligned validation | `customers.tsx` |
| Validation | Inline field errors matching backend Zod messages | Auth, Settings, Tasks |
| Loading/empty/error | Standardize component patterns; ensure retry on all pages | All active pages |
| Success states | Toasts instead of ephemeral notice only | Inbox/Tasks/Team/Settings |
| Destructive actions | Confirm delete conversation/task/member with typed confirm where needed | Inbox/Tasks/Team |
| Responsive | Verify chip nav + dense tables on mobile; recording player usability | Inbox especially |
| Accessibility | Labels, focus traps, keyboard nav, contrast audit, `aria-*` | Shell + forms |
| Billing UI | Hide or wire Contact Support | Settings Billing |
| Reports | Real export or remove; remove schedule alert dead-end | `reports.tsx` |
| Mock indicators | Keep DEMO badges in non-prod only | Settings Channels |

---

## 5. Backend and data completion plan

1. **Contracts:** Freeze OpenAPI/Zod shared types for FE/BE critical routes.
2. **Schema:** Formalize number mappings (`TwilioNumber`, `WhatsAppNumber` tables) with unique constraints per company.
3. **Migrations:** Restore npm scripts; require migrate in deploy; ban ad-hoc prod SQL.
4. **Validation:** Ensure all public webhooks validate signatures before parsing side effects.
5. **Transactions:** Review AI action booking/task creation paths for atomicity (`aiAction.service.ts` already transactional in places — extend consistently).
6. **Concurrency:** Outbox row locking / `FOR UPDATE SKIP LOCKED` for multi-worker safety.
7. **Ownership checks:** Every `:id` mutation must `findFirst({ companyId })` (most do — audit leftovers).
8. **Pagination:** Enforce max page sizes on inbox/leads/tasks/reports.
9. **Search:** Server-side search endpoints for shell header.
10. **File/media:** Recording retention job; optional object storage.
11. **Background jobs:** Extract worker; add idempotency keys for Twilio/Meta sends.
12. **Audit:** Expand AuditLog to auth events, exports, recording access, role changes.
13. **Soft delete:** Decide conversation/customer deletion policy vs GDPR erase.
14. **Backup/restore:** Managed Postgres PITR + documented restore drill.

---

## 6. Authentication and authorization plan

| Capability | Production requirement | Current gap |
| ---------- | ---------------------- | ----------- |
| Registration | Keep; add verification email optional/required by plan | No verification |
| Login | Rate-limited; lockout | Missing |
| Logout | UI + server token revoke/blacklist or version bump | UI missing; no revoke |
| Session expiry | Short access token + refresh | 7d access JWT |
| Password reset | Email token flow | Admin reset only |
| Role enforcement | Middleware + tests | Partial |
| Permission checks | Honor `User.permissions` or remove field | Not enforced |
| Protected routes | FE + BE | FE auth only; no role routes |
| Ownership checks | Continue companyId scoping | Mostly present on JWT APIs |
| Admin access | Explicit OWNER/ADMIN settings | Partial |
| Account suspension | Deactivate blocks login | Verify login rejects inactive (**implement if missing**) |
| Account deletion | Tenant offboarding workflow | Missing |
| Client-side-only protection | **Eliminate as sole control** | Header chrome currently irrelevant; main risk is missing BE RBAC |

Explicit: any UI hiding of Settings is insufficient without backend enforcement.

---

## 7. Security remediation plan

| ID | Finding | Severity | Remediation | Verification method |
| -- | ------- | -------- | ----------- | ------------------- |
| SEC-001 | Meta webhook unsigned | Critical | HMAC verify; disable fallback company | Negative tests with bad signature |
| SEC-002 | Twilio webhook unsigned | Critical | `validateRequest` (or equivalent) on all Twilio HTTP | Negative tests |
| SEC-003 | Voice tenant fallback | Critical | DB map; fail closed | Multi-company integration test |
| SEC-004 | WA company fallback | High | Unique phone_number_id map only | Multi-company webhook test |
| SEC-005 | Weak RBAC | High | Central policy module | Authz test matrix |
| SEC-006 | Tracked `AI/.env` | High | Untrack + ignore + rotate if any secret ever present | `git ls-files` clean |
| SEC-007 | localStorage JWT | Medium | CSP, XSS review; cookie session option | Security review |
| SEC-008 | No rate limits | Medium | express-rate-limit / edge limits | Load abuse test |
| SEC-009 | Password policy | Medium | Complexity + breach checks optional | Unit tests |
| SEC-010 | trust proxy | Medium | Explicit hop config | Deploy checklist |
| SEC-011 | Prompt injection / data exfil via AI CEO | Medium | System prompt hardening; redact secrets; role-limit tools | Red-team prompts |
| SEC-012 | Recording media authZ | Medium | Role + company checks + audit | Direct URL access tests |

---

## 8. Testing strategy

### Required layers

* Unit: AI decision rules, tenant mapping, RBAC policy, providers mock/cloud branches
* Component: AuthPage, critical forms
* Integration: API + Prisma test DB
* API: auth, inbox actions, settings, webhooks
* Database: migrations up/down on clean DB
* Authn/Authz: role matrix
* E2E: register → settings → (simulated) inbound → inbox takeover → task
* Accessibility: axe on shell pages
* Performance: voice harness in CI smoke (non-billable mocks)
* Security: signature negative tests
* Smoke: `/health`, login, dashboard load
* Regression: critical journeys on each release

### Test-priority matrix

| Workflow | Unit | Integration | E2E | Security | Priority |
| -------- | ---- | ----------- | --- | -------- | -------- |
| Register/login/me | ✓ | ✓ | ✓ | ✓ | P0 |
| Webhook Meta inbound + signature | ✓ | ✓ | ✓ | ✓ | P0 |
| Twilio signature + tenant map | ✓ | ✓ | ✓ | ✓ | P0 |
| Inbox human reply + WA cloud/mock | ✓ | ✓ | ✓ | ✓ | P0 |
| Schedule AI call task + worker claim | ✓ | ✓ | ○ | ✓ | P0 |
| Team invite RBAC | ✓ | ✓ | ✓ | ✓ | P0 |
| Settings knowledge CRUD | ✓ | ✓ | ○ | ○ | P1 |
| AI CEO snapshot grounding | ✓ | ✓ | ○ | ✓ | P1 |
| Reports aggregates | ✓ | ✓ | ○ | ○ | P2 |
| Legacy pages | — | — | — | — | Remove |

○ = staging manual / limited automation acceptable initially.

---

## 9. DevOps and deployment plan

Respect current stack (Node + Vite + Postgres + Twilio/Meta/OpenAI).

| Topic | Recommendation |
| ----- | -------------- |
| Environments | `development`, `staging`, `production` with separate DB/keys/numbers |
| CI | GitHub Actions (or equivalent): install, lint, typecheck, unit/integration, build FE+BE |
| PR checks | Required green gates before merge |
| Build | FE static assets; BE transpile or `tsx`/node runtime with pinned Node LTS |
| Migrations | `prisma migrate deploy` on release; never rely on `db push` in prod |
| Deploy | Platform with long-lived process support (Render/Fly/ECS/VPS); separate worker later |
| Rollback | Immutable releases + DB migrate forward-only discipline; backup restore runbook |
| Secrets | Host secrets manager / encrypted envs; never git |
| Domain/HTTPS | Terminate TLS; WSS for Twilio stream URL |
| CDN | FE static via CDN |
| File storage | Optional S3-compatible for recordings copies |
| Logging | Structured JSON to provider |
| Monitoring | Uptime on `/health`; Twilio/Meta error rates |
| Error tracking | Sentry (FE+BE) |
| Alerts | 5xx, worker lag, webhook auth failures, voice session crash rate |
| Backups | Postgres PITR |
| DR | Document RPO/RTO; annual restore drill |
| Health | Keep `/health`; add dependency checks (DB ping) on authenticated ops route |

---

## 10. Observability plan

### Minimum launch requirements

* Structured request logs with `requestId`, `companyId`, `userId` (where safe)
* Sentry (or equivalent) for API + SPA
* Metrics: request rate, latency p95, error rate, webhook failures, outbox pending age, voice session starts/failures
* Alerts: health down, error rate spike, outbox backlog, auth failure spike
* AuditLog review path for admins

### Later improvements

* OpenTelemetry tracing across voice sessions
* Business metrics dashboard (leads, conversion, AI takeover rate)
* Cost metrics (OpenAI tokens, Twilio minutes, WA conversations)
* Per-tenant usage metering for billing

---

## 11. Performance and scalability plan

### Immediate

* Fix build/typecheck so production bundles can be produced
* Cap list query page sizes
* Ensure DB indexes used by inbox filters (many already exist — verify EXPLAIN on staging)
* Avoid loading full transcripts in list endpoints

### Next

* Cache settings/knowledge per company with short TTL
* FE route-level code splitting for Settings/Reports
* Image/icon already SVG — keep asset weight low
* Connection pooling already present — tune `PG_POOL_MAX` per instance size
* Rate limit AI CEO and outbound AI calls per tenant

### Scale later (only with evidence)

* Extract worker
* Sticky session pool for voice WS
* Read replicas for reports
* Queue system if outbox throughput demands

Do **not** prematurely split into microservices.

---

## 12. Data migration and demo-data removal plan

| Item | Location | Replacement |
| ---- | -------- | ----------- |
| Seed demo user `demo@airadesk.com` / `123456` | `prisma/seed/demoData.ts` | Staging-only seed; force password change; never prod |
| Clear-all script | `prisma/seed/clearData.ts` | Guard with explicit env confirmation |
| WhatsApp mock mode | Settings + provider | Disallow in `NODE_ENV=production` |
| Voice Kadam defaults | `voice.controller.ts` | Require company settings; no demo brand defaults in prod |
| Verify token hardcoded fallback | webhook controller | Fail closed |
| Nav counts `0` | `landingpage.tsx` | Live API counts |
| Payments null stubs | dashboard/reports/aiCeo | Real billing or hide modules |
| Legacy pages | `AI/src/*.tsx` orphans | Archive/delete after confirming API coverage in Settings/Inbox |
| EMAIL_* dead env | `.env` | Implement or remove |
| `voiceProvider.service` mock | services | Remove or implement to avoid false affordances |
| Local voice-perf reports | `voice-perf-reports/` | Keep gitignored; do not ship as product data |
| Tracked `AI/.env` | git | Replace with `AI/.env.example` |

---

## 13. Recommended phased roadmap

### Phase 0: Product clarification and baseline

* **Objective:** Freeze decisions and baseline the demo.
* **Included work:** Answer §13 questions from Product Current State; tag commit `2d9b2cd` as demo baseline; define v1 channel scope; role matrix; AI autonomy policy.
* **Dependencies:** Product owner availability.
* **Exit criteria:** Written decisions; backlog priorities confirmed.
* **Risks:** Building security without tenancy model causes rework.

### Phase 1: Architecture and security foundation

* **Objective:** Make the system safe enough for staging with real webhooks.
* **Included work:** F-001–F-008, F-024; SEC-001–SEC-006; restore packaging; env examples; signature verification; tenant maps; RBAC skeleton; observability baseline.
* **Dependencies:** Phase 0 decisions on number mapping.
* **Exit criteria:** Staging receives signed webhooks into correct tenant only; CI green for lint/typecheck/unit.
* **Risks:** Voice controller refactor scope creep — prefer surgical security inserts first.

### Phase 2: Complete core end-to-end workflows

* **Objective:** Reliable WhatsApp + Voice + Inbox + Tasks journey.
* **Included work:** Cloud WA onboarding UX, outbound AI call reliability, recording policy, handoff/notification execution, per-company voice branding, logout/session hardening.
* **Dependencies:** Phase 1.
* **Exit criteria:** Scripted E2E on staging with real sandbox numbers.
* **Risks:** Vendor sandbox limits; latency regressions.

### Phase 3: Admin, operations, and secondary workflows

* **Objective:** Operable multi-user SaaS.
* **Included work:** Invites/email reset, reports export, CSV import, stronger settings IA, remove legacy UI, optional website chat if in scope.
* **Dependencies:** Email provider decision.
* **Exit criteria:** OWNER can fully administer tenant without engineering help.
* **Risks:** Overbuilding billing before validating pricing.

### Phase 4: Quality, observability, and performance

* **Objective:** Production operations confidence.
* **Included work:** Expand E2E/security tests; load test webhooks; voice p95 budgets; dashboards/alerts; backup drill.
* **Dependencies:** Phases 1–3.
* **Exit criteria:** Alerts validated; restore drill documented; flaky tests &lt; threshold.
* **Risks:** Ignoring cost metrics until surprise bills.

### Phase 5: Staging, launch preparation, and release

* **Objective:** Controlled launch.
* **Included work:** Prod checklist; legal/privacy; support runbooks; mock-mode kill switch; feature flags for risky AI auto-send; launch cohort of pilot tenants.
* **Dependencies:** All P0/P1 blockers closed.
* **Exit criteria:** Definition of production-ready met (§16).
* **Risks:** Pilot tenants on shared numbers if mapping incomplete.

---

## 14. Recommended implementation order

```text
Task: Capture product decisions (roles, channels v1, number mapping, AI autonomy, billing postpone/hide)
Why now: Prevents rework in security and schema
Dependencies: None
Primary files or modules affected: docs only
Acceptance criteria: Decision record merged
```

```text
Task: Restore backend package.json dependencies/scripts; add FE/BE .env.example; fix root gitignore; untrack AI/.env
Why now: Unblocks CI and safe onboarding
Dependencies: None
Primary files or modules affected: backend/package.json, .gitignore, *.env.example
Acceptance criteria: Fresh install + documented migrate/seed/dev
```

```text
Task: Fix TypeScript ESM/verbatimModuleSyntax issues and FE type-only imports; make lint/build/tsc pass
Why now: Quality gate before refactors
Dependencies: package.json restore
Primary files or modules affected: AI/src/**, backend/tsconfig.json, backend/package.json type field
Acceptance criteria: CI commands green
```

```text
Task: Add Meta and Twilio signature verification; fail closed
Why now: Highest abuse risk
Dependencies: secrets in staging
Primary files or modules affected: webhook.controller.ts, voice routes/controllers
Acceptance criteria: Invalid signatures rejected in tests
```

```text
Task: Introduce TwilioNumber/WhatsAppNumber (or IntegrationConnection hardening) mapped uniquely to companyId; remove oldest-company / first-settings fallbacks
Why now: Multi-tenant integrity
Dependencies: product mapping decision
Primary files or modules affected: schema.prisma, webhook.controller.ts, voice.controller.ts, settings
Acceptance criteria: Unmapped inbound returns error; no cross-tenant writes
```

```text
Task: Implement authorize(role|permission) middleware; apply to settings/team/security and high-risk mutations; gate SPA nav
Why now: Stops privilege gaps
Dependencies: role matrix
Primary files or modules affected: auth.middleware.ts, routes, landingpage.tsx
Acceptance criteria: Authz test matrix green
```

```text
Task: Add logout UI; reject deactivated users on login/me; shorten JWT or add refresh/revoke
Why now: Basic account safety UX
Dependencies: auth middleware
Primary files or modules affected: AuthContext, landingpage, auth.controller
Acceptance criteria: Manual QA checklist pass
```

```text
Task: Production config guard — refuse WHATSAPP mock and missing OPENAI/TWILIO when NODE_ENV=production (with explicit bypass for demo deploys)
Why now: Prevent false-live deployments
Dependencies: env examples
Primary files or modules affected: server.ts bootstrap
Acceptance criteria: Prod boot fails loudly on unsafe config
```

```text
Task: Move voice branding defaults from Kadam hardcoded strings to CompanySettings
Why now: Tenant isolation of persona
Dependencies: tenant mapping
Primary files or modules affected: voice.controller.ts, settings
Acceptance criteria: Two companies different greetings
```

```text
Task: Wire NotificationRule/HandoffRule execution into AI decision pipeline with tests
Why now: Settings currently overpromise
Dependencies: channels for delivery
Primary files or modules affected: llmDecision/aiAction/settings
Acceptance criteria: Rule fixtures trigger expected tasks/notifications
```

```text
Task: Extract outbox worker entrypoint; add row locking
Why now: Reliability before scale
Dependencies: packaging
Primary files or modules affected: outboxWorker.service.ts, server.ts, new worker.ts
Acceptance criteria: Worker runs standalone; no double-send in concurrent test
```

```text
Task: Add Sentry + structured logging + basic metrics/alerts
Why now: Operate staging/prod
Dependencies: hosting
Primary files or modules affected: server.ts, FE main.tsx
Acceptance criteria: Test error appears in tracker
```

```text
Task: E2E smoke suite for auth + inbox + settings; security tests for webhooks
Why now: Lock critical journeys
Dependencies: test DB
Primary files or modules affected: new tests/
Acceptance criteria: CI required check
```

```text
Task: Hide or implement billing; remove/implement EMAIL and website chat scope
Why now: Stop shipping dishonest affordances
Dependencies: product decisions
Primary files or modules affected: settings/reports/dashboard
Acceptance criteria: No “Contact Support” no-ops in prod build flags
```

```text
Task: Staging Twilio/Meta sandbox certification + backup restore drill + launch checklist execution
Why now: Final gate
Dependencies: all P0/P1
Primary files or modules affected: ops docs
Acceptance criteria: Signed checklist; pilot tenant live
```

---

## 15. Production launch checklist

### Product

- [ ] V1 channel scope documented (Voice/WhatsApp/other)
- [ ] Role matrix approved
- [ ] AI autonomy (auto-send vs draft) approved
- [ ] Pilot customer success criteria defined

### UI/UX

- [ ] Logout available
- [ ] No critical UI-only actions in core journeys
- [ ] Empty/loading/error states reviewed on Dashboard, Inbox, Leads, Tasks, Team, Settings, AI CEO
- [ ] Mobile smoke pass on Inbox + Auth
- [ ] Accessibility smoke (keyboard + labels) on Auth + Settings forms

### Backend

- [ ] All P0 APIs validated on staging
- [ ] Outbox worker monitored
- [ ] OpenAPI/Zod contracts reviewed for breaking changes

### Database

- [ ] Migrations apply clean on empty DB
- [ ] Backups enabled + restore tested
- [ ] Number↔company unique constraints live

### Authentication

- [ ] Register/login/me/logout verified
- [ ] Deactivated users cannot authenticate
- [ ] Password policy meets standard

### Authorization

- [ ] OWNER/ADMIN/STAFF matrix enforced on API
- [ ] SPA hides unauthorized admin surfaces
- [ ] Recording access role-checked

### Security

- [ ] Meta signature verification on
- [ ] Twilio signature verification on
- [ ] No unsafe tenant fallbacks
- [ ] No secrets in git
- [ ] Rate limits on auth/webhooks
- [ ] CORS origins correct
- [ ] Security review of voice public endpoints complete

### Testing

- [ ] Unit/integration P0 suite green
- [ ] E2E smoke green on staging
- [ ] Webhook negative security tests green

### Performance

- [ ] Voice p95 latency budget agreed and measured on staging
- [ ] List endpoints paginated
- [ ] FE production build succeeds

### Accessibility

- [ ] Critical forms labeled
- [ ] Focus order acceptable on login

### Monitoring

- [ ] `/health` monitored
- [ ] Error tracker receiving events
- [ ] Alerts routed to on-call

### Deployment

- [ ] Staging ≈ prod architecture
- [ ] Deploy/rollback runbook written
- [ ] Secrets in manager, not VCS
- [ ] WSS URL reachable by Twilio

### Backup and recovery

- [ ] PITR enabled
- [ ] Restore drill documented with timestamp

### Legal and privacy

- [ ] Recording consent/disclosure policy
- [ ] Data retention policy
- [ ] DPA/privacy notice for tenants
- [ ] WhatsApp/Twilio/OpenAI subprocessors disclosed

### Documentation

- [ ] Operator runbook (connect WA, Twilio, rotate secrets)
- [ ] Audit docs updated after major changes
- [ ] `PRODUCT.md` reconciled or marked superseded by `docs/product-audit/`

### Support and operations

- [ ] Support escalation path
- [ ] Pilot feedback channel
- [ ] Known limitations list for customers (e.g. no billing yet)

---

## 16. Definition of production-ready for this product

AiraDesk is production-ready for pilot tenants when **all** of the following are true:

1. All **P0** backlog items and **BLOCKER-001…008** are closed.
2. Critical journeys work end to end on staging with **real** Twilio + Meta sandbox credentials: register → configure → inbound WA → inbox takeover → inbound call → schedule AI call → AI CEO question.
3. No critical journey depends on UI-only stubs (mock WA forbidden in prod without explicit non-prod flag).
4. Backend authorization enforces the approved role matrix for every protected mutation.
5. Webhooks reject invalid signatures; unmapped numbers fail closed.
6. Database migrations are repeatable; backups restored successfully in a drill.
7. FE `lint`/`build` and BE typecheck pass in CI.
8. Critical automated tests (auth, webhooks security, inbox message, RBAC) pass on main.
9. Error tracking and basic alerts are live.
10. No real secrets are committed; env examples exist.
11. Voice branding and tenant data cannot leak across companies in a two-tenant test.
12. Payments UI is either real or removed/hidden for prod.
13. Support runbook exists for channel outages.

---

## 17. Immediate next actions

1. Write a short decision record covering: v1 channels, number↔tenant mapping, role matrix, AI auto-send policy, billing hidden vs built.
2. Restore `backend/package.json` name/dependencies/devDependencies/scripts from the lockfile reality (`dev`, `build`/`typecheck`, Prisma migrate/generate/seed).
3. Add `AI/.env.example` and `backend/.env.example`; untrack `AI/.env`; fix root `.gitignore`.
4. Fix FE `verbatimModuleSyntax` type-only imports and unused imports until `npm run build` passes.
5. Set backend `"type": "module"` (or adjust tsconfig) until `npx tsc --noEmit` is usable; wire npm script.
6. Implement Meta WhatsApp webhook signature verification and remove first-settings/default-company fallbacks.
7. Implement Twilio request signature validation on all public `/api/voice/twilio/*` HTTP handlers.
8. Add DB-backed Twilio/WhatsApp number → `companyId` mapping; change `getVoiceCompany` to fail closed.
9. Add `authorize(...roles)` middleware and apply to settings/team/security and other admin mutations; add API tests.
10. Add Logout button to `landingpage.tsx` calling `AuthContext.logout`.
11. Add production boot guards that refuse `whatsappProviderMode=mock` and missing critical keys when `NODE_ENV=production`.
12. Replace hardcoded “Kadam Web Design” voice defaults with CompanySettings-driven copy.
13. Introduce Sentry (or equivalent) + structured request logging with request IDs.
14. Create a minimal integration test suite for auth + company scoping + webhook auth negatives.
15. Stand up staging with separate Postgres, Twilio number, Meta WA test number, and `PUBLIC_WEBHOOK_URL`.
16. Run signed webhook + two-tenant isolation proof; document results.
17. Hide Billing/revenue modules behind a feature flag until a processor exists.
18. Extract outbox worker entrypoint with claim locking.
19. Delete or quarantine legacy FE modules that break typecheck once Settings/Inbox parity is confirmed.
20. Execute the §15 launch checklist for a closed pilot (not public launch) only after P0 blockers are gone.

---

*End of Production Readiness Plan.*
