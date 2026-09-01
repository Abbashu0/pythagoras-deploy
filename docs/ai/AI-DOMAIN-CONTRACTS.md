# AI domain boundaries and conceptual contracts

This document defines ownership and contracts. AI-M0 established the boundaries; AI-M1 and AI-M2 now materialize the configuration, secrets, Model Registry, adapter, transport, and Gateway portions described below without selecting a production provider.

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

AI-M2 materializes the Model Registry and Gateway boundaries in `src/server/ai/`. Model configurations are governed `ai.model-config` resources with one declared capability per record. The Gateway accepts only an internal ordered `ModelSelectionPlan` of server-owned model configuration IDs, resolves an active Provider and credential through `AISecretStoreAdapter`, then invokes a matching server-registered adapter. Generation streams use `STARTED`, `TEXT_DELTA`, `USAGE`, and `COMPLETED` events; embedding and reranking return bounded normalized results. Usage remains token metadata with unknown dimensions represented as `null`; durable cost and budget accounting remain AI-M3 work.

The adapter-facing `ProviderGenerationStreamEvent` may carry a provider request ID so the Gateway can attach it to the current attempt. The Gateway-facing `GatewayGenerationStreamEvent` is deliberately provider-neutral: it has no provider request ID field, emits one logical `STARTED`, and exposes only the final normalized completion. Provider request IDs remain available exclusively through `AIProviderAttemptTrace`.

Gateway failures use a closed normalized taxonomy with explicit retry/fallback flags. Each invocation returns safe attempt metadata with model/provider revisions and no prompt, credential, raw provider body, or permanent usage record. The M2 transport boundary requires an HTTPS target whose resolved addresses pass the denylist for private, loopback, link-local, multicast, metadata, unspecified, and reserved networks; a future transport must pin/use that validated resolution to reduce DNS rebinding risk. No production HTTP adapter or vendor protocol adapter is shipped in M2.

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
| **Knowledge Sources** | Registered source identity, ownership, rights, acquisition metadata, trust tier, and ingestion status. A source is not production evidence until its derived Package is published. |
| **Pythagoras Knowledge Package** | Portable approved-source contract described in [AI-RAG-AND-KNOWLEDGE.md](./AI-RAG-AND-KNOWLEDGE.md). It is separate from `pythagoras.question-package`. |
| **Knowledge Publication** | Validates, versions, and publishes a Package revision through governance. Publication records source and content revision; it does not publish chunks as canonical content. |
| **Chunk Projection** | Deterministic, revisioned chunks with source/page/section provenance and stable chunk IDs. Rebuildable and never authoritative over the Package. |
| **Embedding Provider** | Adapter boundary for document/query vectors, model/config revision, dimensions, and usage. It may be local or external. |
| **Vector Index** | `VectorIndexAdapter` for insert/delete/search against a projection revision. It may begin as local exact search and later use pgvector or a service without changing RAG contracts. |
| **Lexical Retrieval** | Existing or future lexical adapter that returns bounded candidates, source revision, and explainable lexical scores. Question FTS remains a separate placement-scoped Product search. |
| **Hybrid Retrieval** | Deterministic fusion of lexical and semantic candidates under subject/material filters. It does not send every candidate to generation. |
| **Reranker** | Optional bounded candidate reranking with model/config revision and normalized scores. Failure can follow an explicit policy; it cannot silently widen scope. |
| **Evidence Pack** | Bounded, ordered, deduplicated evidence items with chunk IDs, source provenance, trust tier, retrieval/rerank scores, and inclusion reasons. It is the only retrieval output exposed to the Tutor. |
| **Grounded Tutor Orchestrator** | Combines principal, policy, context budget, conversation, memory, and Evidence Pack into a generation request and applies grounding/output rules. It does not grant tools or credentials to a model. |

## 5. Memory, telemetry, and improvement boundaries

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
