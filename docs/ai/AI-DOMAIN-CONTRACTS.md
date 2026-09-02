# AI domain boundaries and conceptual contracts

This document defines ownership and contracts. AI-M0 established the boundaries; AI-M1 through AI-M3C2 materialize the configuration, secrets, Model Registry, adapter, transport, Gateway, economics, admission, durable Jobs, Outbox, recovery, passive Circuit Breaker, and operational-health portions described below. AI-M4 materializes the private Conversation, Message, Product Response, and bounded streaming lifecycle boundaries, AI-M5 materializes governed Policy/Context planning and metadata-only Context Snapshots, AI-M6 materializes the governed Knowledge Source/Package domain, AI-M7 materializes approved rebuildable retrieval, and AI-M8A materializes Tutor planning and Response Trace metadata without selecting a production provider.

## 1. Configuration, secrets, and provider boundaries

| Boundary | Owns | MUST NOT own or do |
| --- | --- | --- |
| **AI Configuration** | Versioned references to policy, routing, retrieval, context, budget, and feature configuration | Store secret values or silently mutate canonical Product config |
| **AI Secrets** | Credential references, secret-store lifecycle, rotation, access audit, and health metadata | Return secret values through APIs, snapshots, prompts, logs, or Mobile |
| **AISecretStoreAdapter** | `get(credentialRef)`, `put/rotate`, `revoke`, and audited access semantics behind a replaceable store | Become a normal SQLite string column or repository-visible plaintext value |
| **Provider Gateway** | Capability routing, timeout/cancellation, provider error normalization, fallback policy, and provider request correlation | Let a provider decide Product policy, budget, publication, or student identity |
| **Model Registry** | Stable model configuration IDs, capability declarations, provider/model aliases, context ceilings, and lifecycle state | Treat a model name from the client as authorization |
| **Rate Cards** | Versioned provider/model pricing and effective periods | Hard-code prices in business logic or overwrite historical rates |
| **GenerationProviderAdapter** | Text generation/streaming request and normalized usage/result/error response | Provide an implicit embedding or reranker contract |
| **EmbeddingProviderAdapter** | Batch/document/query embedding with model and dimension identity | Generate student answers or mutate source content |
| **RerankerProviderAdapter** | Candidate scoring/reranking with bounded input and normalized scores | Retrieve arbitrary web content or become a second generator |

The three provider contracts are deliberately separate:

```text
GenerationProviderAdapter.generate(request, cancellation)
  -> stream<ResultChunk> + UsageReport

EmbeddingProviderAdapter.embed(request)
  -> EmbeddingBatch + UsageReport

RerankerProviderAdapter.rerank(request)
  -> RankedCandidates + UsageReport
```

Each adapter reports the resolved provider/model, request identity, status, latency, and trustworthy usage fields. Provider-specific SDK types stop at the adapter boundary.

The AI-M1 local Secret Store reads the master key from `PYTHAGORAS_AI_MASTER_KEY` as a 32-byte base64 or 64-character hexadecimal value and stores only versioned encrypted envelopes under `<PYTHAGORAS_DATA_DIR>/ai-secrets/<credentialRef>/`. No key value or ciphertext is part of the repository or any Product configuration snapshot.

When AI-M3C2 enforcement is requested, the Gateway binds the Circuit target to the active metadata `secretVersion`, acquires the permit, and resolves through the version-fenced `AISecretStoreAdapter.resolveVersion` contract. Rotation or revocation before exact resolution neutralizes the permit and retries the same model handshake within a small bound; a Provider is never invoked with a credential generation different from its Circuit target.

AI-M2 materializes the Model Registry and Gateway boundaries in `src/server/ai/`. Model configurations are governed `ai.model-config` resources with one declared capability per record. The Gateway accepts only an internal ordered `ModelSelectionPlan` of server-owned model configuration IDs, resolves an active Provider and credential through `AISecretStoreAdapter`, then invokes a matching server-registered adapter. Generation streams use `STARTED`, `TEXT_DELTA`, `USAGE`, and `COMPLETED` events; embedding and reranking return bounded normalized results. Usage remains token metadata with unknown dimensions represented as `null`; durable cost and budget accounting remain AI-M3 work.

The adapter-facing `ProviderGenerationStreamEvent` may carry a provider request ID so the Gateway can attach it to the current attempt. The Gateway-facing `GatewayGenerationStreamEvent` is deliberately provider-neutral: it has no provider request ID field, emits one logical `STARTED`, and exposes only the final normalized completion. Provider request IDs remain available exclusively through `AIProviderAttemptTrace`.

Gateway failures use a closed normalized taxonomy with explicit retry/fallback flags. Each invocation returns safe attempt metadata with model/provider revisions and no prompt, credential, raw provider body, or permanent usage record. The M2 transport boundary requires an HTTPS target whose resolved addresses pass the denylist for private, loopback, link-local, multicast, metadata, unspecified, and reserved networks; a future transport must pin/use that validated resolution to reduce DNS rebinding risk. No production HTTP adapter or vendor protocol adapter is shipped in M2.

AI-M3A materializes the economics side of the Operations Core. Rate Card revisions and relational price lines/time bands are governed data; `AIBillingUsageNormalizer` is an explicit server-registered boundary because M2 telemetry is not automatically billable; `AICostCalculator` uses integer nano-currency arithmetic; and accounting observations/corrections are append-only. AI-M3B adds governed Budget/Rate Limit Policy revisions, exactly one pinned Budget Account per principal/policy identity/period, atomic reservations, idempotent admission, M3A-backed exposure/settlement, and persisted frequency/concurrency controls. AI-M3C1 adds durable at-least-once Jobs, reference-only payloads, closed handlers/routers, dedupe, priority, fenced leases and attempts, transactional Outbox dispatch, retry/dead-letter behavior, a standalone worker boundary, and M3B reconciliation recovery. AI-M3C2 adds governed passive Circuit Breaker Policies, exact route/credential-version state, fenced normal/probe permits, cooldown and stale-probe recovery, central failure classification, circuit-aware Gateway behavior for all three capabilities, safe operational health queries, and `SKIPPED`/`providerInvoked=false` traces for denied routes. AI-M4 adds a private server-side Conversation/Message/Response domain with immutable subject and owner identity, bounded durable response chunks, one active response per Conversation, idempotent turns, and explicit C4 deletion purge through migration `0018_soft_zaran`. Conversation deletion retains the opaque top-level `idempotencyKey` in the Response tombstone while clearing fingerprints and message references, so a consumed request identity cannot be reused inconsistently with M3 admission/accounting. AI-M5 adds separately governed Global/Subject Instruction Policy revisions, a Context Policy revision, structural Global-over-Subject precedence, bounded provider-neutral Context plans, and metadata-only immutable Context Snapshots through migration `0019_abnormal_kid_colt`. AI-M7A adds only rebuildable bounded Chunk Projection and separate FTS5 Lexical Retrieval infrastructure; Student entitlement/auth, Provider execution, active health probes, Policy/Context execution beyond this boundary, semantic/vector retrieval, and Knowledge/RAG orchestration remain outside these checkpoints.

## 2. Policy, subject, conversation, and student boundaries

| Boundary | Contract |
| --- | --- |
| **Subject Configuration** | Subject identity, language, curriculum scope, allowed Knowledge sources, and subject-level feature flags. It is not inferred from a client prompt. |
| **Global/Subject Policies** | Versioned safety, grounding, answer style, allowed operations, source trust, output constraints, and escalation rules. Subject policy cannot silently weaken global policy. |
| **Conversation Domain** | Durable conversation identity, immutable `subjectKey`, participant scope, message ordering, summary revisions, and lifecycle state. A conversation never changes subject in place. |
| **Streaming Generations** | One generation attempt associated with a conversation, request idempotency key, policy/context snapshot, provider resolution, cancellable stream, terminal status, and usage settlement. |
| **ContextBudgetManager** | Allocates `softInputBudget`, `hardInputBudget`, `outputReserve`, `policyBudget`, `summaryBudget`, `recentTurnsBudget`, `memoryBudget`, and `evidenceBudget`. It returns an explicit budget plan and truncation decisions. |
| **Student Principal Boundary** | Server-resolved opaque principal, account status, subject scope, and request actor context. No client-supplied identity is authoritative. |
| **StudentPrincipalProvider** | Future adapter that resolves the principal from the eventual login/session mechanism without coupling AI to email/password assumptions. |
| **Entitlements** | Server-side decision for whether the principal may use a capability, model tier, subject, or budget class. Entitlement evidence is revisioned and auditable. |

AI-M5 materializes Global/Subject Instruction Policies and a separate Context Policy through governed revisions. Context planning always carries the code-owned precedence envelope, Global layer, and Subject layer independently, in that authority order. This is structural precedence only; M5 does not claim to prove or automatically resolve natural-language contradictions, which remain an Eval concern.

The ContextBudgetManager must assemble a request from stable global policy, subject policy, relevant conversation summary, bounded recent turns, relevant durable memory, bounded RAG evidence, the current message, and an output reserve. “Send the whole history until the provider limit” is not a valid contract.

## 3. Limits, jobs, and persistence boundaries

| Boundary | Contract |
| --- | --- |
| **Budget Ledger** | Immutable reservation, settlement, release, and correction entries attributed to principal, conversation, request, cost center, and idempotency key. Concurrent requests reserve atomically. |
| **Rate Limits** | Principal/capability/provider controls with explicit windows, retry metadata, and abuse-safe identity keys. They are separate from monetary budget. |
| **Durable Jobs / Outbox** | Persisted job identity, type, payload reference, source/config revision, dedupe key, `scheduledAt`, lease/heartbeat, attempt count, retry/backoff, failure/dead-letter state, and cost attribution. |
| **Usage / Cost** | Normalized usage facts, estimated and actual cost, currency, pricing source, cache/reasoning dimensions, latency, and settlement status. |
| **Governance** | Change Set proposal, review, approval, publication, conflict, and audit rules for governed AI resources. Only the authorized publication path makes Product config or Knowledge eligible. |

Embedding, compaction, memory extraction, analytics, Agent 2, and eval runs MUST use durable jobs or an equivalent persisted outbox. A Next.js request handler is not a durable worker.

## 4. Knowledge and retrieval boundaries

| Boundary | Contract |
| --- | --- |
| **Knowledge Sources** | Stable source identity with immutable key/subject and governed metadata revisions for source type, trust, rights, authority, language, acquisition/provenance, and preparation method. A source is not production evidence until its approved Package revision is published and its current rights/enabled state is eligible. |
| **Pythagoras Knowledge Package** | Portable `pythagoras.knowledge-package` V1 contract described in [KNOWLEDGE-PACKAGE-V1.md](./KNOWLEDGE-PACKAGE-V1.md). It is separate from `pythagoras.question-package`, pins an exact Source revision, and contains structured documents/assets rather than retrieval data. |
| **Knowledge Publication** | Validates, versions, and publishes a Package revision through `ai.knowledge-package` Change Sets and OWNER publication. Large content is hash-pinned outside bounded snapshots; publication materializes immutable Package/Document/Asset-binding rows and never publishes retrieval projections as canonical content. |
| **Chunk Projection** | Deterministic, revisioned chunks with source/page/section provenance and stable chunk IDs. Rebuildable and never authoritative over the Package. |
| **Embedding Provider** | Adapter boundary for document/query vectors, model/config revision, dimensions, and usage. It may be local or external. |
| **Vector Index** | `VectorIndexAdapter` for insert/delete/search against a projection revision. It may begin as local exact search and later use pgvector or a service without changing RAG contracts. |
| **Lexical Retrieval** | Existing or future lexical adapter that returns bounded candidates, source revision, and explainable lexical scores. Question FTS remains a separate placement-scoped Product search. |
| **Hybrid Retrieval** | Deterministic fusion of lexical and semantic candidates under subject/material filters. It does not send every candidate to generation. |
| **Reranker** | Optional bounded candidate reranking with model/config revision and normalized scores. Failure can follow an explicit policy; it cannot silently widen scope. |
| **Evidence Pack** | Bounded, ordered, deduplicated evidence items with chunk IDs, source provenance, trust tier, retrieval/rerank scores, and inclusion reasons. It is the only retrieval output exposed to the Tutor. |
| **Grounded Tutor Orchestrator** | Combines principal, policy, context budget, conversation, memory, and Evidence Pack into a generation request and applies grounding/output rules. It does not grant tools or credentials to a model. |

AI-M6 also exposes `listProjectionEligibleKnowledge(subjectKey)` as a published-only read boundary: the Package is canonical, the subject matches, the pinned Source revision exists, and the current Source state is enabled with cleared rights. A later Source disable/restriction preserves historical rows and pins but removes them from eligibility. The database also rejects a Package revision whose pinned Source identity belongs to another subject. `QuestionKnowledgeProjector` is a canonical read boundary: its public methods load published Question/Package rows from SQLite, derive the owning subject from the canonical Package, reject a mismatched requested scope, and cannot accept an arbitrary in-memory aggregate as authoritative input. It preserves Package revision/contentRevision, Question revision, Variant revision, and Occurrence revisions, and exposes a metadata-only revision fingerprint; it does not copy Question rows into Knowledge storage or read Change Set draft content.

AI-M7A adds `AIRetrievalProjectionSet`, immutable/rebuildable projection revisions, bounded cursor readers, deterministic `structured-rich-v1` RichDocument chunks, and a separate FTS5 index. BUILDING and FAILED rows are never queryable; only the current READY revision is eligible. BUILDING revisions are discovered by their persisted exact input/config identity and can resume after process restart; Projection Set identities, projection revision identities, READY/FAILED lifecycle state, and persisted chunks are protected at the SQLite boundary, with only the controlled old-READY current demotion allowed. Lexical retrieval filters the canonical subject first and rechecks current Knowledge Source enabled/cleared-rights state at query time. M7A has no embeddings, vectors, fusion, reranking, EvidencePack, durable projection Job, or Provider execution.

AI-M7B adds the semantic derived boundary over an exact fresh/current M7A READY revision. One server-owned embedding Model Config is pinned with its exact Model/Provider revisions, provider model identity, adapter, dimensions, Float32 codec, and local exact vector-index identity; fallback plans are not allowed to mix spaces. Document batches execute only through `AIProviderGateway.embed`, are admitted and cost-attributed under `KNOWLEDGE_INDEXING`, and run as reference-only durable `ai.retrieval.embedding-build` Jobs with existing lease/fencing/retry/dead-letter semantics. Embedding Sets/Revisions/Vectors are rebuildable C3 data with DB lifecycle, ownership, coverage, and immutability protections. M7B exposes only internal vector-query search; query-text embedding, hybrid fusion, reranking, EvidencePack, and Tutor orchestration remain M7C/later boundaries.

## 5. Memory, telemetry, and improvement boundaries

### AI-M7C retrieval contract

The published `ai.retrieval-config` revision is the only source of M7C retrieval behavior. `HybridRetrievalService` accepts a server-owned subject scope, bounded untrusted query, exact config revision, and caller-owned open Cost Operation with an EXECUTING Budget Reservation. It returns a bounded runtime EvidencePack after exact published M7A/M7B readiness, scoped lexical/semantic retrieval, deterministic integer RRF, optional single-model reranking, trust filtering, and a final live eligibility fence. Query embedding and reranking usage are recorded against the caller operation; M7C does not complete or settle it. No query text or Retrieval Trace row is persisted in M7C.

Each Retrieval Config Revision is append-only and carries the non-user-selectable fusion identity `weighted-rrf-v1@1`. The semantic candidate limit is global after bounded per-origin scans and global cosine ranking. Before returning evidence, M7C proves that the current eligible origin identity set is unchanged, then rechecks exact M7A/M7B, Model/Provider, Config, and live Source eligibility. `AIHybridChunkCandidate` preserves a bounded cloned `originMetadata` contract through fusion and EvidencePack; rerankers receive only candidate ID/text and never provenance.

### AI-M8A Tutor planning and trace contract

`ai.tutor-config` is governed through the existing Change Set lifecycle and stores only stable subject-bound routing references: one Generation Model, Context Policy, Retrieval Config, Budget Policy, Rate Limit Policy, and a bounded output limit. Its revisions are append-only with SQLite identity/lifecycle triggers; the server owns `evidence-grounded-v1@1` and `evidence-ref-v1@1`, so clients cannot select arbitrary grounding, citation, prompt, tool, or model fallback behavior.

`AITutorPreflightService` accepts only a server-resolved active principal, a pending owned Conversation Response, a Tutor Config identity, and a Context token estimator. It resolves the canonical Conversation subject, M5 Global/Subject/Context revisions and metadata-only Snapshot, the exact current Retrieval/Model/Provider/Budget/Rate Limit revisions, and a provider-neutral maximum cost estimate. It never calls Gateway, Hybrid Retrieval, admission, reservation, or settlement. The Generation plan is runtime-only, uses exactly one Generation Model, and has no fallback.

`AITutorGenerationPlanner` accepts an EvidencePack only through a trusted internal boundary that a future M8B orchestrator will populate directly from M7C. It requires `SUFFICIENT` evidence with the exact subject, Retrieval Config revision, and fusion identity; consumes whole Evidence items under the M5 evidence budget; keeps evidence as labelled user/data messages; and leaves the current Student message last. Instructions contain only the code-owned precedence/grounding envelopes and exact Global/Subject policy text. Evidence provenance stays in a runtime citation map and is not sent to the Provider.

`ai_tutor_response_traces` is a separate M8 answer-level metadata audit foundation, not the future M11 Retrieval Trace. One trace binds one Response to exact Tutor, Context Snapshot, Retrieval/fusion, Generation Model/Provider, grounding/citation, cost-operation, budget-reservation, and plan identities. Projection and Evidence child rows contain IDs/revisions only. Trace rows are lifecycle-fenced (`PLANNED`, `STREAMING`, `COMPLETED`, `FAILED`, `CANCELLED`, `BLOCKED`) and never contain raw Student messages, policy/evidence text, prompts, Provider responses, credentials, or chain-of-thought. M8A provides the repository/service but does not create live traces automatically; M8B owns insertion after admission.

| Boundary | Contract |
| --- | --- |
| **Student Memory** | Per-principal, subject-scoped durable memory candidates or approved memories with provenance, confidence, visibility, retention, and deletion semantics. No cross-user memory. |
| **Conversation Compaction** | Creates traceable summary revisions from recent working turns and approved memory context. Old messages remain history/audit but are not replayed by default. |
| **Retrieval Traces** | Immutable record of retrieval config, candidate IDs, lexical/semantic/rerank scores, filters, selected evidence, and projection revisions. It contains no secret values. |
| **Feedback / Events** | Append-only normalized product events and feedback with source, actor scope, privacy class, and dedupe identity. Raw message text is not automatically copied into analytics. |
| **Evals** | Versioned datasets, expected evidence/answers, graders, thresholds, model/config revisions, and reproducible run results. Production promotion is gated by Evals. |
| **Agent 2** | Read-only analysis pipeline from deterministic SQL/events through optional embeddings/clustering to representative samples and structured LLM analysis. It produces Insights and proposal candidates only. |
| **Second Brain** | Relational, typed insight/evidence/relationship records that are visualizable later. It is not a graph database and not curriculum truth. |
| **Improvement Proposals** | Structured proposed changes to policy, retrieval, content, explanation patterns, or configuration with evidence, eval results, risk, and approvers. A proposal cannot publish itself. |
| **Privacy / De-identification** | Redaction/minimization, pseudonymous analytics identity, access audit, retention, deletion, and cross-user isolation. Removing account metadata alone is insufficient. |

## 6. Required immutable response trace

The final Student response trace must contain, at minimum:

```text
responseId, conversationId, opaqueStudentPrincipal, subjectKey
globalPolicyRevision, subjectPolicyRevision, contextPolicyRevision
knowledgeRevision, retrievalConfigRevision, embeddingConfigRevision
rerankerConfigRevision, modelConfigRevision, providerConfigRevision
rateCardRevision, memorySnapshotRevision, conversationSummaryRevision
retrievedChunkIds, retrievalScores, rerankScores
requestedModel, resolvedModel, actualProvider
inputTokens, cacheHitInputTokens, cacheMissInputTokens
outputTokens, reasoningTokens, estimatedCost, actualCost
timeToFirstToken, totalLatency, status
```

The trace is an audit of inputs, decisions, and usage. It MUST NOT contain raw provider chain-of-thought, secret values, or unrestricted raw Student content when a minimized reference is sufficient.
