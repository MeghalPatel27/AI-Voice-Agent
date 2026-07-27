# 04 — Evidence, Conflicts, and Decisions

## 1. Evidence register

| Evidence ID | Type               | Source                                    | Path/URL                                                                    | Finding supported                                                                      | Reliability                       | Notes                                           |
| ----------- | ------------------ | ----------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| E-001       | AUDIT-VERIFIED     | Product current state audit               | `docs/product-audit/01_PRODUCT_CURRENT_STATE.md`                            | Demo maturity; feature matrix; unknowns                                                | High                              | Full file reviewed                              |
| E-002       | AUDIT-VERIFIED     | Technical architecture audit              | `docs/product-audit/02_TECHNICAL_ARCHITECTURE.md`                           | Stack, diagrams, security findings                                                     | High                              | Full file reviewed                              |
| E-003       | AUDIT-VERIFIED     | Production readiness plan                 | `docs/product-audit/03_PRODUCTION_READINESS_PLAN.md`                        | Blockers, phases, DoD                                                                  | High                              | Full file reviewed                              |
| E-004       | CODE-VERIFIED      | Voice tenant fallback                     | `backend/src/controllers/voice.controller.ts` `getVoiceCompany`             | VOICE_COMPANY_ID else oldest company                                                   | High                              | Lines ~455–472                                  |
| E-005       | CODE-VERIFIED      | WhatsApp tenant fallback                  | `backend/src/controllers/webhook.controller.ts` `getCompanyForMetaWhatsApp` | Default company id else oldest settings                                                | High                              | Includes `findFirst orderBy createdAt asc`      |
| E-006       | CODE-VERIFIED      | WhatsApp mock send                        | `backend/src/services/whatsappProvider.service.ts`                          | Non-cloud → SKIPPED mock                                                               | High                              | Default mode mock                               |
| E-007       | CODE-VERIFIED      | Kadam voice defaults                      | `voice.controller.ts` `VOICE_BUSINESS_NAME`                                 | Hardcoded demo persona                                                                 | High                              | Env override optional                           |
| E-008       | CODE-VERIFIED      | Verify token fallback                     | `webhook.controller.ts`, `whatsappIntegration.controller.ts`                | `airadesk_verify_token` fallback                                                       | High                              | Dev convenience unsafe for prod                 |
| E-009       | SCHEMA-VERIFIED    | Prisma domain                             | `backend/prisma/schema.prisma`                                              | Company, User, Customer, Conversation, Message, Call, Task, Booking, AiAgent, etc.     | High                              | No ChannelEndpoint/AgentDeployment/IndustryPack |
| E-010       | SCHEMA-VERIFIED    | Industry enum                             | `schema.prisma` `enum Industry`                                             | HOSPITAL, CLINIC, HOTEL, RESTAURANT, REAL_ESTATE, OTHER                                | High                              | Not full pack system                            |
| E-011       | SCHEMA-VERIFIED    | Website chat channel enum                 | `ConversationChannel.WEBSITE_CHAT`                                          | Channel label exists                                                                   | High                              | Ingress Missing                                 |
| E-012       | UI-VERIFIED        | SPA routes                                | `AI/src/App.tsx`                                                            | Active nav surfaces + redirects                                                        | High                              | Legacy modules unmounted                        |
| E-013       | CODE-VERIFIED      | Hollow backend package.json               | `backend/package.json`                                                      | Only `dev` script                                                                      | High                              | Lockfile has deps                               |
| E-014       | CODE-VERIFIED      | Voice controller size                     | `wc -l voice.controller.ts`                                                 | ~4869 lines                                                                            | High                              | Extraction risk                                 |
| E-015       | CODE-VERIFIED      | Platform scaffold empty                   | `airadesk-platform/apps                                                     | packages`                                                                              | Placeholders + planning docs only | High                                            | Superseded by PLATFORM-001/002 implementation |
| E-016       | PLANNING-CONFIRMED | Platform README/ARCHITECTURE/DOMAIN_MODEL | `airadesk-platform/*.md`                                                    | Generic multi-tenant target; modular monolith; pack model                              | High                              | Planning + foundation                           |
| E-017       | PLANNING-CONFIRMED | Implementation backlog                    | `airadesk-platform/IMPLEMENTATION_BACKLOG.md`                               | DB-001A complete; DB-001B pending; next DB-001B                                    | High                              | Updated 2026-07-25                              |
| E-018       | PLANNING-CONFIRMED | Pipeline reference                        | `pipeline-reference/*`                                                      | Behaviour map; no prod imports                                                         | High                              | Fixtures mostly empty                           |
| E-019       | PLANNING-CONFIRMED | Master planning prompt                    | User query 2026-07-24                                                       | Latest product direction: generic multi-industry; voice+WA; fail-closed; draft/publish | High                              | Authoritative for target                        |
| E-020       | CONFLICT           | PRODUCT.md vs code                        | `PRODUCT.md`                                                                | Stale seed email, ports, scripts, website chat implied                                 | Medium                            | Prefer code/audit                               |
| E-021       | CODE-VERIFIED      | Missing signature validators              | Grep `backend/src`                                                          | No X-Hub-Signature / validateRequest usage found                                       | High                              | Also E-002                                      |
| E-022       | UNKNOWN            | docs/product-planning                     | Path absent                                                                 | No approved planning folder beyond platform + this blueprint                           | High                              | Explicitly missing                              |
| E-023       | PARTIALLY-VERIFIED | HandoffRule runtime                       | settings + AI paths                                                         | Rules stored; full enforcement unproven                                                | Medium                            | No tests                                        |
| E-024       | CODE-VERIFIED      | Commit/branch                             | `git rev-parse`                                                             | `main` @ `2d9b2cdd9ab2a27821cdfcaea8dbe409eb046a10`                                    | High                              | Blueprint date 2026-07-24                       |

External official provider docs were **not** required to establish current demo behaviour; signature algorithms for production should be taken from Twilio/Meta official docs at implementation time (**EXTERNAL-OFFICIAL** then). No marketing competitor features were copied into scope.

---

## 2. Repository facts

1. Demo frontend lives in `AI/`; demo backend in `backend/` (**E-012**, **E-009**).
2. Production workspace `airadesk-platform/` has installable apps, `@airadesk/config` (**PLATFORM-002 / CONFIG-001 — Complete**), `@airadesk/domain` (**DOMAIN-001** primitives + **DOMAIN-002** Company/User/Role/Session contracts; Company is tenant root; User/Session tenant-scoped; session contracts contain no credentials; roles defined, authorization unimplemented; no DB/provider dependency in domain), and `@airadesk/database` (**DB-001A — Complete**; Prisma/Supabase connection architecture; live verify **DB-001B — Pending**) (**E-015** historical; backlog next = DB-001B).
3. `pipeline-reference/` documents pipelines; must not be imported by production (**E-018**).
4. `docs/product-planning/` **does not exist** (**E-022**).
5. `docs/product-audit/` contains three completed audits dated 2026-07-24 on commit `2d9b2cd…` (**E-001–E-003**, **E-024**).
6. Inbound voice resolves tenant via `VOICE_COMPANY_ID` or oldest `Company` (**E-004**).
7. Inbound WhatsApp can fall back to `WHATSAPP_DEFAULT_COMPANY_ID` or oldest `CompanySettings` (**E-005**).
8. Meta and Twilio webhook signature verification is Missing in demo source (**E-021**).
9. WhatsApp provider defaults to mock and returns SKIPPED (**E-006**).
10. Voice persona falls back to “Kadam Web Design” strings (**E-007**).
11. Roles exist as `OWNER|ADMIN|STAFF`; fine-grained `permissions` JSON is not route ACL (**E-009**, **E-001**). Target matrix **CD-016**.
12. `Booking` uses free-string status; `Customer.leadStage` coexists with `CrmStage` (**E-009**). Appointment V1 target = requested-state preference capture (**CD-018**).
13. No automated tests under demo app trees (**E-001**).
14. `backend/package.json` is incomplete relative to installed lockfile (**E-013**).
15. Website chat and email are not live channels despite schema/env hints (**E-011**, **E-001**).
16. Payments/revenue are explicitly disconnected in dashboard/reports/AI CEO (**E-001**).
17. Confirmed target: generic multi-tenant AI front desk; industry packs; Twilio + Meta WhatsApp; fail-closed endpoints; draft→publish AI (**E-019**, **E-016**).
18. Demo web auth uses JWT in localStorage (**E-001** / **CODE-VERIFIED** current-state). Production target is opaque server-side sessions (**CD-014**) — not the same mechanism.
19. Production database provider is Supabase Database (PostgreSQL) with dedicated projects per environment (**CD-013**); Prisma is the future ORM/migration layer.

---

## 3. Confirmed product decisions

| Decision ID | Decision                                                                                                                                              | Source                  | Consequence                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CD-001      | AiraDesk is a generic multi-tenant AI front-desk / communication CRM                                                                                  | Master prompt **E-019** | One codebase for many industries                                                                                 |
| CD-002      | Composition = core + capabilities + industry pack + tenant config + published AI deployment                                                           | **E-019**, **E-016**    | Packs are templates not apps                                                                                     |
| CD-003      | Initial channels = Twilio voice + Meta WhatsApp Cloud                                                                                                 | **E-019**               | Website chat/email not confirmed V1                                                                              |
| CD-004      | Each channel endpoint belongs to exactly one company; unknown fail closed                                                                             | **E-019**, **E-016**    | Forbids oldest/default company routing                                                                           |
| CD-005      | Industry behaviour is configuration-driven                                                                                                            | **E-019**               | No industry forks                                                                                                |
| CD-006      | AI lifecycle draft→validate→test→publish→monitor→rollback; published immutable                                                                        | **E-019**, **E-016**    | Requires AgentDraft/Deployment                                                                                   |
| CD-007      | Initial genericity proof = real estate + appointment-based service                                                                                    | **E-019**               | Two packs required before claiming genericity                                                                    |
| CD-008      | Healthcare/dermatology is a controlled extension after privacy/safety decisions                                                                       | **E-019**, **E-016**    | No implied compliance                                                                                            |
| CD-009      | Medical diagnosis/prescribe/unsupported claims forbidden                                                                                              | **E-019**               | Hard tool denies                                                                                                 |
| CD-010      | Production platform must not import demo or pipeline-reference code                                                                                   | **E-016**, **E-018**    | Behavioural port only                                                                                            |
| CD-011      | First production shape is modular monolith (web/api/worker + Supabase PostgreSQL)                                                                     | **E-016**, ADR-001/003  | No premature microservices; dedicated Supabase project per env                                                   |
| CD-012      | Demo is behavioural reference, not production codebase to ship                                                                                        | **E-003**, **E-016**    | New DB/ports; demo JWT remains current-state evidence only                                                       |
| CD-013      | Managed database provider = Supabase Database (PostgreSQL); Prisma ORM via `@airadesk/database`                                                       | ADR-003, ADR-009        | Web→API→Prisma→Supabase PG; Worker→Prisma→Supabase PG; no browser DB; no Supabase Auth/Storage/Realtime selected |
| CD-014      | Production web auth = AiraDesk opaque server-side sessions (httpOnly cookies)                                                                         | ADR-002                 | Hashed token in Supabase PG; revocable/expiring; demo JWT localStorage is current-state only                     |
| CD-015      | Default ports: web 3100, api 4100; worker no HTTP port in PLATFORM-001                                                                                | ADR-003                 | Avoids demo 5000/5173 collision                                                                                  |
| CD-016      | OWNER/ADMIN/STAFF RBAC matrix per ADR-004; backend authoritative                                                                                      | ADR-004                 | Frontend hide is UX only                                                                                         |
| CD-017      | WhatsApp AI production default = `DRAFT_ONLY`                                                                                                         | ADR-004                 | Published config may later enable auto-send for approved low-risk capabilities                                   |
| CD-018      | Appointment V1 = request/preference capture → requested state                                                                                         | ADR-005                 | Not authoritative realtime availability without calendar integration                                             |
| CD-019      | Environment contracts via `@airadesk/config`; `APP_ENV` separate from `NODE_ENV`; browser only `VITE_*`                                               | ADR-006                 | PLATFORM-002 / CONFIG-001 — Complete; DB URL vars activated in DB-001A via `@airadesk/config/database`           |
| CD-020      | Domain identity/time/tenancy primitives via `@airadesk/domain`; branded UUID IDs; canonical UTC ISO instants; explicit `companyId`; no default tenant | ADR-007                 | DOMAIN-001 — Complete; vendor IDs deferred to DOMAIN-007; no Prisma/Supabase in domain package                   |
| CD-021      | Company/User/Role/Session contracts; Company is tenant root; roles OWNER/ADMIN/STAFF; session lifecycle without credentials                         | ADR-008                 | DOMAIN-002 — Complete; authz/auth flows deferred                                                                 |
| CD-022      | Prisma ORM 7 + Supabase PostgreSQL; separate runtime/migration URLs; private schema `airadesk`; Node 24 baseline; no transaction pooler for current deploy | ADR-009          | DB-001A — Complete; DB-001B live verify pending; no app models/migrations yet                                    |

---

## 4. Recommendations

| Recommendation ID | Recommendation                                                                                | Evidence                                          | Alternatives                | Reason                                      |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------- | ------------------------------------------- |
| REC-001           | Hide billing/revenue UI in pilot builds                                                       | **E-001** honest stub                             | Build billing first         | No processor; avoid false metrics           |
| REC-002           | Manual tenant onboarding for closed pilot                                                     | Self-serve exists in demo                         | Keep public register        | Reduces abuse while RBAC/ops mature         |
| REC-003           | Default AI reply mode draft-only until explicit enable                                        | Schema default `DRAFT_ONLY`; **CD-017** / ADR-004 | Auto-send default           | Safer for multi-industry — **accepted**     |
| REC-004           | Separate worker process before multi-instance API                                             | In-process worker **E-002**                       | Keep in-process longer      | Double-duty/scaling risk                    |
| REC-005           | Treat Opportunity stages as single source of truth                                            | Dual stage models **E-009**                       | Keep both indefinitely      | Reporting drift                             |
| REC-006           | Delete or quarantine unmounted legacy FE modules in demo when touching demo; do not port them | **E-012**                                         | Port all legacy pages       | Typecheck/nav debt                          |
| REC-007           | Implement signatures from Twilio/Meta official docs at coding time                            | **E-021**                                         | Home-grown crypto           | Correctness                                 |
| REC-008           | Bind knowledge snapshot to AgentDeployment                                                    | Planning lifecycle                                | Live mutable knowledge only | Prevent mid-session silent changes          |
| REC-009           | Availability engine MVP = requested slots without external calendar                           | Booking model only; **CD-018** / ADR-005          | Full Google/Outlook sync    | Avoid blocking Gate 9 — **accepted for V1** |
| REC-010           | Platform operator console can start as runbooks + scripts for pilot                           | Missing console                                   | Full admin app in V1        | Scope control                               |
| REC-011           | Opaque httpOnly sessions for production web auth                                              | Demo JWT localStorage **E-001**; ADR-002          | JWT localStorage in prod    | XSS + revocation — **accepted**             |
| REC-012           | Dedicated Supabase PostgreSQL project per environment                                         | ADR-003                                           | Shared staging+prod project | Isolation — **accepted**                    |

---

## 5. Conflicts

| Conflict ID | Source A                                               | Source B                                            | Conflict                                                                                  | Recommended resolution                                                |
| ----------- | ------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| C-001       | `PRODUCT.md` claims / setup details                    | Current code + audit                                | Stale seed credentials, npm scripts, default API ports, stronger website-chat implication | Code + audit authoritative for current; blueprint for target          |
| C-002       | Demo ingress fallbacks                                 | Confirmed fail-closed tenancy **CD-004**            | Oldest/default company routing vs fail closed                                             | Production must implement ChannelEndpoint; reject demo fallbacks      |
| C-003       | Demo `AiAgent` mutable instructions                    | Target AgentDeployment immutability **CD-006**      | Live brain editable without publish                                                       | New lifecycle entities; do not copy AiAgent as-is                     |
| C-004       | UI Settings handoff/notification rules                 | Runtime enforcement depth                           | Stored vs guaranteed execution                                                            | Treat as Partially implemented; add tests before claiming complete    |
| C-005       | `Customer.leadStage` string                            | `CrmStage` table                                    | Dual pipeline sources                                                                     | Unify under Opportunity stages (**REC-005**)                          |
| C-006       | Nav/UX shows website chat labels                       | No widget ingress                                   | Appears supported vs Missing                                                              | Remove/hide until DEC-005                                             |
| C-007       | Billing settings UI                                    | No payment processor                                | Looks commercial vs disconnected                                                          | Hide until DEC-004                                                    |
| C-008       | `voiceProvider.service` stub                           | Real Twilio voice path                              | Naming suggests alternate voice provider                                                  | Do not migrate stub as primary                                        |
| C-009       | Audit “incremental harden demo” tone in places         | Platform “clean workspace” direction **CD-010–012** | Soften demo vs rebuild platform                                                           | Follow airadesk-platform + prompt: new platform, port behaviour       |
| C-010       | FE default API 5001 vs BE default 5000                 | Local env may align                                 | Default mismatch                                                                          | Platform ports **3100/4100** (**CD-015**)                             |
| C-011       | Industry enum includes HOSPITAL/CLINIC                 | Healthcare extension caution **CD-008**             | Enum ≠ compliant healthcare product                                                       | Enum labels ≠ pack approval                                           |
| C-012       | Demo JWT in localStorage                               | Production opaque sessions **CD-014**               | Current-state vs target auth                                                              | Keep JWT as evidence; implement ADR-002 in platform                   |
| C-013       | Generic “platform Postgres” phrasing in older planning | Supabase Database amendment **CD-013**              | Hosting ambiguity                                                                         | Prefer dedicated Supabase PostgreSQL project/database per environment |

---

## 6. Unknowns

| Unknown ID | Missing fact or decision                                              | Why it matters          | Safe temporary treatment                | Who must decide          | Status                                                                                                                       |
| ---------- | --------------------------------------------------------------------- | ----------------------- | --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| U-001      | Exact RBAC matrix                                                     | Gate 3                  | —                                       | Product owner            | **RESOLVED 2026-07-24** — ADR-004 / **CD-016**                                                                               |
| U-002      | Auto-send enablement policy beyond default                            | Customer messaging risk | —                                       | Product owner            | **RESOLVED 2026-07-24** — WhatsApp production default `DRAFT_ONLY` (ADR-004 / **CD-017**)                                    |
| U-003      | Pilot tenant count / success thresholds                               | Gate 11                 | Do not invent numbers                   | Product owner            | Open                                                                                                                         |
| U-004      | Billing model / processor                                             | Commercial claims       | Hide billing                            | Product owner + finance  | Open                                                                                                                         |
| U-005      | Email provider for invites/reset                                      | Team UX                 | DB invites without email                | Product owner            | Open                                                                                                                         |
| U-006      | Website chat / email V1 inclusion                                     | Scope                   | Deferred out                            | Product owner            | Open                                                                                                                         |
| U-007      | Recording consent + retention periods                                 | Legal risk              | Block public pilot until policy         | Product owner + legal    | Open                                                                                                                         |
| U-008      | Appointment availability depth                                        | Pack completeness       | —                                       | Product owner            | **RESOLVED for V1 2026-07-24** — request/preference capture only (ADR-005 / **CD-018**); calendar depth still open for later |
| U-009      | Session cookie vs localStorage                                        | XSS posture             | —                                       | Product owner + security | **RESOLVED 2026-07-24** — opaque httpOnly sessions (ADR-002 / **CD-014**); demo JWT remains current-state fact               |
| U-010      | Support break-glass process                                           | Ops                     | No cross-tenant tools until designed    | Product owner + ops      | Open                                                                                                                         |
| U-011      | Jurisdiction for healthcare extension                                 | Compliance              | Keep derm pack disabled                 | Legal                    | Open                                                                                                                         |
| U-012      | Whether public self-serve signup remains                              | Abuse surface           | Manual pilot onboard                    | Product owner            | Open                                                                                                                         |
| U-013      | Non-prod DB Option A (local) vs Option B (dedicated Supabase project) | DB-001A / DB-001B       | Dedicated non-prod Supabase project     | Engineering              | **RESOLVED 2026-07-25** — Option B (ADR-009); live verify in DB-001B                                                         |
| U-014      | Object-storage provider for recording files                           | VOICE-011               | Metadata in PG only until decided       | Engineering              | Open — before VOICE-011                                                                                                      |
| U-015      | Supabase connection mode (direct vs pooler, etc.)                     | DB-001A                 | Direct or session pooler; no txn mode   | Engineering              | **RESOLVED 2026-07-25** — ADR-009; transaction pooler rejected for current long-running deploy and migrations                |

```text
Unknown — product-owner decision required
```

applies to open U-* until resolved. Do not implement open items as presumed requirements. Resolved U-001/002/008(V1)/009 are planning decisions documented in ADRs.

---

## 7. Rejected assumptions

These must **not** enter future implementation:

1. One company per deployment is acceptable multi-tenancy.
2. One global company ID / `VOICE_COMPANY_ID` for all voice traffic is production-safe.
3. Same CRM fields for every industry without custom-field registry.
4. Separate source-code fork per industry.
5. One unrestricted prompt is the entire AI brain.
6. AI may directly mutate any database data.
7. Existing demo schema must be copied unchanged.
8. Existing demo UI must be reproduced exactly.
9. Every visible demo button belongs in production.
10. Healthcare scheduling automatically implies healthcare compliance.
11. Revenue metrics can be shown as working without billing data.
12. Mock provider SKIPPED/success equals real provider delivery.
13. Oldest or first company is a valid ingress fallback.
14. `voiceProvider.service` stub is the voice product.
15. Production may import `AI/`, `backend/`, or `pipeline-reference/`.
16. Website chat/email are confirmed V1 because enums/env exist.
17. `PRODUCT.md` overrides current source when they disagree.

---

## 8. Decisions required before implementation gates

| Unknown / Decision                                                                       | Blocks gate                                                       |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Gate 0 scope freeze: DEC website chat/email (U-006), channel confirmation already CD-003 | Gate 0                                                            |
| U-001 RBAC matrix                                                                        | **Resolved** — Gate 3 implements ADR-004                          |
| U-009 session storage approach                                                           | **Resolved** — Gate 3 implements ADR-002                          |
| U-002 AI auto-send policy                                                                | **Resolved** — Gate 4 uses DRAFT_ONLY default                     |
| Dual stage model DEC-012 / C-005                                                         | Gate 5 (hardening) / Gate 9                                       |
| U-008 availability depth beyond V1 requests                                              | Later calendars only; V1 scope resolved                           |
| U-007 recording consent/retention                                                        | Gate 8 media policy / Gate 11                                     |
| U-005 email provider                                                                     | Gate 11 team UX quality (not hard security if DB invite accepted) |
| U-004 billing                                                                            | Gate 11 commercial messaging                                      |
| U-003 / U-012 pilot size and onboarding                                                  | Gate 11                                                           |
| U-010 support access                                                                     | Gate 11                                                           |
| U-011 healthcare                                                                         | Dermatology pack enablement only (after Gate 9)                   |
| U-013 / U-015 non-prod DB + connection mode                                              | **RESOLVED** — ADR-009 / DB-001A; live verify DB-001B             |
| U-014 object-storage provider                                                            | Before VOICE-011                                                  |

---

## 8b. Post-call intelligence decisions (2026-07-25)

| Decision | Status | Notes |
| -------- | ------ | ----- |
| Analysis runs only after call completion | Confirmed | Never inline in TwiML, Media Stream audio, Realtime events, or hangup request latency path |
| Terminal call state independent of analysis success | Confirmed | Dashboard may show “Call ended” + “Analysis pending/failed” |
| Intent uses transcript-grounded business signals only | Confirmed | Accent, protected traits, emotion guessing prohibited |
| UNKNOWN and INSUFFICIENT_DATA are first-class states | Confirmed | Do not force a sales score |
| Demo implements capability now; clean platform tasks remain Pending | Confirmed | VOICE-014, DOMAIN-008, DB-010, AI-POSTCALL-001, WORKER-POSTCALL-001, CRM-009, UI-POSTCALL-001, TEST-POSTCALL-001 |
| Product development resume point | Unchanged | **DB-001B** — Connect and verify a non-production Supabase project |
| `airadesk-platform` source | Unchanged | Documentation-only planning updates; no platform app code in this demo feature |

---

## Appendix — Inspection checklist (this blueprint)

| Check                                       | Result                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Major features traced UI→API→DB/provider    | Yes via audits + spot verification of voice/WA/auth/schema/routes         |
| Referenced paths verified                   | Yes                                                                       |
| `docs/product-planning/` exists?            | **No**                                                                    |
| Planning files defining target?             | `airadesk-platform/*` + master prompt                                     |
| Stale documentation identified              | `PRODUCT.md` (**C-001**)                                                  |
| Duplicate/legacy modules identified         | Unmounted `AI/src/*.tsx`; unused `voiceProvider.service.ts`               |
| Schema names verified before target mapping | Yes (**E-009**)                                                           |
| External integrations verified from source  | Twilio, Meta, OpenAI, ElevenLabs paths **CODE-VERIFIED**; live Unverified |
| Secret values reproduced?                   | **No**                                                                    |
| Live providers executed?                    | **No**                                                                    |
| Application source modified?                | **No** (docs only)                                                        |

---

_End of Evidence, Conflicts, and Decisions._
