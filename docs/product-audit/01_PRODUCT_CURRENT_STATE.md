# Product Current State

## 1. Document purpose

This file documents the **observable product state of AiraDesk** as implemented in the repository on **2026-07-24**. It is intended as a source of truth for converting the current demo into a production-grade application.

| Field | Value |
| ----- | ----- |
| Audit date | 2026-07-24 |
| Repository / project | AI Voice Agent (product name in code/UI: **AiraDesk**) |
| Current branch | `main` (tracks `origin/main`) |
| Commit hash | `2d9b2cdd9ab2a27821cdfcaea8dbe409eb046a10` (“Optimize production voice engine latency”) |
| Audit scope | Entire repository except ignored/generated trees (`node_modules`, build artifacts, `.git`) |
| Primary evidence sources | Source under `AI/src`, `backend/src`, `backend/prisma`, package manifests/lockfiles, seed scripts, safe local validation commands |

**Important limitations**

* End-to-end live calls, Meta WhatsApp delivery, and OpenAI Realtime sessions were **not** exercised against external providers during this audit (**Unverified** at runtime).
* No automated test suite exists; feature status is based on code-path inspection, not production traffic.
* Root `PRODUCT.md` exists and is useful context, but several claims in it are **stale** relative to current code (seed email, npm scripts, default API port). This audit prefers code over `PRODUCT.md`.
* Secret values from `.env` files are never reproduced here; only variable names and presence patterns are documented.

---

## 2. Executive summary

**AiraDesk** is a multi-tenant **AI communication CRM / AI front desk** for service businesses. It combines:

* Omnichannel **Inbox** (phone calls + WhatsApp + schema support for website chat)
* **Leads / CRM** operations
* **Tasks** including scheduled **AI outbound calls**
* **Team** management
* **Reports** and a **Dashboard** with an AI-written ops brief
* **Settings / Control Room** for company, channels, AI behavior, knowledge, CRM stages, handoff/notification rules, and security
* **Ask AI CEO** chat over live company snapshot data
* Real-time **Twilio Media Streams ↔ OpenAI Realtime** voice (optional ElevenLabs TTS)

**Who it serves (Verified / Inferred):** Owners, admins, and staff of clinics, hospitals, hotels, restaurants, real-estate, and similar enquiry-heavy service businesses.

**Value proposition (Verified from product positioning in UI + APIs):** One AI-operated front desk that answers calls/WhatsApp, qualifies leads, creates tasks/bookings, escalates to humans, and helps the owner prioritize via AI CEO.

```text
Current maturity: Demo / Advanced Prototype (approaching internal MVP for voice + CRM shell)
```

**Why this classification**

* Substantial working CRM UI and company-scoped JWT APIs exist (**Verified**).
* Twilio voice realtime path and Meta WhatsApp Cloud provider code are real integrations (**Verified** in code), but depend on external credentials and public webhooks (**Unverified** live).
* WhatsApp defaults to **mock** mode; payments/revenue are explicitly **not connected**; website chat has no live widget ingress; email channel is absent in code despite env leftovers.
* No tests, incomplete `backend/package.json`, frontend build/lint currently fail, webhook signature validation missing, RBAC mostly role-light, logout UI missing.
* Suitable to demo and iterate; **not** ready for untrusted multi-tenant production traffic.

**Genuinely functional (code-complete paths)**

* Register / login / session restore
* Dashboard summary from DB
* Inbox list/detail, human reply, conversation actions, tasks/bookings from conversation
* Leads list/detail/actions (CSV import disabled)
* Tasks CRUD + schedule AI call task
* Team invite/edit/deactivate (OWNER/ADMIN for mutations)
* Settings control-room sections with persistence
* AI CEO chat (OpenAI + company snapshot)
* Outbox worker for WhatsApp pending + due AI calls
* Voice Twilio realtime bridge (large dedicated module)

**Primarily demo / incomplete behavior**

* Header search, filters, notifications
* Nav badge counts hardcoded to `0`
* Billing / payments / revenue
* Schedule report / Export PDF (print only)
* WhatsApp mock mode
* Voice branding defaults to “Kadam Web Design”
* Seed demo company without sample conversations
* Legacy page modules still in repo but unreachable via current nav

**Largest production gaps**

1. Security of public webhooks / voice tenancy mapping
2. Fine-grained authorization and permission enforcement
3. Packaging/CI/test/observability foundation
4. Payment/billing and complete channel coverage (website chat, email)
5. Build health (frontend typecheck/lint failures; backend `tsc` module config breakage)

---

## 3. Product definition

| Item | Content | Confidence |
| ---- | ------- | ---------- |
| Product name | **AiraDesk** (UI brand; backend health message “AiraDesk backend is running”) | Verified |
| Product category | AI Communication CRM / AI Sales CEO / AI front desk for service businesses | Verified |
| Problem statement | Service businesses lose or mishandle phone/WhatsApp enquiries; owners lack a single ops view | Inferred from feature set |
| Proposed solution | Multi-tenant workspace where AI handles conversations, creates CRM work, escalates to humans, and answers owner questions from live data | Verified |
| Target users | Owners and teams of hospitals, clinics, hotels, restaurants, real estate, and similar | Verified (industry enum + UI) |
| User roles | `OWNER`, `ADMIN`, `STAFF` | Verified (`backend/prisma/schema.prisma`, auth/team controllers) |
| Core value proposition | “One AI front desk for calls, WhatsApp, and lead handling” | Verified (`PRODUCT.md` + UI copy “AI Sales CEO”) |
| Main workflows | Signup → configure channels/knowledge → receive WhatsApp/call → AI decide/reply → human takeover → tasks/bookings → reports/AI CEO | Partially verified (code paths exist; live E2E unverified) |
| Key domain entities | Company, User, Customer, Conversation, Message, Call, Task, Booking, OutboundMessage, KnowledgeItem, AiAgent, CrmStage, HandoffRule, NotificationRule, AuditLog, IntegrationConnection, CompanySettings | Verified |
| Expected business outcomes | Faster enquiry handling, fewer missed leads, clearer owner focus, team workload visibility | Inferred |
| Business model | SaaS control room + billing settings fields exist, but billing is not connected | Partially verified (schema/UI present; no payment processor) |

---

## 4. User roles and permissions

| Role | Purpose | Accessible areas | Available actions | Enforcement status | Evidence |
| ---- | ------- | ---------------- | ----------------- | ------------------ | -------- |
| Unauthenticated visitor | Access login/register only | `/login`, public API auth + webhooks/voice Twilio HTTP | Register, login | Frontend route gate + JWT on APIs | `AI/src/App.tsx`, `AI/src/auth/ProtectedRoute.tsx`, `backend/src/middleware/auth.middleware.ts` |
| `OWNER` | First user at registration; full tenant control | All authenticated SPA sections | All CRM ops; team invite/update/deactivate; settings team/password; cannot be deactivated | Backend OWNER/ADMIN checks on team/settings mutations only; most CRM APIs accept any JWT role | `auth.controller.ts` creates OWNER; `team.controller.ts`, `settings.controller.ts` |
| `ADMIN` | Elevated team/settings control | Same SPA (no separate admin UI) | Same as OWNER for team/settings mutations found | Same as OWNER for those endpoints | `team.controller.ts`, `settings.controller.ts` |
| `STAFF` | Day-to-day ops | Same SPA | Inbox/leads/tasks/reports/AI CEO; blocked from some team/settings mutations | **Mostly UI-unrestricted**; backend blocks some admin actions only | No global RBAC middleware; SPA does not hide nav by role |
| External systems (Twilio, Meta) | Channel ingress | Public webhook/voice routes | Create conversations/messages/calls | Public endpoints; Meta signature validation **Missing**; Twilio request signature validation **Missing** | `webhook.routes.ts`, `voice.routes.ts`, grep for signature validators |

**Enforcement summary**

| Layer | Status |
| ----- | ------ |
| UI role gating | Neither (nav identical for all roles; logout missing) |
| Backend JWT auth | Present for business APIs |
| Backend RBAC | Partial (team/settings only) |
| Fine-grained `User.permissions` JSON | Stored/editable; `permissionsEnabled: false` in team overview path — not used as route ACL (**Partially verified**) |

---

## 5. Complete route and screen inventory

### Public pages

| Route/Screen | User role | Purpose | Data source | Key actions | Status | Evidence |
| ------------ | --------- | ------- | ----------- | ----------- | ------ | -------- |
| `/login` | Public | Login / register | `POST /api/auth/login`, `/register` | Authenticate, create company+owner | Fully implemented | `AI/src/auth/AuthPage.tsx`, `auth.controller.ts` |

### Authenticated pages (shell: `LandingPage`)

| Route/Screen | User role | Purpose | Data source | Key actions | Status | Evidence |
| ------------ | --------- | ------- | ----------- | ----------- | ------ | -------- |
| `/dashboard` | Any JWT user | Owner command center | `GET /api/dashboard/summary` | Refresh | Fully implemented (read); payments metrics explicitly disconnected | `commandcenter.tsx`, `dashboard.controller.ts` |
| `/inbox` | Any JWT user | Omnichannel conversations | Inbox + detail + control-room health APIs | Reply, actions, create WA chat, tasks, bookings, delete, play recording | Fully implemented (WA send depends on cloud mode) | `inbox.tsx`, `conversation.routes.ts` |
| `/leads` | Any JWT user | CRM leads (renders `CustomersPage`) | `/api/customers/leads*` | Create lead, actions, tasks, bookings, outbound AI call; CSV disabled | Partially implemented | `customers.tsx`, `customer.routes.ts` |
| `/tasks` | Any JWT user | Ops board + AI caller | `/api/tasks/operations` etc. | CRUD, actions, schedule AI call | Fully implemented (outbound call needs Twilio) | `tasks.tsx`, `task.routes.ts` |
| `/team` | Any JWT user | People / invites | `/api/team/*` | Invite, edit, deactivate/reactivate | Fully implemented with OWNER/ADMIN backend gates on mutations | `team.tsx`, `team.controller.ts` |
| `/reports` | Any JWT user | BI overview | `GET /api/reports/overview` | Tab views; Export PDF=`print`; Schedule=alert | Partially implemented | `reports.tsx`, `reports.controller.ts` |
| `/settings` | Any JWT user | Control room | `/api/settings/*`, WhatsApp integration | Persist most sections; billing contact no-op | Partially implemented | `settings.tsx`, `settings.routes.ts` |
| `/ai-ceo` | Any JWT user | Ask AI CEO | `POST /api/ai-ceo/chat` | Chat (session-local history) | Fully implemented (needs OpenAI) | `aiCeoChat.tsx`, `aiCeo.controller.ts` |
| `/` and `*` | — | Redirect | — | → `/dashboard` | Fully implemented | `App.tsx` |

### Redirect aliases (legacy URLs → consolidated screens)

| Old path | Redirects to | Status |
| -------- | ------------ | ------ |
| `/command-center` | `/dashboard` | Active redirect |
| `/calls`, `/whatsapp` | `/inbox` | Active redirect |
| `/customers`, `/pipeline`, `/handover`, `/bookings` | `/leads` | Active redirect |
| `/agents` | `/team` | Active redirect |
| `/analytics` | `/reports` | Active redirect |
| `/integrations`, `/knowledge`, `/outbox` | `/settings` | Active redirect |

Evidence: `AI/src/App.tsx`.

### Legacy / unused UI modules (still in repo, not mounted)

| Screen file | Former purpose | Status |
| ----------- | -------------- | ------ |
| `calls.tsx`, `whatsapp.tsx`, `pipeline.tsx`, `handover.tsx`, `bookings.tsx`, `agents.tsx`, `analytics.tsx`, `integrations.tsx`, `knowledge.tsx`, `outbox.tsx` | Standalone modules with real API wiring | Deprecated or unused in active nav (code remains) |

### API route groups (backend)

Mounted in `backend/src/server.ts`:

| Prefix | Auth | Purpose | Status |
| ------ | ---- | ------- | ------ |
| `GET /`, `GET /health` | Public | Liveness | Fully implemented |
| `/api/auth` | Mixed | Register/login/me | Fully implemented |
| `/api/dashboard` | JWT | Summary | Fully implemented |
| `/api/conversations` | JWT | Inbox CRM | Fully implemented |
| `/api/customers` | JWT | Leads | Fully implemented |
| `/api/handover`, `/api/pipeline` | JWT | Legacy queues | Backend present; primary UI folded into leads/inbox |
| `/api/tasks` | JWT | Ops + AI call schedule | Fully implemented |
| `/api/analytics`, `/api/reports` | JWT | Metrics | Fully implemented (revenue not connected) |
| `/api/settings` | JWT | Control room | Fully implemented |
| `/api/integrations`, `/api/whatsapp-integration` | JWT | Secrets / WA config | Fully implemented |
| `/api/agents`, `/api/bookings`, `/api/outbound`, `/api/knowledge` | JWT | Supporting CRUD | Fully implemented |
| `/api/calls` | JWT | Call inbox/recordings/outbound | Fully implemented |
| `/api/team` | JWT | Team ops | Fully implemented |
| `/api/ai-ceo`, `/api/ai-provider` | JWT | AI chat/status/reply/realtime secret | Fully implemented (needs keys) |
| `/api/voice/*` | Mixed | Twilio voice HTTP | Fully implemented (public Twilio webhooks) |
| `/api/webhooks/*` | Public/secret headers | Meta WA + custom provider hooks | Partially secured |
| WS `/api/voice/twilio/realtime` | Public (Twilio) | Media stream bridge | Fully implemented in code |

### Development / debug

| Item | Status |
| ---- | ------ |
| `backend/src/voice/performance/*` + `voice-perf-reports/` | Local voice latency harness / reports; not a product UI |
| No dedicated `/debug` SPA routes found | — |

---

## 6. UI inventory

### Shell structure (`AI/src/landingpage.tsx`)

* **Sidebar** (desktop `xl+`): brand “AiraDesk / AI Sales CEO”, nav items, AI CEO promo card
* **Mobile nav**: horizontal chips below `xl`
* **Header**: “Live Workspace”, section title, search, Filters, Bell, Ask AI CEO button
* **Main**: switches section component by path

### Navigation items

Dashboard, Inbox, Leads, Tasks, Team, Reports, Settings (+ Ask AI CEO CTA). Badge **counts hardcoded to `0`**.

### Component patterns

* Large page-level `.tsx` files (monolithic screens), not a feature-folder architecture
* Shared API helper: `AI/src/lib/api.ts` (`apiFetch`)
* Icons: `lucide-react`
* Styling: Tailwind CSS 4 utility classes; dark atmospheric UI
* Forms: mix of controlled forms and `window.prompt` / `confirm` (especially leads)
* Loading / error / empty: present on major pages (dashboard, inbox, leads, tasks, team, reports, settings)
* Modals: mostly inline panels / forms rather than a shared modal system
* Charts: report sections are list/metric UI; not a charting library
* Notifications: header bell **UI only**; in-page `notice` / error strings used instead
* Theme: custom dark palette; no light theme toggle found
* Accessibility: essentially no `aria-*` usage found (**Missing**)
* Responsive: breakpoints used; sidebar hidden on smaller screens with chip nav

### Placeholder / static / non-functional UI (Verified)

| Element | Behavior |
| ------- | -------- |
| Header search | No handler |
| Filters button | No handler |
| Bell button | No handler |
| Nav counts | Always `0` |
| Auth page metric cards | Decorative `"0"` values |
| Leads “Import CSV” | `disabled` |
| Reports “Schedule report” | `alert("…not connected yet.")` |
| Reports “Export PDF” | `window.print()` only |
| Settings Billing “Contact Support” | No handler |
| Logout | `logout()` in `AuthContext` but **no shell button** |

---

## 7. Feature status matrix

| Feature | User-facing UI | Business logic | Backend/API | Persistence | Auth/RBAC | Error handling | Testing | Final status | Evidence |
| ------- | -------------- | -------------- | ----------- | ----------- | --------- | -------------- | ------- | ------------ | -------- |
| Register company + owner | Yes | Yes | Yes | Prisma Company+User | Public | Zod + HTTP errors | None | Fully implemented | `AuthPage.tsx`, `auth.controller.ts` |
| Login + session restore | Yes | Yes | Yes | JWT in `localStorage` | JWT | Clears bad token | None | Fully implemented | `AuthContext.tsx` |
| Logout | No UI | Client clear | N/A | Removes token | N/A | N/A | None | UI only (missing) | `AuthContext.logout` unused in shell |
| Dashboard summary | Yes | Aggregations | Yes | Read DB | JWT only | Loading/error UI | None | Fully implemented (read) | `commandcenter.tsx`, `dashboard.controller.ts` |
| Payments/revenue metrics | Shown disconnected | Explicit null/not connected | Yes | None | JWT | Message fields | None | Mocked / Missing (honest disconnect) | dashboard/reports/aiCeo controllers |
| Omnichannel inbox | Yes | Yes | Yes | Conversations/messages | JWT | Yes | None | Fully implemented | `inbox.tsx` |
| Human WhatsApp reply send | Yes | Provider service | Yes | Messages + outbound | JWT | Errors if not cloud | None | Partially implemented (mock default) | `whatsappProvider.service.ts` |
| Conversation actions (takeover, won/lost, etc.) | Yes | Yes | Yes | Conversation/task updates | JWT | Yes | None | Fully implemented | conversation controller/actions |
| Start WhatsApp conversation from UI | Yes | Yes | Yes | Customer/conversation | JWT | Yes | None | Fully implemented | `POST /api/conversations/whatsapp` |
| Call recording playback | Yes | Proxy media | Yes | Call recording fields | JWT media route | Player errors possible | None | Partially verified | `inbox.tsx` audio + call/voice controllers |
| Leads CRM | Yes | Yes | Yes | Customer | JWT | Yes | None | Fully implemented | `customers.tsx` |
| Lead CSV import | Button | No | No | No | — | Disabled | None | UI only | `customers.tsx` |
| Pipeline kanban (standalone) | Legacy file | Yes | Yes | Conversation status | JWT | Yes | None | Deprecated or unused (UI) | `pipeline.tsx` redirected |
| Tasks board | Yes | Yes | Yes | Task | JWT | Yes | None | Fully implemented | `tasks.tsx` |
| Schedule AI outbound call | Yes | Twilio REST | Yes | Task + Twilio | JWT + worker | Failures recorded | None | Partially implemented (needs Twilio/`PUBLIC_WEBHOOK_URL`) | `aiScheduledCall.service.ts` |
| Team invite/manage | Yes | Yes | Yes | User | OWNER/ADMIN mutations | Yes | None | Fully implemented | `team.tsx` |
| Fine-grained permissions flags | Editable in settings | Stored JSON | Yes | User.permissions | Partial | — | None | Partially implemented | settings/team controllers |
| Reports overview | Yes | Aggregations | Yes | Read DB | JWT | Yes | None | Fully implemented (read); revenue disconnected | `reports.tsx` |
| Schedule/export reports | Buttons | No real schedule | No | No | — | Alert/print | None | UI only | `reports.tsx` |
| Settings control room | Yes | Yes | Yes | CompanySettings + related | Partial admin on team password | Yes | None | Fully implemented for core sections | `settings.tsx` |
| Knowledge base CRUD | In Settings (+ legacy page) | Yes | Yes | KnowledgeItem | JWT | Yes | None | Fully implemented | settings knowledge routes |
| Handoff / notification rules | Settings | CRUD | Yes | Tables | JWT | Yes | None | Partially implemented (rules stored; enforcement depth unverified) | settings controller |
| WhatsApp Cloud connect | Settings Channels | Mode mock/cloud | Yes | Settings fields | JWT | Test send | None | Partially implemented | `whatsappIntegration.controller.ts` |
| Email channel | Mentions/filters | Env leftovers | No service usage | No | — | — | None | Missing | `EMAIL_*` unused in `backend/src` |
| Website chat live channel | Schema + labels | Partial | No public widget webhook found | Possible via data | — | — | None | Partially implemented / Missing ingress | schema + enums only |
| AI inbound decision (WhatsApp) | Indirect | Rules + optional LLM | Yes | Conversation fields + outbound | Webhook | Fallback rules | None | Partially implemented | `llmDecision.service.ts`, `aiDecision.service.ts` |
| AI template replies | Indirect | Templates | Yes | Outbound queue | — | — | None | Fully implemented (non-LLM templates) | `aiReply.service.ts` |
| AI CEO chat | Yes | Snapshot + OpenAI | Yes | No chat persistence | JWT | Errors as messages | None | Fully implemented | `aiCeo.controller.ts` |
| Twilio realtime voice | Phone / Twilio | Large voice engine | Yes | Call/conversation/messages | Public Twilio + JWT outbound | Logging | Perf harness only | Fully implemented in code; live Unverified | `voice.controller.ts`, `backend/src/voice/` |
| CRM voiceProvider abstraction | Settings fields | Mock/stub | Stub service | Settings | — | Throws if non-mock | None | Mocked / Deprecated or unused | `voiceProvider.service.ts` unused by callers |
| Outbox worker | Settings redirect from old Outbox | Interval worker | Yes | OutboundMessage / tasks | Server-side | Logs | None | Fully implemented | `outboxWorker.service.ts` |
| Billing / subscriptions | Billing section UI | billingSettings JSON | Display only | JSON field | — | Contact Support no-op | None | UI only / Missing | settings billing |
| Multi-tenant isolation (JWT APIs) | N/A | companyId filters | Yes | Prisma | JWT companyId | 404/empty | None | Fully implemented for typical handlers | Controllers use `req.user.companyId` |
| Voice inbound tenant mapping | N/A | `VOICE_COMPANY_ID` or oldest company | Yes | Writes into that company | Env, not JWT | Fallback risky | None | Partially implemented / Broken for true multi-tenant | `getVoiceCompany` in voice controller |
| Header search/filters/notifications | Yes | No | No | No | — | — | None | UI only | `landingpage.tsx` |

---

## 8. Detailed feature breakdown

### 8.1 Authentication (register / login / session)

**Purpose:** Create a tenant and authenticate users.

**Current status:** Fully implemented (logout UI missing).

**Users involved:** Public → becomes OWNER on register; existing users login.

**Entry points:** `/login`

**Implementation flow**

```text
UI AuthPage → AuthContext.login/register → apiFetch /api/auth/*
→ Zod validate → bcrypt + Prisma → JWT (7d) → localStorage airadesk_token → /dashboard
On load: ProtectedRoute waits → GET /api/auth/me → set user or clear token
```

**Files involved:** `AI/src/auth/*`, `backend/src/controllers/auth.controller.ts`, `backend/src/middleware/auth.middleware.ts`

**What works:** Register, login, me, password hashing, JWT issuance.

**What does not:** Logout button; refresh-token rotation; email verification; password reset for self-service (admin can reset team password in settings).

**Mocked/hardcoded:** None for credentials in AuthPage (seed prints demo password separately).

**Security:** JWT in `localStorage` (XSS-sensitive); password min length 6; no lockout.

---

### 8.2 Dashboard (Command Center)

**Purpose:** Owner snapshot + AI CEO daily report text + focus lists.

**Status:** Fully implemented read path; payments/revenue honestly disconnected.

**Flow:** `CommandCenter` → `GET /api/dashboard/summary` → Prisma aggregates → UI cards/lists.

**Gaps:** Industry-specific title map appears simplified; no drill-through actions beyond displaying data; revenue metrics always “not connected”.

---

### 8.3 Inbox

**Purpose:** Unified conversation workspace.

**Status:** Fully implemented for CRM ops; WhatsApp live send depends on provider mode.

**Flow:** List filters → detail → human message / actions / tasks / bookings / delete; recordings via authenticated media URL.

**Gaps:** Website chat channel has no widget; EMAIL filter enum exists without email pipeline; realtime inbox updates (websockets to browser) **Missing**.

---

### 8.4 Leads

**Purpose:** CRM over customers/conversations.

**Status:** Fully implemented for core actions; CSV import UI only/disabled.

**Flow:** `CustomersPage` on `/leads` → customer lead APIs → prompts for some actions → optional outbound AI call.

---

### 8.5 Tasks & AI Caller

**Purpose:** Operational task board; schedule AI phone follow-ups.

**Status:** Fully implemented in app layer; Twilio placement Unverified without live credentials/public URL.

**Flow:** Create/update/delete/actions; `POST /api/tasks/ai-call` stores scheduled task; outbox worker due-check → `aiScheduledCall.service` Twilio REST → outbound answer webhook → realtime voice.

---

### 8.6 Team

**Purpose:** Invite and manage members, workload view.

**Status:** Fully implemented with OWNER/ADMIN mutation gates.

**Gaps:** Permissions flags not enforced on CRM routes; no invite email delivery (EMAIL_* unused).

---

### 8.7 Reports

**Purpose:** Funnel/source/team style BI from DB.

**Status:** Read path fully implemented; revenue disconnected; export/schedule UI-only.

---

### 8.8 Settings / Control Room

**Purpose:** Configure company, channels, AI, knowledge, CRM stages, handoff/notification rules, task workflow, security, team passwords.

**Status:** Mostly fully implemented persistence; billing UI-only; WhatsApp often mock.

---

### 8.9 Ask AI CEO

**Purpose:** Natural-language ops Q&A over live company snapshot.

**Status:** Fully implemented when `OPENAI_API_KEY` present; chat history not persisted server-side.

**Explicitly refuses inventing payments/revenue** when disconnected.

---

### 8.10 Voice calling (Twilio + OpenAI Realtime ± ElevenLabs)

**Purpose:** Low-latency AI phone agent.

**Status:** Large real implementation; production readiness depends on Twilio/OpenAI/ElevenLabs config, public WSS URL, and multi-tenant mapping.

**Hardcoded defaults:** Business name/type/greeting/pricing lean on “Kadam Web Design” unless env overrides (`voice.controller.ts`).

**CRM `voiceProvider.service`:** Mock/stub and unused — do not confuse with Twilio path.

---

### 8.11 WhatsApp messaging

**Purpose:** Inbound webhook + outbound Cloud API sends.

**Status:** Real Cloud provider via `fetch` to Graph API when mode=`cloud`; default/mock skips real send.

**Security gap:** Meta inbound lacks signature verification; company resolution can fall back to default/first settings row.

---

## 9. End-to-end user journeys

### Journey A — Registration

```text
Journey status: Fully implemented (code)
Starting point: /login → Register
Steps:
  1. Submit name, email, password, companyName, industry
  2. Backend creates Company + OWNER user
  3. JWT stored; redirect /dashboard
Data written: Company, User
External services: None
Success state: Authenticated dashboard (likely empty)
Failure state: Validation/409 email exists shown in UI
Missing steps: Email verification, onboarding wizard, default knowledge/stages seeding beyond optional seed script
Evidence: AuthPage.tsx, auth.controller.ts
```

### Journey B — Login / restore / logout

```text
Journey status: Partially implemented
Starting point: /login or returning visit
Steps: login → token; or /me restore
Data written: none (token client-side)
External services: none
Success state: Protected routes available
Failure state: Invalid token cleared; redirect login
Missing steps: Logout UI; session revocation list; refresh tokens
Evidence: AuthContext.tsx, ProtectedRoute.tsx
```

### Journey C — WhatsApp enquiry → AI → human

```text
Journey status: Partially verified (code complete; live Meta Unverified)
Starting point: Customer WhatsApp message to connected number
Steps:
  1. Meta webhook POST /api/webhooks/meta/whatsapp
  2. Resolve company → upsert customer/conversation/message
  3. LLM decision with rule fallback → AI reply templates/actions
  4. OutboundMessage queued → provider send (cloud) or skip (mock)
  5. Staff sees Inbox; may TAKE_OVER and reply as HUMAN
Data written: Customer, Conversation, Message, possibly Task/Booking, OutboundMessage
External services: Meta Graph, optional OpenAI
Success state: Thread in Inbox; reply delivered if cloud
Failure state: Mock skip; missing creds; weak company mapping
Missing steps: Signature verification; robust multi-number tenancy; browser realtime updates
Evidence: webhook.controller.ts, llmDecision.service.ts, whatsappProvider.service.ts, inbox.tsx
```

### Journey D — Inbound phone call

```text
Journey status: Partially verified
Starting point: Caller dials Twilio number
Steps:
  1. Twilio hits /api/voice/twilio/incoming (realtime TwiML)
  2. Media stream WS /api/voice/twilio/realtime
  3. OpenAI Realtime (+ optional ElevenLabs TTS)
  4. Persist conversation/call/messages; optional meeting/task
Data written: Customer/Conversation/Call/Message/Task/Booking as applicable
External services: Twilio, OpenAI, optional ElevenLabs
Success state: Call appears in Inbox Calls channel
Failure state: Missing keys/public URL; wrong VOICE_COMPANY_ID
Missing steps: Twilio signature validation; per-tenant voice config (currently env-heavy)
Evidence: voice.controller.ts, backend/src/voice/*
```

### Journey E — Schedule AI follow-up call

```text
Journey status: Partially verified
Starting point: Tasks → Schedule AI Call
Steps: create AI caller task → worker due → Twilio outbound → answer webhook → realtime AI
Data written: Task updates, Call/Conversation
External services: Twilio, OpenAI
Success/Failure: Task notes / call status fields
Missing steps: Rich scheduling UX timezone guarantees; rate limits; retry policy UI
Evidence: tasks.tsx, task.controller.ts, outboxWorker.service.ts, aiScheduledCall.service.ts
```

### Journey F — Ask AI CEO

```text
Journey status: Fully implemented (needs OpenAI)
Starting point: /ai-ceo
Steps: question → POST /api/ai-ceo/chat → snapshot + model → answer
Data written: none for chat history
External services: OpenAI
Missing steps: Persisted threads, audit of answers, RBAC on sensitive data slices
Evidence: aiCeoChat.tsx, aiCeo.controller.ts
```

### Journey G — Invite teammate

```text
Journey status: Fully implemented for DB user creation; email invite Missing
Starting point: Team → invite
Steps: OWNER/ADMIN posts invite → User row created with password
Missing steps: Email delivery, invite links, forced password change on first login
Evidence: team.controller.ts; EMAIL_* unused in src
```

---

## 10. Working, partially working, and non-working summary

### Confirmed working

* JWT auth register/login/me and protected SPA shell
* Company-scoped CRM APIs for inbox, leads, tasks, team, settings, reports, dashboard
* Prisma schema + migrations present
* Outbox worker process start on server boot
* Voice realtime module structure and Twilio/OpenAI/ElevenLabs integration code
* Honest “not connected” messaging for payments/revenue

### Partially working

* WhatsApp (mock by default / cloud when configured)
* AI decisions (LLM optional; rules/templates always)
* AI outbound calls (needs Twilio + public webhook)
* Voice multi-tenancy (env company or oldest company fallback)
* Handoff/notification rules (stored; full runtime enforcement not fully proven)
* Reports (core metrics yes; revenue/schedule/export incomplete)
* Permissions JSON (editable, not route-enforced)

### UI present but not functional

* Header search, filters, bell
* Nav counts
* Logout control
* CSV import
* Schedule report
* Billing contact support
* Auth decorative metrics

### Backend present but not connected / unused

* `voiceProvider.service.ts` stub (unused)
* Legacy pipeline/handover/bookings/agents/outbound/knowledge page UIs (APIs still live)
* `EMAIL_*` env vars without code references
* Website chat channel without widget ingress

### Broken or conflicting behavior

* Frontend default API port **5001** vs backend default **5000** (mitigated if `.env` aligns both to 5001 — local env currently does)
* `backend/package.json` stripped to only `dev` script (docs/scripts claims in `PRODUCT.md` are stale)
* Frontend `npm run build` and `npm run lint` currently fail
* Backend `npx tsc --noEmit` fails heavily under `verbatimModuleSyntax` without `"type": "module"`
* `AI/.env` is **tracked in git** (Critical process risk even if currently only `VITE_API_BASE_URL`)

### Unverified behavior

* Live Meta WhatsApp delivery and webhook verify round-trip
* Live Twilio inbound/outbound + Realtime quality
* ElevenLabs production audio quality under load
* Database migration apply on clean environments via documented npm scripts (scripts missing)
* Notification rule / handoff rule execution during every AI path
* Recording playback across all browsers/devices

---

## 11. Mock, static, and hardcoded data inventory

| Location | Data or behavior | Type | Current purpose | Production replacement required |
| -------- | ---------------- | ---- | --------------- | ------------------------------- |
| `CompanySettings.whatsappProviderMode` default `mock` | Mock provider | Mock data / mode | Local demo without Meta | Require cloud credentials in prod; refuse mock in production |
| `whatsappProvider.service.ts` mock branch | Skip send | Fake API response | Dev safety | Cloud-only in prod |
| `voiceProvider.service.ts` | Mock call IDs | Mocked | Unused CRM abstraction | Remove or implement; do not use for prod calling |
| `voice.controller.ts` defaults | “Kadam Web Design” branding/pricing | Hardcoded value | Demo voice persona | Per-company settings only |
| `webhook.controller.ts` verify token fallback `airadesk_verify_token` | Hardcoded fallback | Temporary fallback | Dev convenience | Fail closed without env/settings token |
| `landingpage.tsx` nav `count: 0` | Static | Placeholder | Layout | Live counts from APIs |
| `AuthPage` metric zeros | Static | Placeholder | Marketing panel | Remove or wire real marketing site |
| Dashboard/reports/AI CEO payments | Explicit null + messages | Honest stub | Avoid fake revenue | Real billing/payments integration |
| `reports.tsx` schedule alert | Simulated unavailable feature | Placeholder | UX honesty | Scheduler + delivery channel |
| `prisma/seed/demoData.ts` | `demo@airadesk.com` / `123456`, Demo Company | Seed data / demo credential | Local bootstrap | Non-default passwords; no shared demo in prod |
| AI CEO `quickQuestions` | Static prompts | Static data | UX shortcuts | Optional keep |
| Task AI call default purpose/notes | Placeholder strings | Placeholder | Form defaults | Company templates |
| Inbox/Settings DEMO badge for mock WA | Status chip | Demo behavior | Operator clarity | Keep as warning in staging only |

---

## 12. Known issues and technical inconsistencies

| Issue | Evidence | Notes |
| ----- | -------- | ----- |
| Frontend lint fails | `npm run lint` → exit 1; 54 errors / 15 warnings | Mostly `react-hooks/set-state-in-effect` and exhaustive-deps |
| Frontend build fails | `npm run build` → exit 2; ~43 `tsc` errors | `verbatimModuleSyntax` type-only imports; unused imports; one `calls.tsx` type error |
| Backend `tsc --noEmit` fails | ~781 errors | `verbatimModuleSyntax` + missing `"type":"module"` / CJS vs ESM conflict |
| Incomplete backend package.json | Only `"scripts":{"dev":"nodemon"}` | Dependencies exist in lockfile/`node_modules` but manifest is hollow |
| Stale PRODUCT.md claims | Seed email, npm script names, API default port | Do not trust without re-verification |
| Port mismatch defaults | `api.ts` → 5001; `server.ts` → 5000 | Env currently aligns to 5001 |
| Tracked `AI/.env` | `git ls-files` shows `AI/.env` | Should be untracked + gitignored |
| Empty root `.gitignore` | File size 0 | Relies on nested gitignores |
| No project tests | No `*.test.*` / `*.spec.*` | Quality risk |
| No CI/CD or Docker | None found | Deployment undefined |
| Webhook signature validation absent | Grep found no Twilio/Meta signature checks | Security risk |
| Duplicate UI implementations | Legacy pages + consolidated pages | Maintainability debt |
| Controller size | `voice.controller.ts` ~4869 lines | Hard to test/review |
| EMAIL env without code | `.env` has EMAIL_* | Dead configuration |

No classic `TODO`/`FIXME` comments were found under application `src` trees; incompleteness is expressed via “not connected” runtime messages instead.

---

## 13. Unknowns requiring product-owner clarification

1. Is production tenancy **one Twilio number / WhatsApp number per company**, or shared numbers with routing rules?
2. Should `VOICE_COMPANY_ID` remain env-global, or must every inbound call resolve purely from dialed number → company mapping in DB?
3. Which AI actions may auto-execute in production vs draft-only (`aiReplyMode`)?
4. Are handoff/notification rules meant to send SMS/email/WhatsApp to staff, or only create tasks/UI flags?
5. Is website chat in-scope for v1, and which widget/provider?
6. Is email a real channel for v1, or should EMAIL filters/env be removed?
7. What is the billing model (seat-based, usage voice minutes, WhatsApp conversation pricing), and which processor?
8. Should STAFF be blocked from Settings, Reports, Team, or AI CEO?
9. What is the retention policy for call recordings, transcripts, and WhatsApp media?
10. Are legacy standalone pages permanently retired, or temporarily hidden?
11. What industries need distinct playbooks beyond the current enum heuristics?
12. Should demo seed credentials ever ship to shared environments?
13. What SLA/latency targets define “production voice quality” beyond the local perf harness?
14. Who is the system of record for CRM stages vs conversation status enums?

---

## 14. Product audit conclusion

**What the demo successfully proves**

* A coherent multi-tenant AI CRM shell can operate over PostgreSQL with JWT auth.
* Inbox/Leads/Tasks/Team/Settings/Reports/AI CEO form a believable owner workspace.
* A serious realtime voice stack (Twilio + OpenAI ± ElevenLabs) is integrated in-repo, with latency tooling.
* WhatsApp Cloud send/receive is implemented behind an explicit mock/cloud switch.
* The product avoids faking revenue by marking payments disconnected.

**What cannot yet be considered production functionality**

* Hardened multi-tenant channel ingress
* Full RBAC / permission enforcement
* Billing
* Website chat & email channels
* Reliable build/test/deploy pipeline
* Operable logout/session lifecycle UX
* Guaranteed live Meta/Twilio behavior without environment-specific verification

**Most critical product decisions needed next**

* Tenant ↔ phone/WhatsApp number mapping model
* AI autonomy policy (auto-send vs draft)
* Role matrix for Settings/Team/Reports
* Channel scope for v1 (voice + WhatsApp only?)
* Billing approach

**Most important implementation gaps**

* Webhook authentication/signature verification
* Packaging, CI, tests, observability
* Replace env-global voice company fallback
* Remove or finish mock modes for production
* Fix frontend/backend typecheck health
* Stop tracking env files; complete backend package manifest

---

*End of Product Current State audit.*
