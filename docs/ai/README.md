# Pythagoras AI Intelligence System

## AI-M0 status

**AI-M0 — Architecture Lock & Backend Readiness Specification** is a documentation-only milestone. It records the boundaries, contracts, safety rules, and delivery gates for the future Pythagoras AI Intelligence System.

AI-M0 adds no AI runtime, provider SDK, database table, migration, API call, Admin AI surface, or Mobile AI surface. It does not import or transform curriculum data and it does not read or write runtime data.

## Product position

Pythagoras AI is an educational intelligence platform, not a chatbot integration. Providers and models are replaceable compute engines. Pythagoras owns curriculum grounding, policy, retrieval, memory, conversation state, analytics, evaluation, economics, governance, and revision traceability.

The current repository remains the root Next.js Backend/Admin application plus the Expo Student application under `mobile/`. The current persistence boundary is SQLite + Drizzle with runtime data under `PYTHAGORAS_DATA_DIR`; the current governance boundary is Change Sets, review, OWNER approval, and atomic publication. AI-M0 places future AI services behind those existing boundaries rather than replacing them.

## Current runtime boundary
Current reviewed status: AI-M8A, AI-M8B, and AI-M8C are approved; AI-M8 Grounded Tutor is approved/complete at `e73d6dc5ba4ae18c1bf4dd614b093b605849d179`. AI-M9A is approved/complete at `860b474bd146abb944c15f774afa88578b463a80`; AI-M9B1 is approved/complete at `61d6de1276735f511712dd47797a2c6a6304fcf3`; and AI-M9B2 is implemented pending independent review through `0037_eval-supplementary-judge` and `0038_eval-judge-execution-hardening`. AI-M9 overall is incomplete pending independent review, AI-M10 is not started, and M9B2 adds no production Provider execution.

AI-M1 provides governed Provider configuration and the encrypted local Secret Store. AI-M2 adds the governed Model Registry, normalized Generation/Embedding/Reranker contracts, server-registered adapters, and a provider-neutral Gateway with timeout, cancellation, fallback, and safe attempt tracing. AI-M3A adds revisioned Rate Cards and exact usage/cost accounting. AI-M3B adds governed Budget/Rate Limit Policies, exactly one pinned Budget Account per stable policy period, atomic reservations, idempotent admission, settlement, and sliding-window/concurrency controls through migrations `0014_cynical_bloodscream` and `0015_cynical_vulcan`. AI-M3C1 adds durable Jobs, Outbox dispatch, fenced leases, retries, dead letters, a standalone worker, and M3B recovery through migration `0016_left_queen_noir`. AI-M3C2 adds governed passive Circuit Breaker Policies, persistent exact-route state, fenced half-open probes, circuit-aware fallback for all Gateway capabilities, safe health views, and migration `0017_lean_oracle`; it adds no active health probes or Provider calls. AI-M4 provides the private Conversation/Message/Response core through migration `0018_soft_zaran`, including server-resolved principal contracts, immutable subject-scoped conversations, durable bounded streaming lifecycle, private access, and explicit deletion purge. AI-M5 provides governed Global/Subject Instruction Policies, a separate revisioned Context Policy, deterministic bounded Context planning, and metadata-only immutable Context Snapshots through migration `0019_abnormal_kid_colt`. AI-M6 provides governed Knowledge Sources, strict `pythagoras.knowledge-package` V1 validation, hash-pinned package artifacts, immutable normalized Package/Document/Asset-binding history, rights/enabled published-only eligibility, and a read-only Question projector through migration `0021_nifty_komodo`; AI-M6 has no corpus import or retrieval runtime. AI-M7A, AI-M7B, and AI-M7C are approved, making AI-M7 Retrieval Engine approved/complete through migrations `0023_fearless_vanisher` through `0027_many_chat`. AI-M8A and AI-M8B are approved; M8A adds governed Tutor planning and metadata-only Response Trace foundations through migrations `0028_yellow_the_fury`, `0029_massive_rick_jones`, and `0030_require_unsealed_tutor_trace_creation`, while M8B adds the first deterministic test-Provider Generation execution with shared M7C/M8B admission and settlement. No production vendor is selected, no production external provider call, no Student authentication or entitlement runtime, no public Student AI route or AI UI exists, and no final Product Policy text is seeded.

The reviewed AI-M6 correction adds migration `0022_knowledge-package-source-subject-consistency`: the Question projector is canonical/published-only, preserves exact Package/Question/Variant/Occurrence revision identities, and SQLite rejects cross-subject Package/Source pins. AI-M7A, AI-M7B, and AI-M7C are approved; AI-M7 is complete.

AI-M7A is approved and provides bounded deterministic Chunk Projection and separate FTS5 Lexical Retrieval with BUILDING/READY/FAILED health and stale semantics. Its persisted BUILDING resume and SQLite lifecycle/ownership protections are delivered through migration `0024_sad_speed`. AI-M7B is approved and adds migration `0025_sharp_raza`, one-model embedding Jobs through the existing Gateway, pinned embedding-space revisions, local Float32 exact vectors, and durable cost/lease/health boundaries. AI-M7C is approved and adds migrations `0026_steady_turbo` and `0027_many_chat`, governed Retrieval Config revisions, exact published M7A/M7B readiness, scoped lexical/semantic retrieval, integer weighted RRF, optional bounded reranking, live final fences, and runtime-only bounded EvidencePacks. AI-M7 Retrieval Engine is approved/complete. AI-M8A, AI-M8B, and AI-M8C are approved; M8A adds migrations `0028_yellow_the_fury`, `0029_massive_rick_jones`, and `0030_require_unsealed_tutor_trace_creation` for Tutor Config, deterministic preflight, grounded Generation planning, and metadata-only Response Trace foundations. AI-M8B/C add no migration. AI-M9A is approved/complete at `860b474bd146abb944c15f774afa88578b463a80`; AI-M9B1 is approved/complete at `61d6de1276735f511712dd47797a2c6a6304fcf3`; AI-M9B2 is implemented pending independent review through migrations `0037_eval-supplementary-judge` and `0038_eval-judge-execution-hardening`, and no production Provider is selected.

## Document map

## Implemented boundary history

AI-M7A, AI-M7B, and AI-M7C are approved. Migrations `0026_steady_turbo` and `0027_many_chat` add governed Retrieval Config metadata, append-only Config history, and the server-pinned weighted-RRF identity. The current M7C runtime is bounded hybrid retrieval with exact published M7A/M7B gates, a global semantic K, deterministic integer RRF, optional one-model reranking, exact eligible-origin final fences, preserved bounded Question provenance, live final eligibility fences, caller-owned usage attribution without settlement, and runtime-only EvidencePacks. AI-M7 Retrieval Engine is approved/complete. AI-M8A, AI-M8B, and AI-M8C are approved and have no production Provider or Student/Admin AI UI.

AI-M8A is the approved Tutor planning checkpoint. It governs `ai.tutor-config`, builds a deterministic server-only preflight over the canonical Conversation and M5 Context Snapshot, resolves exact Retrieval/Model/Provider/Budget/Rate Limit revisions, estimates maximum bounded cost in integer nano-currency including reasoning-capable Generation, and converts a trusted internal request-bound EvidencePack into a detached immutable runtime-only one-model Generation plan. It makes zero Generation, Embedding, or Rerank calls and does not create admission, reservations, or settlement. Its Response Trace foundation stores only revision/ownership metadata and atomically sealed projection/evidence references; it never stores raw messages, policies, evidence, prompts, provider output, credentials, or chain-of-thought.

AI-M8B is approved at `c2ac566c97764b2f129301ea9bc51a630aeb2591`. It is the first milestone allowed to execute a deterministic test Generation Provider: one server-owned Cost Operation and Budget Reservation cover M7C query work and Generation, the Gateway receives an exact Model/Provider pin, Conversation deltas are split on UTF-8-safe 16 KiB boundaries, cumulative Generation usage is recorded before terminal operation/settlement, and the sealed Response Trace remains metadata-only. M8B has no production Provider, vendor SDK, Student API/UI, Admin AI UI, tools, Web Search, Memory, or Evals runtime. AI-M8C owns deterministic citation/grounding-integrity validation, post-Generation currentness fences, partial-context exclusion, and replay hardening.

AI-M8C is approved. Its runtime-only validator accepts the fixed `evidence-ref-v1@1` protocol and exact selected citation map; execution re-fences M7C/M8A state after usage accounting and before successful Conversation completion. Invalid/raced outputs fail without repair or retry, partial Assistant output remains history but is excluded from later Context, and coherent terminal replay returns the existing durable result while ambiguous in-flight replay fails closed.

Migration `0030_require-unsealed-tutor-trace-creation` ensures new Response Traces cannot bypass the unsealed creation phase; historical Traces remain sealed.

## AI-M9A — deterministic Eval foundation

AI-M9A is approved/complete at `860b474bd146abb944c15f774afa88578b463a80`. It adds governed `ai.eval-suite` and `ai.eval-case` identities with append-only revisions, exact ordered Case-revision manifests, explicit synthetic/curated/de-identified privacy boundaries, a code-owned `deterministic-evals-v1@1` grader registry that reuses the M8C citation validator, fixed-point dimension scores, immutable observations/results, candidate and manifest fingerprints, absolute and baseline/regression gates, and recommendation-only `PASS_RECOMMENDED`/`BLOCKED`/`INCOMPLETE` outcomes. Eval Case input is canonical Eval data; candidate outputs are persisted as bounded hashes/metadata, not raw Student conversations. Existing `EVALS` Cost Operations retain `evalRunId` as the M9B execution-economics binding point. M9A also pins grader rows to configured deterministic Suite identities, freezes Case/Grader inputs at `SCORING`, requires a complete Case manifest and, when a cost gate is configured, final canonical accounting with a persisted immutable accounting basis, and leaves `JUDGE_REQUIRED` incomplete until M9B. M9A performs zero Generation, Embedding, Rerank, or judge calls and has no automatic publication authority. Migrations `0032_eval-scoring-boundary` and `0033_eval-accounting-basis` harden these boundaries without adding a competing financial ledger.

AI-M9B1 is approved/complete at `61d6de1276735f511712dd47797a2c6a6304fcf3`. It adds governed target execution, bounded manifest scheduling, EVALS admission/accounting, durable metadata-only synthetic Conversation cleanup, and reference-only target Jobs through migrations `0034_eval-target-execution`, `0035_eval-target-orchestration-hardening`, and `0036_eval-retry-lifecycle`.

AI-M9B2 is implemented pending independent review. It adds the governed supplementary Judge boundary, runtime-only target/evidence handoff, separate EVALS Judge accounting, strict protocol and Provider-invocation proof, crash/re-entry and lease/cancellation handling, and qualitative scoring through migrations `0037_eval-supplementary-judge` and `0038_eval-judge-execution-hardening`. It makes zero production Provider or network calls; AI-M9 overall remains incomplete and AI-M10 is not started.

| Document | Responsibility |
| --- | --- |
| [AI-ARCHITECTURE.md](./AI-ARCHITECTURE.md) | System shape, trust boundaries, invariants, and production request flow |
| [AI-DOMAIN-CONTRACTS.md](./AI-DOMAIN-CONTRACTS.md) | Ownership and conceptual contracts for every AI domain |
| [AI-DATA-CLASSIFICATION.md](./AI-DATA-CLASSIFICATION.md) | Data classes, storage, privacy, retention, and de-identification rules |
| [AI-THREAT-MODEL.md](./AI-THREAT-MODEL.md) | Threats, controls, abuse boundaries, and security gates |
| [AI-ECONOMICS.md](./AI-ECONOMICS.md) | Cost centers, rate cards, reservations, settlement, and limits |
| [AI-RAG-AND-KNOWLEDGE.md](./AI-RAG-AND-KNOWLEDGE.md) | Knowledge Packages, publication, projections, retrieval, and evidence |
| [KNOWLEDGE-PACKAGE-V1.md](./KNOWLEDGE-PACKAGE-V1.md) | Portable `pythagoras.knowledge-package` V1 envelope and M6 publication boundary |
| [AI-EVALS-AND-IMPROVEMENT.md](./AI-EVALS-AND-IMPROVEMENT.md) | Eval gates, Agent 2, Second Brain, and improvement governance |
| [AI-MILESTONES.md](./AI-MILESTONES.md) | M0 definition of done and independently testable M1–M15 plan |

The existing platform references remain authoritative for current non-AI behavior:

- [project-context.md](../../project-context.md) — current repository and product context;
- [M1 local foundation](../content-system/m1-foundation.md), [M2 Admin identity](../content-system/m2-admin-identity.md), and [M3 Asset storage](../content-system/m3-asset-storage.md) — current persistence, identity, and asset boundaries;
- [Question Package V1](../question-system/question-package-v1.md) — current portable Question Package contract;
- [Rich Content boundaries](../../src/lib/rich-content/README.md) — current portable/canonical/public content separation.

## Normative language

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe the architecture locked by AI-M0. These documents are contracts for later implementation; they are not implementation instructions that authorize work in a future milestone.

## Review gate

AI-M0 is complete only when the documents are internally linked, the current-repository audit is recorded, and an independent review accepts the boundaries. Each later milestone is one coherent, independently testable commit and must be reviewed before the next milestone begins.
