# AI milestone plan

AI milestones are future delivery boundaries. Each milestone is one coherent commit, independently testable, reviewed before the next milestone begins, and must preserve the current Pythagoras content/governance architecture.

## AI-M0 — Architecture Lock & Backend Readiness Specification

**Status:** Documentation and repository audit completed by this document set.
**Exit gate:** Domain boundaries, invariants, trust model, economics, RAG contract, privacy rules, Eval/improvement rules, current discrepancies, and launch dependencies are independently reviewable. No runtime code or schema is added.

## Future milestones

| Milestone | Coherent boundary | Independent exit gate |
| --- | --- | --- |
| **AI-M1 Configuration & Secrets** | Versioned AI configuration, `credentialRef` records, `AISecretStoreAdapter`, rotation/audit boundary, and secret redaction | Config snapshots contain no secret values; secret access/rotation tests pass; no secret reaches APIs/logs/Mobile |
| **AI-M2 Provider Gateway** | Separate Generation, Embedding, and Reranker adapters; model registry; capability routing; normalized errors/usage | Contract tests pass against replaceable fakes; cancellation, timeout, capability mismatch, and provider fallback are traceable |
| **AI-M3 Operations Core** | Rate cards, usage/cost records, Budget Ledger, atomic reservation/settlement, rate limits, circuit breakers, and job/outbox foundation | Concurrent reservations, idempotent settlement, partial streams, retries, and provider outage are tested without overspend |
| **AI-M4 Conversation Core** | Server-resolved StudentPrincipal boundary, subject-immutable conversations, messages, streaming generations, and deletion lifecycle | Client identity substitution fails; subject scope cannot change; stream lifecycle and private access isolation pass |
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
