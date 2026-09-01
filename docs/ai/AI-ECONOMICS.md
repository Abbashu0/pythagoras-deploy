# AI economics, budgets, and usage accounting

AI cost is a Product and safety boundary. Every expensive operation is attributed before it runs and reconciled after it finishes.

## Current implementation boundary

AI-M3A is implemented as the economics-only checkpoint of Operations Core. The runtime has governed, revisioned Rate Cards; billing-safe normalizer and exact nano-unit calculator contracts; cost-operation identities with immutable attempt usage/cost and correction repositories; historical Model/Rate Card revision resolution; and maximum/best-known Generation usage aggregation. No real Provider prices are seeded, and no budget admission, reservation/settlement, rate-limit, circuit-breaker, or durable-job runtime exists until AI-M3B/M3C.

## 1. Cost centers

The immutable cost-center vocabulary is:

- `STUDENT_GENERATION` — student-facing generation, reasoning, query embedding, reranking, and any approved student-facing model/tool call;
- `KNOWLEDGE_INDEXING` — chunk processing and document embeddings for published Knowledge revisions;
- `AGENT_2` — deterministic analysis support, clustering/embeddings, and structured insight analysis;
- `EVALS` — evaluation runs, graders, judge calls, and comparison experiments that belong to a suite run;
- `EXPERIMENTS` — explicitly isolated non-production experiments.

Index embeddings are never charged to the Student generation center. A request may produce multiple ledger entries, but each entry has one primary cost center and a clear parent operation.

## 2. Attribution

Every variable-cost operation records:

```text
operationId, idempotencyKey, costCenter
opaqueStudentPrincipal? , conversationId? , responseId?
jobId? , evalRunId? , knowledgeRevision? , subjectKey?
requestedModel, resolvedModel, actualProvider, rateCardRevision
input/cache/output/reasoning usage, estimatedCost, actualCost, currency
status, startedAt, completedAt
```

Student attribution uses a server-resolved opaque principal. The platform does not accept a client-supplied account or plan as the accounting authority.

## 3. Versioned Rate Cards

Each Rate Card revision supports, at minimum:

- provider and model identity;
- `effectiveFrom` and optional `effectiveTo`;
- cache-hit input rate and cache-miss input rate;
- output rate;
- reasoning rate where separately billed;
- provider-specific fees;
- time bands or peak/off-peak rules where applicable;
- currency and unit definitions.

Historical requests point to the Rate Card revision used at execution. If a provider reports trustworthy actual usage/cost, that report wins. Otherwise the platform calculates from the attached Rate Card and records the estimate basis.

Rate Card revisions are immutable superseding revisions within one stable Rate Card identity, not competing cards. `key`, `modelConfigId`, `modelConfigRevision`, and `currency` are immutable identity fields; `billingUsageNormalizerKey` may change by revision when its billing semantics change. Resolution first considers only revisions already published by the operation timestamp, selects the highest applicable revision per identity, then checks `enabled` and `effectiveTo`; an expired newer revision never resurrects an older one. Distinct Rate Card identities for the same model revision and currency must still have non-ambiguous effective segments.

The initial Product default of a `$2` Premium-subscriber hard cap per billing period is a future configurable policy example, not a business-logic constant and not a value to implement in AI-M0.

## 4. Reservation and settlement

The required lifecycle is:

```text
preflight estimate
  -> atomic reserve
  -> provider execution / stream
  -> settle actual usage and cost
  -> release unused reservation
```

Rules:

1. A Student generation request requires an idempotency key before reservation.
2. Reservation checks the current entitlement, rate card, budget policy, and concurrent outstanding reservations.
3. Reservation is committed before provider execution; a later provider failure still settles any real consumed usage.
4. A stopped or partial stream settles actual reported/estimated usage and releases only unused reserve.
5. Retries must reuse or intentionally supersede an idempotency record; they cannot silently reserve twice.
6. Settlement is idempotent and auditable. A correction creates a compensating ledger entry rather than rewriting history.

## 5. Budgets and rate limits

Budgets and rate limits are related but separate:

- **Budget policy** limits monetary or token allowance over a billing/accounting period.
- **Rate limits** limit request frequency, concurrency, burst size, provider calls, or queue work.
- **Context budgets** limit input composition and output reserve per generation.

The Budget Ledger must support platform, principal, subject, capability, and cost-center views without allowing one view to bypass another. The Rate Limits boundary must return safe retry information without exposing internal wallet details.

## 6. Expensive background work

Knowledge indexing, compaction, memory extraction, Agent 2, and Evals run as durable jobs with cost attribution before work begins. A failed or retried job records attempts and actual usage; it does not charge a Student unless its cost center and Product policy explicitly say so.

## 7. Economics observability

Operations should be able to answer, by revision and period:

- cost per Student generation, subject, model, provider, and cache status;
- retrieval and reranker cost versus generation cost;
- Knowledge indexing cost per source/package/revision;
- Agent 2 and Eval spend separated from production spend;
- reserved, consumed, released, corrected, and failed amounts;
- latency/cost tradeoffs and fallback cost.

No raw provider secret or raw chain-of-thought belongs in economics records.
