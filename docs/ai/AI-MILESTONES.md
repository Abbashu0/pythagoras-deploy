# AI milestone plan

AI milestones are future delivery boundaries. Each milestone is one coherent commit, independently testable, reviewed before the next milestone begins, and must preserve the current Pythagoras content/governance architecture.

## AI-M0 — Architecture Lock & Backend Readiness Specification

**Status:** Documentation and repository audit completed by this document set.
**Exit gate:** Domain boundaries, invariants, trust model, economics, RAG contract, privacy rules, Eval/improvement rules, current discrepancies, and launch dependencies are independently reviewable. No runtime code or schema is added.

## AI-M1 — Configuration & Secrets

**Status:** Implemented as the first runtime AI milestone.
**Delivered boundary:** Governed safe Provider configuration, opaque credential references, a replaceable `AISecretStoreAdapter`, local AES-256-GCM secret storage under `PYTHAGORAS_DATA_DIR`, secret lifecycle audit metadata, redacted DTOs, and migration `0011_ai-provider-configuration-and-secrets`.
**Explicit boundary:** No Provider Gateway, inference, health/test-connection call, Student/Admin AI UI, or external provider SDK was added.

## AI-M2 — Provider Gateway & Model Registry

**Status:** Implemented as the second runtime AI milestone.
**Delivered boundary:** Governed `ai.model-config` records through Change Sets and OWNER publication; separate Generation, Embedding, and Reranker adapter contracts; a server-registered adapter registry; a provider-neutral Gateway with capability checks, request-scoped credential resolution, timeout/cancellation, normalized errors/usage, explicit fallback, and safe per-attempt traces; and a validated outbound target/transport boundary. Migration `0012_ai-model-registry` adds only safe model metadata.
**Explicit boundary:** No production provider or vendor was selected, no external provider call or SDK was added, and no Student AI, conversation, RAG, budget/cost ledger, or Admin/Mobile AI UI was implemented. Deterministic fakes are test-only.

## AI-M3 — Operations Core

**Status:** Complete; AI-M3A, AI-M3B, AI-M3C1, and AI-M3C2 are implemented reviewed checkpoints.

### AI-M3A — Economics & Usage Accounting

**Status:** Implemented.
**Delivered boundary:** Governed immutable Rate Card revisions, exact nano-currency calculation, recurring IANA-timezone pricing bands, billing-safe usage normalization, immutable cost-operation/usage observations, append-only corrections, historical model/rate reconstruction, and cumulative Generation usage aggregation. Migration `0013_ai-economics-and-accounting` adds only canonical accounting and pricing rows.
**Explicit boundary:** No budget enforcement, reservation/settlement, rate limits, circuit breakers, durable jobs, real Provider pricing, external Provider call, or Student/Admin AI UI was added in M3A; those controls are the separately reviewed M3B boundary.

### AI-M3B — Budget & Admission Control

**Status:** Implemented; AI-M3B is approved.
**Delivered boundary:** Governed revisioned `ai.budget-policy` and `ai.rate-limit-policy` resources; exactly one principal/policy-identity/period Budget Account pinned to a policy revision; atomic pre-execution reservations; idempotent server-owned admission plans and safe request fingerprints; M3A-backed exposure snapshots and settlement; reconciliation handling for unknown/partial/multi-currency cost; immutable lifecycle ledger entries; persisted sliding-window request events with retry metadata; and principal/policy concurrency limits. Migration `0014_cynical_bloodscream` adds the policy and admission-control tables; migration `0015_cynical_vulcan` adds the stable-period uniqueness invariant.
**Explicit boundary:** No Student authentication or entitlement service was invented, no `$2` allowance was seeded or hard-coded, no Provider call or Student/Admin AI UI was added, and no Circuit Breaker or Durable Job runtime was started.

### AI-M3C — Durable Jobs & Operations

**Status:** Refined into independently reviewed checkpoints; both checkpoints are approved.

#### AI-M3C1 — Durable Jobs, Outbox & Recovery

**Status:** Implemented; AI-M3C1 is approved.
**Delivered boundary:** SQLite-backed at-least-once Jobs with versioned reference-only payloads, closed handler registry, dedupe, priority scheduling, fenced leases/generations, heartbeats, attempts, timeout/cancellation behavior, deterministic retry/backoff, dead letters, expired-lease recovery, transactional Outbox and closed router registry, atomic Outbox-to-Job dispatch, standalone `ai:worker -- --once` runtime, and M3B stale-reservation/reconciliation recovery.
**Explicit boundary:** No provider execution, Student auth/entitlement, Admin/Mobile UI, Circuit Breaker, health probe, RAG, or AI-M4 conversation runtime was added.

#### AI-M3C2 — Circuit Breakers & Operational Health

**Status:** Implemented; AI-M3C2 is approved.
**Delivered boundary:** Governed revisioned Circuit Breaker Policies, persistent exact-route Circuit state with CLOSED/OPEN/HALF_OPEN fencing and probes, passive health observations for Generation/Embedding/Rerank, circuit-aware Gateway fallback, safe operational health views, and migration `0017_lean_oracle`.
**Explicit boundary:** No active synthetic health probe, production Provider adapter, external Provider call, Student auth/entitlement, Admin/Mobile AI UI, RAG, or AI-M4 conversation runtime was added.

## AI-M4 — Conversation Core

**Status:** Implemented; pending independent review.
**Delivered boundary:** Server-resolved `StudentPrincipal` contract, canonical subject validation, private subject-immutable Conversations, immutable ordered Messages, idempotent turns, one active Response per Conversation, durable bounded response chunks, streaming/partial/failure/cancellation lifecycle, and explicit C4 raw-content deletion purge through migration `0018_soft_zaran`; deleted Response tombstones retain the opaque top-level idempotency identity.
**Explicit boundary:** No production Student authentication, entitlement, public Student AI API, Provider execution, Policy/Context engine, RAG, memory, compaction, telemetry, or Admin/Mobile AI UI was added.

## Remaining future milestones

| Milestone | Coherent boundary | Independent exit gate |
| --- | --- | --- |
| **AI-M5 Policy & Context Engine** | Global/subject policy revisions, ContextBudgetManager, bounded summaries/recent turns, output constraints, and context audit | Budget plan is deterministic/revisioned; hard/soft limits and policy precedence pass representative tests |
| **AI-M6 Knowledge Domain** | Knowledge Sources, `pythagoras.knowledge-package`, validation, publication, source trust, and Question/Knowledge projector boundaries | Published-only eligibility, provenance, revisioning, rights metadata, and governed publication pass |
| **AI-M7 Retrieval Engine** | Chunk projections, embedding jobs, VectorIndexAdapter, lexical/semantic hybrid retrieval, deterministic fusion, reranking, and Evidence Pack | Scope/trust filtering, rebuildability, minimum evidence threshold, scores, and projection health pass; no permanent external vector DB is required |
| **AI-M8 Grounded Tutor** | Grounded Tutor Orchestrator, evidence-constrained generation, insufficient-evidence behavior, streaming response, and response trace | End-to-end fake-provider tests prove subject scope, grounding, trace completeness, budget accounting, and no tool/secret escape |
| **AI-M9 Evals V1** | Versioned Eval Suite, deterministic graders, supplementary judge adapter, regression cases, security/cost/latency gates | Baseline suites cover all required dimensions and block an unsafe or materially regressed promotion |
| **AI-M10 Memory & Compaction** | Student-scoped memory policy, memory extraction/review, conversation summaries, compaction revisions, deletion, and context selection | No cross-user memory; summaries are traceable; old history is preserved but not replayed by default; deletion propagates |
| **AI-M11 Intelligence Telemetry** | Retrieval traces, feedback/events, de-identified analytics, usage dashboards/data contracts, and privacy-safe operational metrics | Analytics cannot reveal raw PII by default; response/retrieval/cost traces correlate end to end |
| **AI-M12 Agent 2 Read-only** | Deterministic event/SQL inputs, representative samples, optional clustering, structured analysis, and bounded Insight candidates | Agent 2 cannot publish, mutate truth/credentials, message students, or bypass privacy/Evals; outputs are reproducible |
| **AI-M13 Second Brain** | Relational Insight, evidence, typed relations, QuestionCluster, Misconception, KnowledgeGap, ExplanationPattern, RetrievalProblem | Typed relationships and provenance are queryable/visualizable; insights remain separate from curriculum truth |
| **AI-M14 Improvement Governance** | ImprovementProposal workflow, Eval evidence, Change Set adapters/coordinators, OWNER approval/publication, and rollback/rebuild plan | A proposal cannot self-activate; governed changes have complete approvals, revisions, conflicts, and post-publish trace |
| **AI-M15 Production Hardening** | Privacy/retention enforcement, abuse controls, provider risk review, disaster recovery, deletion/rotation operations, SLOs, and launch runbooks | Security, cost, resilience, deletion, provider outage, audit, and operational readiness gates pass for the approved launch scope |

## Sequencing rule

No Student AI UI, Admin AI dashboard/forms, or Second Brain graph visualization is a prerequisite for AI-M0. Those surfaces may be designed only after the backend contract needed by their milestone is reviewed. No milestone imports remaining Question/Literature data unless a separate Product decision authorizes it.
