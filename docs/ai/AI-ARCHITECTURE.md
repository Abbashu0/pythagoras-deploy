# AI architecture lock

**Milestone:** AI-M0 — Architecture Lock & Backend Readiness Specification
**Status:** AI-M0 through AI-M9 are approved/complete. AI-M10R is APPROVED/COMPLETE as the scoped Student Memory rebaseline; the former subject-only M10A and former M10B mutation/extraction contracts are historical/superseded. AI-M10A2, AI-M10B2, AI-M10C, and AI-M10D are implemented pending independent review; AI-M10 is implemented pending independent review; and AI-M11 is implemented pending independent review through migration `0045_sturdy_bill_hollister`. AI-M12-M15 are not started. No production provider is selected.

Current reviewed status: AI-M8A, AI-M8B, and AI-M8C are approved; AI-M8 is complete at `e73d6dc5ba4ae18c1bf4dd614b093b605849d179`. AI-M9A is approved/complete at `860b474bd146abb944c15f774afa88578b463a80`; AI-M9B1 is approved/complete at `61d6de1276735f511712dd47797a2c6a6304fcf3`; AI-M9B2 is approved/complete at `815d9230dcbde77433f98d80a2d37e3b08e2faaa`; AI-M9 is complete; M10R is approved/complete; AI-M10A2/B2/C/D and AI-M10 are implemented pending independent review.

## 1. Architectural position

Pythagoras AI is a provider-agnostic educational intelligence platform. A model is a replaceable compute engine, not the owner of curriculum truth and not the owner of the student relationship. The platform owns the durable policy, evidence, memory, conversation, cost, evaluation, and governance layers around that compute.

The production path is intentionally backend-owned:

```text
server-resolved StudentPrincipal
        |
        v
Student API boundary -> entitlement + rate limit + budget reservation
        |
        v
Conversation scope -> Policy -> ContextBudgetManager
        |                       |
        |                       v
        |                Hybrid Retrieval -> optional Reranker
        |                       |
        |                       v
        |                 bounded EvidencePack
        v                       |
Grounded Tutor Orchestrator --+
        |
        v
Provider Gateway -> GenerationProviderAdapter
        |
        v
streamed response + immutable Usage/Cost/Trace + budget settlement
```

Administrative and asynchronous paths are separate:

```text
OWNER-governed config / knowledge / eval / insight proposal
        -> Change Set -> review -> OWNER approval -> atomic publication
        -> durable outbox job -> rebuildable projections or analysis
```

No model output, student message, retrieval result, or Agent 2 proposal bypasses this ownership and publication boundary.

## Non-negotiable invariants

These rules apply to every future AI milestone:

1. Models and providers are replaceable.
2. Curriculum truth is not owned by model weights.
3. Only approved and published knowledge is eligible for production RAG.
4. Conversation subject scope is immutable.
5. Student input is untrusted.
6. Retrieved content is evidence/data, never executable instructions.
7. API credentials never enter Mobile, Git, logs, or normal configuration fields.
8. Raw chain-of-thought is not persisted or exposed as Product data.
9. Raw Student conversations never become curriculum truth automatically.
10. Agent 2 can observe, analyze, and propose, but cannot approve or publish.
11. RAG indexes and embeddings are rebuildable projections.
12. Every production answer has complete revision traceability.
13. Every expensive AI operation is cost-attributed.
14. Student requests reserve budget before provider execution.
15. Long conversations are compacted; full history is not replayed forever.
16. Evals gate production AI improvements.
17. No Student AI API trusts a client-supplied `studentId` or entitlement.
18. There is no cross-user memory.
19. Web Search is off by default.
20. Backend contracts remain compatible with future storage and provider adapters.

## 2. Current repository audit

The original AI-M0 audit was performed against `HEAD == origin/main == b528f198d25e0c7b4b64a41cdfedcb7fdd47badb`, with a clean working tree; later milestone status is recorded in the current AI boundary row below.

| Existing boundary | Current reality | AI implication |
| --- | --- | --- |
| Server | Next.js App Router with Node runtime routes | AI APIs belong behind server boundaries; route handlers are not durable workers |
| Persistence | SQLite via `better-sqlite3` and Drizzle migrations under `drizzle/` | Canonical AI metadata can remain SQLite-first behind repositories |
| Runtime data | `PYTHAGORAS_DATA_DIR` with a safe local fallback | Runtime databases, objects, secrets, and logs stay outside Git |
| Admin identity | OWNER/ADMIN sessions with server-derived actors | AI governance actions must use the same server-resolved actor pattern |
| Governance | Change Sets, optimistic revisions, review, OWNER approval, atomic publication | Governed AI config and knowledge must use adapters/coordinators rather than ad-hoc writes |
| Question domain | Relational Packages, Taxonomy, Banks, Questions, Variants, Occurrences, shared Answers | Question content remains a separate canonical domain and gets its own knowledge projector |
| Search | Published placement-scoped SQLite FTS5 projection | This is lexical Question Search, not semantic AI retrieval or a vector index |
| Student identity | No production Student authentication or entitlement boundary | Student AI launch is blocked until a server-resolved principal and entitlement service exist |
| AI | AI-M1 adds configuration/secrets and migration `0011`; AI-M2 adds the governed Model Registry/Gateway and migration `0012`; AI-M3A adds economics/usage accounting and migration `0013`; AI-M3B adds governed budget/rate-limit policies, one stable-period Budget Account, atomic admission, reservations, settlement, and migrations `0014_cynical_bloodscream`/`0015_cynical_vulcan`; AI-M3C1 adds durable Jobs/Outbox/recovery and migration `0016_left_queen_noir`; AI-M3C2 adds passive persistent Circuit Breakers/operational health and migration `0017_lean_oracle`; AI-M4 adds private server-side Conversation/Message/Response lifecycle and migration `0018_soft_zaran`; AI-M5 adds governed Policy/Context planning and metadata-only Context Snapshots through migration `0019_abnormal_kid_colt`; AI-M6 adds governed Knowledge Source/Package publication, immutable normalized document history, and published-only rights/enabled eligibility through migrations `0021_nifty_komodo`/`0022_knowledge-package-source-subject-consistency`; AI-M7A adds bounded deterministic Chunk Projection, separate FTS5 Lexical Retrieval, and projection health through migrations `0023_fearless_vanisher`/`0024_sad_speed`; M7B adds pinned one-space Embedding Projection, durable reference-only embedding Jobs through the existing Gateway, Float32 local exact vectors, and semantic health through migration `0025_sharp_raza`; M7C adds governed Retrieval Config, exact hybrid retrieval, deterministic RRF, optional reranking, and runtime EvidencePack through migrations `0026_steady_turbo`/`0027_many_chat`; M8A adds governed Tutor planning, deterministic preflight, grounded Generation request planning, and metadata-only Response Trace foundations through migrations `0028_yellow_the_fury`, `0029_massive_rick_jones`, and `0030_require_unsealed_tutor_trace_creation`; M8B adds one admitted grounded Generation execution boundary; M8C adds deterministic grounding-integrity validation, post-Generation fences, partial-context exclusion, and replay hardening; M9A adds governed Eval Suite/Case truth and deterministic recommendation gates through migrations `0031_nosy_roxanne_simpson`/`0032_eval-scoring-boundary`/`0033_eval-accounting-basis`; M9B1 adds governed target execution through migrations `0034_eval-target-execution`, `0035_eval-target-orchestration-hardening`, and `0036_eval-retry-lifecycle`; M9B2 adds supplementary LLM Judge and qualitative evaluation through migrations `0037_eval-supplementary-judge` and `0038_eval-judge-execution-hardening`; M10R is the approved/complete scoped Memory rebaseline and M10A2 adds scoped Memory storage, policy, provenance, lifecycle, and migration `0043_scoped-student-memory-foundation`; the former M10A/M10B rows and migrations `0039`-`0042` remain historical/superseded compatibility data; AI-M11 adds closed metadata-only events, Retrieval Traces, Tutor diagnostics, Memory/Compaction telemetry, structured feedback, de-identified analytics read services, and migration `0045_sturdy_bill_hollister`; no production provider, external call, external Vector DB, Student auth/entitlement, public Student AI API, or UI exists | AI-M0 through AI-M9 and M10R are approved/complete; AI-M10A2/B2/C/D and AI-M10 are implemented pending independent review; AI-M11 is implemented pending independent review; AI-M12-M15 are not started |

The M10 portion of the historical matrix above is superseded by the current status: M10A2, M10B2, M10C, and M10D are implemented pending independent review; AI-M10 is implemented pending independent review; and AI-M11 is implemented pending independent review through `0045_sturdy_bill_hollister`.

The public Student content routes currently expose published content without a Student principal. That is acceptable for the current read-only content surface but is not an acceptable trust boundary for a metered Student AI API.

The former M10A/M10B checkpoint remains historical compatibility material: migrations `0040_wandering_invisible_woman`, `0041_violet_nico_minoru`, and `0042_memory-execution-commit-safety` are preserved, but their subject-only/new-extraction assumptions are superseded by M10R/M10A2. Migrations `0043_scoped-student-memory-foundation` and `0044_slippery_joshua_kane` add the current scoped Global/Subject Memory foundation and current-policy SQLite mutation boundary. M10B2 uses one bounded provider-neutral Agent-1 Memory command in the same Tutor Generation; M10C injects only current eligible Global/Subject Memory into M5 Context; M10D keeps Student-only Compaction and disables new legacy extraction work.

### AI-M11 metadata telemetry boundary

M11 is implemented pending independent review through migration `0045_sturdy_bill_hollister`. It adds closed append-only events, bounded metadata-only Retrieval Traces, Tutor diagnostics, lifecycle telemetry for Memory and Compaction, structured completed-Response feedback, and de-identified analytics read services. Response, Retrieval, Cost, Model/Provider, Tutor/Context/Retrieval Config, Memory, and Compaction identities are correlated by safe references where available. Raw Conversation/Assistant text, Memory text, Summary text, Evidence text, prompts, Provider envelopes, credentials, and chain-of-thought remain outside telemetry. Principal purge removes identifying telemetry relationally; synthetic/null-principal activity is excluded from Student active-user analytics. M11 is a read/diagnostic foundation only: no UI, Agent 2, production Provider, or M12-M15 implementation.

## 3. Ownership layers

### Pythagoras-owned truth

Canonical curriculum, approved Knowledge Packages, publication revisions, taxonomy, source provenance, policy revisions, and approved improvement decisions are Pythagoras data. Provider weights, provider prompts, and raw student conversations never become curriculum truth automatically.

### Replaceable compute

Generation, embedding, and reranking are separate adapter capabilities. A provider may implement one, two, or all three behind separate contracts, but no domain may assume that a generation provider supplies embeddings or reranking. Student generation and Agent 2 analysis may intentionally resolve to different models and providers.

### Rebuildable projections

Chunks, embeddings, vector indexes, lexical projections, retrieval features, de-identified analytics, and derived clustering are rebuildable projections. They carry source revision/config identity and can be invalidated and regenerated without changing canonical source content.

### Durable audit

Every production answer records the policy, knowledge, retrieval, model, provider, memory, cost, and conversation revisions used to produce it. Raw chain-of-thought is not a Product artifact and is not persisted as a hidden substitute for an audit trace.

## 4. Student request lifecycle

1. The server resolves the authenticated StudentPrincipal. A client-supplied `studentId`, plan, or entitlement is advisory input only and never authoritative.
2. The EntitlementService and RateLimit boundary authorize the operation. The Budget Ledger performs a preflight estimate and reserves allowance using an idempotency key.
3. The Conversation Domain verifies the immutable subject scope and loads only the allowed conversation summary, recent turns, durable memory snapshot, and current message.
4. Global and subject policy are loaded by revision. The ContextBudgetManager allocates bounded input and output budgets; a provider's large context window is not a target.
5. Retrieval applies subject/material metadata filters, lexical and semantic retrieval, deterministic fusion, optional reranking, trust policy, a minimum evidence threshold, and a bounded Evidence Pack.
6. The Grounded Tutor Orchestrator produces a response request containing policy, scope, evidence, and output constraints. Retrieved text is evidence, never executable instructions.
7. After the final provider-free fences, the Provider Gateway streams through the one exact-pinned GenerationProviderAdapter. The stream is tied to the same server-owned Cost Operation and Budget Reservation used by M7C; it can be stopped without losing usage accounting.
8. The platform persists bounded Conversation output, writes an atomically sealed metadata-only Response Trace, records Generation usage before terminal operation status, applies the M8C deterministic grounding-integrity and currentness gate, and settles actual usage/release or reconciliation. M8C does not claim semantic entailment; that is an Eval concern.

Failure at any stage is an explicit typed failure. A stopped or partial generation still settles real provider usage; it does not silently consume or release the wrong amount.

## 5. Knowledge and publication lifecycle

### AI-M7C implementation boundary

AI-M7C is approved. Its governed `ai.retrieval-config` revision selects bounded lexical/semantic/fusion/rerank/evidence behavior, trust tiers, explicit failure policies, and server-pinned `weighted-rrf-v1@1`. `HybridRetrievalService` enumerates a hard-bounded set of currently eligible published Knowledge/Question origins, requires exact fresh/current M7A and M7B coverage in one embedding space, scopes lexical search to the selected M7A revisions, sends the untrusted query through one `QUERY` embedding Gateway call, recomputes global semantic rank capped by the global `semanticCandidateLimit`, applies integer weighted RRF, optionally reranks a bounded ID/text set, preserves bounded published origin metadata in EvidencePack items, and performs a final exact eligible-origin-set plus Source/projection/model/provider/config fence. The result is a bounded in-memory EvidencePack only; query text is not persisted, M7C does not call Generation, and it does not settle the caller-owned Cost Operation or Budget Reservation.

```text
approved source -> validated pythagoras.knowledge-package
        -> bounded hash-pinned proposal -> OWNER approval -> published knowledge revision
        -> chunk / embedding / lexical projection jobs
        -> retrieval-ready revision
```

Production RAG may use only a published Knowledge revision and its valid projections. A draft, rejected, superseded, failed, or partially projected revision is not silently eligible. A projection job may be retried or rebuilt; it may not publish canonical knowledge.

Question Packages remain a separate portable contract. The Question domain and Knowledge domain can share Rich Content and Asset resolution conventions, but one is not copied into the other.

### AI-M8A/M8B/M8C Tutor boundary

AI-M8A is approved. A governed `ai.tutor-config` selects references to the Generation Model, Context/Retrieval/Budget/Rate Limit policies, and a bounded output limit; it never stores prompt personality, tools, Web Search, or credentials. `AITutorPreflightService` resolves the canonical pending Conversation Response, reuses M5's metadata-only Context Snapshot, pins exact policy/config/Model/Provider revisions, and computes a conservative integer nano-currency estimate without admission or settlement. `AITutorGenerationPlanner` accepts an EvidencePack only from the trusted internal M8B composition boundary, requires its request ID to equal the Response ID, validates its subject/config/fusion identity, places Evidence in labelled user/data messages, keeps the current Student message last, and returns one-model/no-fallback runtime-only Generation planning over detached immutable values. M8A makes zero Generation, Embedding, or Rerank calls.

AI-M8B is approved at `c2ac566c97764b2f129301ea9bc51a630aeb2591`. `AITutorExecutionService` accepts only a server-resolved principal, Response ID, Tutor Config ID, and optional cancellation signal. It creates/reuses one response-bound `STUDENT_GENERATION` Cost Operation, resolves the server-owned budget period, admits and starts one reservation, invokes M7C with `requestId = responseId`, re-fences the runtime EvidencePack and all pinned identities, then calls the Gateway once. It persists only bounded Conversation output, accounts cumulative Generation usage before operation completion, terminalizes the Conversation and sealed metadata-only Trace, and settles the shared reservation. Generation stream deltas are split into whole UTF-8-safe Conversation chunks without normalization or truncation. A pre-provider rejection records no Generation usage; a Provider-invoked failure records its latest trustworthy usage, including unknown fields rather than fake zero.

AI-M8C is approved. After Provider usage accounting, execution re-fences the exact M7C EvidencePack and M8A runtime identities, reconstructs the canonical M4 response chunks, and validates only the server-owned `evidence-ref-v1@1` citation protocol. Invalid output becomes a failed partial response without repair or retry; `CONTENT_FILTER` may be empty but validates any citation-like reference. Partial Assistant messages remain M4 history but are excluded from later Context. Coherent terminal replay returns the same durable result; active or ambiguous replay fails before new admission/retrieval/Provider work. M8C is runtime-only and adds no migration, judge Provider, Student API/UI, tools, or Web Search.

The M8A Response Trace foundation is metadata-only and created by M8B after admission and successful planning. It binds one trace to one Response and its Conversation, Tutor/Context/Retrieval/Model/Provider revisions, cost operation, budget reservation, and plan fingerprint. Projection and selected Evidence references are inserted in one transaction and then sealed; no child ref can be added after sealing or lifecycle advancement. No raw message, policy, evidence, prompt, provider response, credential, or chain-of-thought is persisted. M11 Retrieval Trace remains a separate future telemetry boundary.

Migration `0030_require-unsealed-tutor-trace-creation` closes the SQLite creation boundary: a new Trace cannot be inserted already sealed; historical Traces upgraded from `0028` remain sealed.

### AI-M10R scoped Student Memory baseline

The former M10A subject-only checkpoint at `d106e5bb3b82095e3d1b3abeab1f150237d87d06` remains historical review evidence but is superseded by the APPROVED/COMPLETE M10R design. M10R defines private Memory as either principal-global (`GLOBAL`, null subject) or exact principal-subject (`SUBJECT`) state, with a closed educational kind vocabulary and no generic personal-profile category. The new lifecycle is `PROPOSED`, `ACTIVE`, `RESOLVED`, `EXPIRED`, and `DELETED`; only `ACTIVE` can be selected by current-policy M5 Context. Inferred proposals retain bounded candidate text and metadata-only evidence, and Agent 1 may request server-owned activation in the same Tutor Generation when current policy permits.

### AI-M10A2 scoped storage, policy, provenance, and lifecycle

AI-M10A2 is implemented pending independent review. Migration `0043_scoped-student-memory-foundation` materializes scoped policy identities/revisions, stable optimistic-revisioned Memory state, bounded safe provenance, and short-lived metadata-only mutation intents/records. Explicit Memory can survive source Conversation deletion with tombstoned provenance; inferred Memory is reconciled against remaining distinct evidence; principal purge is bounded and principal-isolated. Conversation origin is protected so Eval-synthetic turns cannot become Student Memory evidence. Resolved/expired/deleted Memory text is scrubbed, and no raw Memory text is copied into policies, Context Snapshots, Jobs, Outbox, accounting, or retrieval projections.

The previous M10B implementation through `0041_violet_nico_minoru` and `0042_memory-execution-commit-safety` is preserved as historical/superseded compatibility data; M10D schedules no new `memory-extraction-v1` executions. Conversation Compaction remains a separate bounded M10D job. M10B2 adds only one strict Gateway event and one bounded metadata-only mutation intent per successful Tutor response; it adds no second Memory Generation, production Provider, UI/API, or keyword/regex Memory semantics.

<!-- Historical M10B execution details remain in the repository history; this boundary is intentionally closed for new work. -->

## 6. Governance and operational separation

Governed Product configuration includes policies, routing, retrieval configuration, budgets, and knowledge publication. Operational state includes secret health, provider health, circuit breakers, queue leases, last errors, and retry state. Operational state is not a substitute for approval and secret material never enters a Change Set snapshot.

Agent 2 can analyze and propose. It cannot approve, publish, mutate credentials, change curriculum truth, message students, or bypass Evals. An ImprovementProposal becomes effective only through the existing governance path and its required evaluation gates.

## Decisions intentionally deferred beyond AI-M0

AI-M0 does not pretend to resolve Product or deployment choices that the current repository cannot answer:

- the eventual Student login/session mechanism and the authoritative entitlement/billing integration;
- the first production provider/model, deployment regions, provider retention terms, and fallback portfolio;
- the production implementation of `AISecretStoreAdapter` (M1 supplies the current local encrypted adapter);
- when local exact vector search is no longer sufficient and which future vector adapter is selected;
- retention durations, legal basis, deletion SLAs, and the approved PII redaction taxonomy;
- initial retrieval K values, evidence thresholds, context budgets, rate cards, and the final Premium allowance;
- the first allowlisted Tutor tools, if any. Web Search remains off by default.

## 7. Non-goals of AI-M0

AI-M0 does not add runtime modules, routes, tables, migrations, workers, provider clients, embeddings, vector extensions, prompts, credentials, Admin forms, Student UI, Web Search, memory extraction, or AI calls. Those are future milestone deliverables governed by [AI-MILESTONES.md](./AI-MILESTONES.md).
