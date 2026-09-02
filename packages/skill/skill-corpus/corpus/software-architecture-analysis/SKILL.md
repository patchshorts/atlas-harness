---
name: software-architecture-analysis
description: "Write comprehensive software architecture analysis documents — system design, component inventory, data flow, auth, queue, database schema, deployment. The architectural blueprint that precedes implementation planning."
version: 1.0.0
author: Atlas AI
category: software-development
tags:
  - architecture
  - system-design
  - analysis
  - documentation
  - planning
related_skills:
  - writing-plans
  - plank-detail
  - agent-skills
---

# Software Architecture Analysis

## Overview

Write comprehensive software architecture analysis documents that define **all components** of a system before any implementation begins. This is the architectural blueprint phase — it precedes `writing-plans` (implementation planning) and `plank-detail` (task decomposition).

**Design principle: prefer existing infrastructure over new infrastructure.** Before proposing Redis, a queue system, a separate database, or any new service, inventory what the existing platform already provides. Use what's there until volume justifies adding more. This keeps architecture analysis grounded in reality and avoids over-engineering.

**What this skill produces:**
- A structural analysis of a complete software system
- Every component defined with its technology, purpose, and data flow
- Database schema (tables, relationships, indexes)
- Authentication and authorization design
- Queue/async system design
- Frontend component tree
- Backend service/endpoint map
- Deployment and infrastructure plan
- Build order (phases, not atomic tasks)

**What this skill is NOT:**
- NOT implementation planning (that's `writing-plans`)
- NOT task decomposition (that's `plank-detail`)
- NOT a full engineering lifecycle (that's `agent-skills`)
- NOT a single pull request design

## When to Use

Use this skill when the user asks for:
- "Software development analysis" or "system architecture"
- "Define all the components needed"
- Architecture design or blueprint
- "Design a system with X, Y, Z"
- Full-stack design with auth, queue, database
- System integration into an existing platform/monorepo

Do NOT use this skill for:
- Writing code (load `writing-plans` or `test-driven-development`)
- Debugging (load `systematic-debugging`)
- Single-feature implementation plans (load `writing-plans`)

## Architecture Document Structure

Every architecture analysis follows this structure. Adjust section depth based on complexity.

### 1. Context & Platform Integration (Required)

Before designing anything, establish:
- **Existing platform context** — what monorepo, submodules, tech stack does this integrate into?
- **Existing components** — what already exists and what gets modified vs created
- **Constraints** — tech stack, hosting, team size, timeline
- **Design philosophy** — user preferences about standalone vs integrated, auth model, etc.

**Pattern:**
```
## 1. Context

**Platform:** The system builds into the X monorepo at ~/code/x-all/
**Existing stack:** Vue 3 + Tailwind + Pinia (frontend), Flask (backend), PostgreSQL, Redis
**New domain:** Report service as a new route module under /reports
**Auth model:** Google OAuth/OIDC only (no password registration)
```

### 2. Architecture Overview Diagram (Required)

ASCII or text system diagram showing the major components and data flow. Show only the components you actually need — do not include Redis or a queue unless the analysis justifies one:

```
                         ┌──────────────────────┐
                         │    Google OAuth 2.0   │
                         └────────┬─────────────┘
                                  │
┌──────────┐     ┌────────────────▼─────────────────┐
│  Browser │────▶│    Frontend (Vue 3)               │
│  (User)  │     │  Login • Dashboard • Report View  │
└──────────┘     └────────────────┬─────────────────┘
                                  │ REST + JWT
                                  ▼
┌────────────────────────────────────────────────────┐
│  Backend (Flask API Gateway)                        │
│  Auth Routes • Report Routes • Notification Routes │
└─────┬──────────┬──────────────────┬────────────────┘
      │          │                  │
      ▼          ▼                  ▼
 Strapi (DB)  SMTP (Email)    File System (PDFs)
```

If a queue IS justified, add it to the diagram:

### 3. Component Tree — Complete Inventory (Required)

List every component with technology, purpose, and whether it's new or modified.

**Frontend components:**
| Route/View | Technology | Description |
|------------|-----------|-------------|
| `/login` | Vue component | Google OAuth login button |
| `/reports` | Vue component | Dashboard listing reports |

**Backend services:**
| Service | Technology | Endpoints |
|---------|-----------|-----------|
| AuthService | Flask | POST /api/auth/google-login, POST /refresh |

**Database tables:**
| Table | Key Fields | Purpose |
|-------|-----------|---------|
| users | id, google_id, email | User accounts |

### 4. Authentication & Authorization (Required)

Full auth flow specification:

```
Flow:
1. Frontend redirects to Google OAuth
2. Google sends auth code to callback
3. Backend exchanges code for tokens
4. Backend validates OIDC ID token (JWKS, iss, aud)
5. Backend creates/updates user, issues JWT
6. Frontend stores JWT, sends on all API requests
```

Include:
- OAuth scopes required (`openid email profile`)
- Token structure (JWT payload fields, expiry)
- Refresh token strategy
- Authorization rules (user-scoped data, admin role)

### 5. Database Schema (Required)

Full SQL schema with:
- All tables, columns, types, constraints
- Foreign key relationships
- Indexes
- JSONB storage strategy (if applicable)
- Visual relationship diagram (ASCII)

Include why you chose direct PostgreSQL vs existing CMS (like Strapi) if that's a decision:
```
**Strapi content types (not direct PostgreSQL):** The platform already has Strapi (the-data-broker) with
PostgreSQL underneath. Creating Strapi collection types avoids managing a second DB connection,
migrations, and connection pooling. Strapi REST overhead (~50ms per call) is negligible at <5 req/min.
Only switch to direct PostgreSQL if polling frequency exceeds 10 req/min per user.
```

### 6. Queue / Async System (If applicable)

**First question: do you actually need a queue?**

For low volume (<20 operations/day), synchronous HTTP with a frontend spinner is simpler and has zero infrastructure cost. A 30-60s synchronous request with a loading spinner is acceptable for single-digit daily volume. Only add Redis + RQ or Celery when throughput demands it.

**Decision framework:**
| Volume (ops/day) | Approach | Infrastructure Added |
|-----------------|----------|---------------------|
| 0-20 | Synchronous HTTP (30-60s spinner) | None |
| 20-100 | Simple queue (Redis + RQ) | Redis server, 1-2 workers |
| 100+ | Full queue (Celery + RabbitMQ) | RabbitMQ, multiple workers |

If a queue IS justified, document it fully:

| Queue | Tech | Workers | Max Duration |
|-------|------|---------|-------------|
| report-gen | Redis + RQ | 1-2 | 60s |
| pdf-export | Redis + RQ | 1 | 20s |

Include:
- Queue topology (which queues, what routes to what worker)
- Job lifecycle (created → queued → running → completed/failed)
- Job record schema (id, type, status, payload, result, error, retry_count)
- Frontend polling pattern (how the UI shows progress)
- Why this queue tech over alternatives

### 7. Report Data Contract (If applicable)

JSON schema for the core data object that flows through the system:

```json
{
  "version": "1.0",
  "section_scores": { "listings": 72, "reviews": 68 },
  "sections": [{ "id": "listings", "label": "Listings", "score": 72 }],
  "priorities": [{ "rank": 1, "title": "Fix GBP", "impact": "HIGH" }]
}
```

### 8. Email / Notification System (If applicable)

| Email Type | Trigger | Template | Transport |
|-----------|---------|----------|-----------|
| Report Ready | Job completes | report_ready.html | SMTP |

Include template examples and SMTP configuration.

### 9. File Layout

Exact file paths within the monorepo for every new/modified file. Use a tree:

```
monorepo/
├── frontend/src/
│   ├── views/report/
│   │   └── ReportDashboard.vue
│   └── stores/
│       └── useReportStore.ts
├── backend/
│   ├── blueprints/
│   │   └── reports_bp.py
│   └── services/
│       └── email_service.py
└── data/reports/pdfs/
```

### 10. Technology Choices — Rationale (Required)

| Component | Choice | Why Not Alternatives |
|-----------|--------|---------------------|
| Frontend | Vue 3 + TS | Already in platform |
| Auth + data | Strapi (existing) | Platform already runs Strapi. No new DB or auth code. |
| Report generation | Synchronous HTTP | <5/day volume. 30-60s spinner in UI. No queue infra needed. |
| PDF export | Playwright HTML → PDF | Already installed. Synchronous in-request. |

Defend every major choice. If the user's existing stack already dictates the choice, say so — it shows you understood the platform context.

### 11. Security Considerations

| Risk | Mitigation |
|------|-----------|
| Token interception | code flow (not implicit), server-side exchange |
| Unauthorized access | user_id check on every request |

### 12. Build Order (Phases)

Not atomic tasks (that's `writing-plans`), but phased milestones. Phases depend on whether a queue is needed:

**Without queue (synchronous, using existing platform):**
```
Phase 1: Strapi Setup (1 day) — content types, OAuth provider, permissions
Phase 2: Auth — Vue + Strapi (1 day) — login button, JWT storage, router guard
Phase 3: Backend API (3-4 days) — report generation, data collection, PDF export
Phase 4: Frontend (2-3 days) — dashboard, intake form, report viewer, spinner
Phase 5: Email + Polish (2-3 days) — SMTP templates, nginx, end-to-end test
Total: ~10-14 days
```

**With queue (async, new infrastructure):**
```
Phase 1: Auth Foundation (2-3 days) — OAuth setup, login, user table
Phase 2: Database & Models (1-2 days) — 4 tables, migrations
Phase 3: API + Queue (3-4 days) — CRUD endpoints, Redis, workers
Phase 4: Frontend (3-4 days) — all views and components
Phase 5: Email & Notifications (1-2 days) — templates, SMTP
Phase 6: Polish & Deploy (2-3 days) — SSL, nginx, test
Total: ~14-20 days
```

## Cross-Document Consistency Rule

**After writing the architecture analysis, you MUST patch any existing analysis documents that reference the system design to account for the new architecture.**

This is a critical step that is easy to skip. The architecture analysis introduces changes that existing docs don't account for:
- New auth model (Google Login) that existing docs didn't account for
- New delivery model (web app + auth-gated, not just email PDF)
- New infrastructure (queue workers, database tables, or alternatively using existing Strapi)
- Modified workflows (intake now happens in authenticated web form)

For each existing document:
1. Read it to see where the new architecture changes assumptions
2. Patch tool: update workflow diagrams, add auth phase, update tool stack tables
3. Update MVP/build plan to reflect the architecture decisions

**Pattern:**
```
After writing the architecture doc, you patched:
- anatomy doc: added Auth section to report structure
- service blueprint: added auth phase, web delivery, updated tool stack
```

## The Architecture Analysis Workflow

### Step 1: Read Existing Context

Read all related analysis documents and entity files. Understand:
- What already exists (platform, monorepo, submodules)
- What has been decided (tech stack, constraints, pricing)
- What needs to change (docs that reference the old approach)

### Step 2: Platform Inventory (Platform-First Design)

Before designing anything new, inventory what the existing platform provides:

1. **Does the platform already have a user/auth system?** (Strapi, Firebase, built-in JWT, etc.)
2. **Does the platform already have a data store?** Can you use existing CMS/tables instead of creating new ones?
3. **Does the platform already have async processing?** Cron jobs, webhooks, worker pools?
4. **Does the platform already have email sending?** SMTP config, mailgun, SES?

**Rule: Only add new infrastructure when the existing platform provably cannot handle the need.** "Provably" = you have specific evidence (e.g., "Strapi REST overhead adds 100ms per call and the frontend polls every 2s"). Use existing infra by default; justify new infra with concrete constraints.

**Example of applying this rule:**
- Existing platform has Strapi (PostgreSQL) → use Strapi content types, not direct PostgreSQL tables
- Existing platform has Strapi Grant OAuth → use that for Google login, don't write custom OAuth code
- Report generation takes 30-60s → synchronous HTTP is fine at low volume. No queue needed.
- Only add Redis + RQ when: volume exceeds 20 reports/day AND the 60s HTTP wait becomes unacceptable.

### Step 3: Understand the Integration Target

The system will likely integrate into an existing platform. Read:
- Entity files describing the platform (`entities/the-platform-repo.md`)
- Existing submodule tech stacks
- Deployment and infrastructure context

### Step 4: Design All Components

Iterate through each component section:
1. Architecture overview diagram
2. Component tree (every piece)
3. Auth flow
4. Database schema
5. Queue system (if needed)
6. Data contracts
7. Email/notifications
8. File layout
9. Technology rationale
10. Security
11. Build order

### Step 4: Write the Architecture Document

Write to `wiki/report-service-software-analysis.md` (or appropriate path in the knowledge graph).

### Step 5: Patch Existing Documents

Scan all existing analysis docs that relate to this system. For each one:
- Does the new architecture change any assumptions?
- Does it add a phase/stage/step that the old doc doesn't mention?
- Does it require new dependencies or infrastructure?
- If yes to any: patch the document.

### Step 6: Save

Commit all changes (new + patched files) with a descriptive message.

## Common Mistakes

**Skipping platform integration context.** If the system builds into a monorepo, you must understand the existing submodules and tech stack. Designing a standalone system when the user said "built into our X stuff" wastes the architecture.

**Writing only the components, not the auth flow.** Auth touches everything — frontend, backend, database, API routes. If you forget to design the full OAuth/OIDC flow, the architecture is incomplete.

**Forgetting the queue lifecycle.** If you do add a queue, define more than just "use Redis." Include: job creation, status tracking, frontend polling, failure handling, retry strategy.

**Defaulting to a queue before evaluating sync.** A synchronous HTTP request with a frontend spinner is the simplest option. Only reach for Redis + RQ or Celery when throughput exceeds what sync can handle. Queue infrastructure adds a Redis dependency, worker processes, and frontend polling complexity.

**Writing architecture that ignores what the existing platform provides.** If the platform has Strapi (auth, database, REST API, Google OAuth), use it. Designing custom OAuth, separate database tables, or a queue system when the platform already covers those needs shows you skipped the platform inventory step. This gets corrected by the user.

**Not patching existing docs.** The architecture analysis changes assumptions in earlier documents. Skipping the patch step means the knowledge graph becomes inconsistent. The document + cross-document consistency is the deliverable.

**Using architecture doc as implementation plan.** The architecture analysis defines *what* exists and *how it connects*. Implementation planning (`writing-plans`) defines *how to build it step by step*. Keep them separate.

**Abstract technology rationales.** Don't say "Redis is fast enough." Say "Redis + RQ — Celery overkill for <100 jobs/day. SQLite polling too slow for 2s poll intervals." Every rationale should reference a concrete constraint.

## Reference Files

This skill has no reference files yet. When you encounter a unique architecture pattern (multi-tenant, event sourcing, CQRS, streaming, etc.), consider saving a reference document under `references/<pattern>.md` for reuse.
