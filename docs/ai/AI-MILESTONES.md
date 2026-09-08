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

**Status:** Implemented; AI-M4 and AI-M5 are approved.
**Delivered boundary:** Server-resolved `StudentPrincipal` contract, canonical subject validation, private subject-immutable Conversations, immutable ordered Messages, idempotent turns, one active Response per Conversation, durable bounded response chunks, streaming/partial/failure/cancellation lifecycle, and explicit C4 raw-content deletion purge through migration `0018_soft_zaran`; deleted Response tombstones retain the opaque top-level idempotency identity.
**Explicit boundary:** No production Student authentication, entitlement, public Student AI API, Provider execution, Policy/Context engine, RAG, memory, compaction, telemetry, or Admin/Mobile AI UI was added in M4.

## AI-M5 — Policy & Context Engine

**Status:** Implemented; AI-M5 is approved.
**Delivered boundary:** Governed revisioned Global/Subject Instruction Policies, one identity per Global/Subject scope, a separate revisioned Context Policy, structural Global-over-Subject precedence, provider-neutral token-estimator boundary, deterministic bounded ContextBudgetManager, bounded recent-turn and optional-summary consumption, reserved Memory/Evidence budget slots, and metadata-only immutable Context Snapshots/items through migration `0019_abnormal_kid_colt`.
**Explicit boundary:** No final Product Policy text was seeded; no Student authentication, entitlement, public API, Provider call, RAG, Knowledge, Memory, summary generation, compaction job, Tutor, or Admin/Mobile AI UI was added.

## AI-M6 — Knowledge Domain

**Status:** Implemented; AI-M6 is approved.
**Delivered boundary:** Governed Knowledge Source identities and immutable metadata revisions; strict `pythagoras.knowledge-package` V1 inspection; hash-pinned local package artifacts; bounded Change Set metadata with OWNER publication; normalized immutable Package/Document/Asset-binding rows; source rights/trust and published-only eligibility; and a canonical read-only Question Knowledge Projector that preserves Package/Package-content, Question, Variant, Occurrence, taxonomy, subject, and revision identity. Migration `0022_knowledge-package-source-subject-consistency` adds the database-level Package/Source subject invariant.
**Explicit boundary:** No real corpus was imported; no AI-assisted ingestion, OCR/PDF extraction, retrieval, chunks, embeddings, vector index, reranking, Evidence Pack, web search, Provider call, Conversation flow, Student/Admin AI UI, or AI-M7 runtime was started. Migration `0021_nifty_komodo` remains the Knowledge storage migration; `0022` is a focused canonical-boundary correction.

## AI-M7 — Retrieval Engine

**Status:** Implemented and approved; AI-M7A, AI-M7B, and AI-M7C are approved, making AI-M7 Retrieval Engine complete.

### AI-M7A — Chunk Projection & Lexical Retrieval Foundation

**Status:** Implemented; AI-M7A is approved.
**Delivered boundary:** Bounded published Knowledge/Question source readers; deterministic `structured-rich-v1` RichDocument chunking with hard byte bounds; revisioned rebuildable C3 projection sets/revisions/chunks; a separate SQLite FTS5 lexical index; bounded provider-neutral lexical retrieval with safe query generation and subject/current-source eligibility; projection health and stale detection; explicit BUILDING/READY/FAILED atomic activation without durable embedding Jobs; and persisted BUILDING resume discovery plus SQLite lifecycle/ownership protections through `0024_sad_speed`.
**Explicit boundary:** No embeddings, vectors, semantic retrieval, hybrid fusion, reranking, EvidencePack, Provider call, real corpus import, Student/Admin AI UI, or M7B/M7C runtime was added.

### AI-M7B — Embedding Projection, VectorIndexAdapter & Durable Projection Jobs

**Status:** Implemented; AI-M7B is approved.

**Delivered boundary:** Exact fresh/current M7A prerequisites; one-model/no-fallback semantic indexing through `AIProviderGateway.embed`; pinned Model/Provider revision identity; durable reference-only `ai.retrieval.embedding-build` Jobs with existing lease/fencing/retry/dead-letter semantics; conservative `KNOWLEDGE_INDEXING` admission and cost attribution; immutable/rebuildable Embedding Projection sets/revisions; versioned Float32 little-endian vector storage; provider-neutral local exact cosine `VectorIndexAdapter`; subject/live-Source eligibility; coverage/health/stale checks; and migration `0025_sharp_raza`. The current correction also requires explicit fail-closed active-search eligibility, exact revision health, and a bounded durable terminal reconciler over unresolved Embedding Projection work using relational ownership rather than payload parsing; terminal projection failure is the durable progress marker.
**Explicit boundary:** No production Provider/vendor was selected, no real network call, no external Vector DB or extension, no query-text embedding, hybrid fusion, RRF, reranking, EvidencePack, Grounded Tutor, Student/Admin AI UI, Agent 2, Memory, Evals runtime, or real corpus import was added in M7B.

### AI-M7C — Hybrid Retrieval, Deterministic Fusion, Optional Reranking & EvidencePack

**Status:** Implemented and approved.

**Delivered boundary:** Governed subject-bound Retrieval Config identities/revisions through Change Sets and OWNER publication; append-only SQLite Config history and server-pinned `weighted-rrf-v1@1` identity through correction migration `0027_many_chat`; exact published M7A/M7B coverage gates; bounded exact lexical and per-origin semantic retrieval with a global semantic candidate limit; deterministic integer weighted Reciprocal Rank Fusion; optional single-model reranking with strict result validation; exact eligible-origin final scope fencing; live Source rights and projection/model/config final fences; preserved bounded Question occurrence/taxonomy provenance; caller-owned Student-generation Cost Operation and EXECUTING Budget Reservation attribution without settlement; and bounded runtime-only EvidencePacks with provenance, trust, scores, inclusion signals, and no query persistence. Migration `0026_steady_turbo` contains the safe Retrieval Config metadata; `0027_many_chat` contains only its lifecycle/version hardening.
**Explicit boundary:** No Grounded Tutor execution, Generation, conversation orchestration, Web Search, durable Retrieval Trace, memory, eval runtime, external vector technology, vendor SDK, or production Provider was added. AI-M7 Retrieval Engine is approved/complete.

## AI-M8 — Grounded Tutor

**Status:** Complete; AI-M8A, AI-M8B, and AI-M8C are approved.

### AI-M8A — Tutor Configuration, Preflight, Grounded Generation Plan & Response Trace Foundation

**Status:** Implemented and approved.
**Delivered boundary:** Governed `ai.tutor-config` identities/revisions through Change Sets and OWNER publication; server-owned `evidence-grounded-v1@1` and `evidence-ref-v1@1` protocols; canonical Conversation/M5 Context preflight; exact current Retrieval/Model/Provider/Budget/Rate Limit revision pinning; conservative integer nano-currency preflight cost estimates for QUERY embedding, optional reranking, and Generation including reasoning-capable output bounds; trusted internal request-bound EvidencePack validation and deterministic one-model/no-fallback Generation request planning over detached immutable runtime values; and metadata-only Response Trace tables with ownership/lifecycle protections and atomically sealed child references through migrations `0028_yellow_the_fury` and `0029_massive_rick_jones`.
**Explicit boundary:** M8A makes zero Generation, Embedding, or Rerank calls; it does not execute Hybrid Retrieval, create admission/reservations, settle cost, stream Conversation responses, validate generated citations, expose a Student API/UI, add tools/Web Search, persist prompts/content, or select a production Provider. M8B owns execution and M8C owns grounding/citation validation and replay hardening.

Migration `0030_require-unsealed-tutor-trace-creation` completes the M8A Trace creation hardening: every new Trace starts `PLANNED` and unsealed, and only the atomic repository seal may move it to sealed.

### AI-M8B — Grounded Generation Execution

**Status:** Implemented and approved at `c2ac566c97764b2f129301ea9bc51a630aeb2591`.
**Boundary:** One server-owned execution boundary from M8A preflight through one M7C EvidencePack, one admitted `STUDENT_GENERATION` operation/reservation, exact-pinned Gateway Generation, UTF-8-safe Conversation streaming, cumulative Generation usage accounting, metadata-only sealed Response Trace terminalization, and budget settlement. M8B permits only deterministic test Providers; no production Provider or vendor SDK is selected.

### AI-M8C — Grounding/Citation Validation & Integration Hardening

**Status:** Implemented and approved.
**Boundary:** Runtime-only deterministic validation of the fixed `evidence-ref-v1@1` citation protocol against the exact selected Evidence map; post-Generation M7C/M8A currentness fences; preservation of Provider usage on invalid output or races; exclusion of partial Assistant output from later Context; coherent terminal replay; fail-closed ambiguous in-flight replay; and final real M7→M8 integration coverage. No migration or second Provider/judge call.

## AI-M8 current review status

AI-M8A, AI-M8B, and AI-M8C are approved; AI-M8 Grounded Tutor is complete at `e73d6dc5ba4ae18c1bf4dd614b093b605849d179`.

## AI-M9 — Evals V1

**Status:** AI-M9A, AI-M9B1, and AI-M9B2 are approved/complete at `860b474bd146abb944c15f774afa88578b463a80`, `61d6de1276735f511712dd47797a2c6a6304fcf3`, and `815d9230dcbde77433f98d80a2d37e3b08e2faaa`; AI-M9 is complete.

### AI-M9A — Eval Domain, Versioned Suites, Deterministic Graders & Promotion Gates

**Status:** Approved/complete at `860b474bd146abb944c15f774afa88578b463a80`, including the deterministic-scoring and accounting-basis corrections.
**Delivered boundary:** Governed subject-bound `ai.eval-suite` and `ai.eval-case` identities with append-only revisions; exact ordered Case-revision manifests; explicit synthetic/curated/de-identified privacy classification; code-owned deterministic graders reusing M8C citation validation; fixed-point result/aggregate/gate records; immutable candidate/manifest fingerprints; bounded baseline/regression comparison; and recommendation-only outcomes. Migration `0031_nosy_roxanne_simpson` adds Eval storage and SQLite lifecycle/ownership protections; correction migration `0032_eval-scoring-boundary` pins result rows to deterministic Suite graders, freezes Case/Grader inputs at `SCORING`, requires complete manifests for recommendation, and keeps final cost gates conservative; correction migration `0033_eval-accounting-basis` seals post-terminal Usage and persists a safe immutable accounting basis for cost gates while preserving append-only Corrections.
**Explicit boundary:** Zero Generation, Embedding, Rerank, judge, Provider, network, Student/Admin/Mobile UI, automatic publication, production failure import, raw Student persistence, or chain-of-thought persistence.

### AI-M9B — Eval Execution & EVALS Economics

**Status:** Split into M9B1/M9B2; both checkpoints are approved/complete, with M9B2 at `815d9230dcbde77433f98d80a2d37e3b08e2faaa`.

#### AI-M9B1 — Target Execution, Bounded Scheduling & EVALS Economics

**Status:** Approved/complete at `61d6de1276735f511712dd47797a2c6a6304fcf3`.
**Delivered boundary:** Governed subject-bound Eval Execution Config; bounded exact Case Execution and target Job orchestration; EVALS admission and accounting; durable metadata-only synthetic M4 cleanup ownership; real internal M7C/M8A/M8C target composition using test adapters; bounded target latency observations; and migrations `0034_eval-target-execution`, `0035_eval-target-orchestration-hardening`, and `0036_eval-retry-lifecycle`.
**Explicit boundary:** Makes no supplementary Judge call; leaves Run scoring explicit.

#### AI-M9B2 — Supplementary LLM Judge, Qualitative Evaluation & Final M9 Integration

**Status:** Approved/complete at `815d9230dcbde77433f98d80a2d37e3b08e2faaa`.
**Delivered boundary:** Governed revisioned `ai.eval-judge-config` resources through Change Sets and OWNER publication; strict code-owned `eval-judge-v1@1` protocol formatting and non-repairing JSON parser; runtime-only in-memory handoff of candidate target answers and retrieved evidence to LLM Judge; dedicated distinct `EVALS` cost operations for Judge executions; strict prevention of self-judge (candidate model revision !== judge model revision); prohibition of Judge evaluating SECURITY dimension; integer scoring on 0..1,000,000 fixed-point scale with rubric bands (EXCELLENT, PASS, MARGINAL, FAIL); deterministic security blocker overrides; baseline comparability evaluation requiring identical Judge identity; candidate latency gate purity (excluding Judge latency); zero raw target output, evidence snippets, or judge rationale persisted to DB or disk; crash/re-entry fail-closed recovery; cancellation/lease propagation; proven Provider invocation verification; and migrations `0037_eval-supplementary-judge` and `0038_eval-judge-execution-hardening`.
**Explicit boundary:** Zero production Provider/network calls or vendor SDKs (in-process mock adapters only); no model repair loops; no automatic promotion/publication.

## AI-M10 — Memory & Compaction

**Status:** The M10R rebaseline is APPROVED/COMPLETE. The former M10A subject-only and former M10B extraction contracts are historical/superseded; AI-M10A2, M10B2, M10C, and M10D are implemented pending independent review, and AI-M10 is implemented pending independent review. AI-M11 is implemented pending independent review through migration `0045_sturdy_bill_hollister`; M12-M15 are not started.

### AI-M10A — Memory, Conversation Summaries & Context Selection

**Status:** Historical/superseded by the M10R scoped-memory baseline. The old subject-only approval at `d106e5bb3b82095e3d1b3abeab1f150237d87d06` remains part of the review history, but is not the current contract.
**Historical boundary:** The former checkpoint provided subject-bound Memory/Summary storage and Context selection through migrations `0039_glossy_sleepwalker` and `0040_wandering_invisible_woman`. Its approval is not erased; the scope and lifecycle contract is superseded by M10A2.

### AI-M10B — Historical Extraction, Compaction Jobs & Runtime Hardening

**Status:** Historical implementation under the superseded Memory mutation contract; not production-approved for the rebaselined M10 architecture.
**Historical boundary:** Migrations `0041_violet_nico_minoru` and `0042_memory-execution-commit-safety` remain readable for audit and compatibility. M10D schedules no new `memory-extraction-v1` executions; the active M10D path is Student-only Conversation Compaction. M10B2's same-call Agent-1 command is the current Memory mutation path.

### AI-M10R — Scoped Student Memory rebaseline

**Status:** APPROVED/COMPLETE as the new architecture baseline.
**Contract:** Memory is private to one server-resolved principal and has either `GLOBAL` scope with `subjectKey = NULL` or `SUBJECT` scope with one canonical subject. The closed educational kind vocabulary excludes generic personal-profile facts; Global `PREFERRED_NAME` and `FORM_OF_ADDRESS` are explicit-only. Current Memory state uses `PROPOSED`, `ACTIVE`, `RESOLVED`, `EXPIRED`, and `DELETED`; only `ACTIVE` is Context-eligible. Agent 1 may request one bounded Memory command in the same Tutor Generation; the server validates and applies it, while inferred proposals remain non-eligible until current-policy confidence/evidence and review rules permit activation. Explicit and inferred provenance is reference-only and rejects partial, cross-scope, and synthetic Eval turns.

### AI-M10A2 — Scoped Student Memory Storage, Policy, Provenance & Lifecycle Foundation

**Status:** Implemented pending independent review.
**Delivered boundary:** Migrations `0043_scoped-student-memory-foundation` and `0044_slippery_joshua_kane` add scoped policies, current-policy mutation authority/threshold triggers, stable/revisioned current Memory state, bounded provenance, metadata-only mutation intents/records, Conversation origin protection, deletion reconciliation, and repeatable principal purge. Historical Policy identities remain readable but cannot authorize new semantic mutation unless they are a newly governed cutover identity. The old second-pass extraction path is disabled for new work while historical execution/config/job rows remain preserved.

### AI-M10B2 — Trusted Agent-1 Memory mutation

**Status:** Implemented pending independent review.
**Delivered boundary:** The AI Provider Gateway accepts at most one strict `memory-command-v1@1` event alongside the visible Tutor answer. The command is runtime-only until a bounded metadata-only mutation intent is created after successful response validation; the same completed Tutor Generation applies it idempotently, with no second extraction Provider call. Failed, cancelled, partial, synthetic, stale, or invalid responses cannot create Memory.

### AI-M10C — Global + Subject Memory Context

**Status:** Implemented pending independent review.
**Delivered boundary:** M5 Context selects current-policy-eligible ACTIVE Global Memory for the principal and exact-subject ACTIVE Memory, with deterministic per-scope limits, memory-token budgeting, no cross-principal/subject leakage, and metadata-only Context Snapshots. Memory remains low-priority student personalization and never becomes policy or Evidence.

### AI-M10D — Conversation Compaction completion

**Status:** Implemented pending independent review.
**Delivered boundary:** Student-only completed turns can schedule bounded Compaction from a contiguous uncovered range ending at an Assistant message. Summary revisions are append-only and coverage is monotonic; deletion/input-loss fences prevent resurrection; duplicate Job replay is idempotent. New legacy Memory Extraction scheduling is disabled.

## AI-M11 — Intelligence Telemetry, Diagnostics & Feedback

**Status:** Implemented pending independent review through migration `0045_sturdy_bill_hollister`.
**Delivered boundary:** A closed/versioned append-only AI event contract, metadata-only Retrieval Trace and Tutor diagnostics, Memory/Compaction lifecycle telemetry, structured completed-Response feedback, stable pseudonymous analytics-principal mapping, bounded UTC time-bucket analytics read services, and relational principal purge. Telemetry correlates Response/Retrieval/Cost/Model/Provider/Config identities without copying raw C4 text. M3 remains canonical economic truth. M11 does not add UI, Agent 2, a production Provider, or M12-M15 work.

## Remaining future milestones

| Milestone | Coherent boundary | Independent exit gate |
| --- | --- | --- |
| **AI-M9 Evals V1** | Versioned Eval Suite, deterministic graders, supplementary judge adapter, regression cases, security/cost/latency gates | Baseline suites cover all required dimensions and block an unsafe or materially regressed promotion |
| **AI-M10 Memory & Compaction** | M10R approved baseline; M10A2/M10B2/M10C/M10D implemented pending review | No cross-user memory; server-owned same-call Memory commands; deterministic Global/Subject Context; bounded Student Compaction; no second-pass extraction; M10 remains pending independent review |
| **AI-M11 Intelligence Telemetry** | Implemented pending independent review: retrieval traces, feedback/events, de-identified analytics, usage read DTOs, and privacy-safe operational metrics | Analytics cannot reveal raw PII by default; response/retrieval/cost traces correlate end to end |
| **AI-M12 Agent 2 Read-only** | NOT STARTED | Deterministic event/SQL inputs, representative samples, optional clustering, structured analysis, and bounded Insight candidates remain future work |
| **AI-M13 Second Brain** | Relational Insight, evidence, typed relations, QuestionCluster, Misconception, KnowledgeGap, ExplanationPattern, RetrievalProblem | Typed relationships and provenance are queryable/visualizable; insights remain separate from curriculum truth |
| **AI-M14 Improvement Governance** | ImprovementProposal workflow, Eval evidence, Change Set adapters/coordinators, OWNER approval/publication, and rollback/rebuild plan | A proposal cannot self-activate; governed changes have complete approvals, revisions, conflicts, and post-publish trace |
| **AI-M15 Production Hardening** | Privacy/retention enforcement, abuse controls, provider risk review, disaster recovery, deletion/rotation operations, SLOs, and launch runbooks | Security, cost, resilience, deletion, provider outage, audit, and operational readiness gates pass for the approved launch scope |

## Sequencing rule

No Student AI UI, Admin application surface, or Second Brain graph visualization is a prerequisite for AI-M0. No milestone imports remaining Question/Literature data unless a separate Product decision authorizes it.
