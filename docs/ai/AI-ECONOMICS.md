# AI economics, budgets, and usage accounting

AI cost is a Product and safety boundary. Every expensive operation is attributed before it runs and reconciled after it finishes.

## Current implementation boundary

AI-M3A, AI-M3B, AI-M3C1, and AI-M3C2 are implemented as reviewed checkpoints of Operations Core. M3A owns governed Rate Cards and immutable usage/cost accounting. M3B owns governed Budget/Rate Limit Policies, pinned Budget Accounts, atomic admission reservations, M3A-backed exposure/settlement, and persisted request-frequency/concurrency controls. M3C1 owns durable reference-only Jobs, transactional Outbox dispatch, fenced leases/attempts, and bounded recovery; it uses migration `0016_left_queen_noir`. M3C2 owns passive persistent Circuit Breaker state and health observations; it uses migration `0017_lean_oracle` and does not perform active Provider probes. No real Provider prices are seeded; Student auth/entitlement and Provider execution remain outside these checkpoints. The private Conversation Core is a separate AI-M4 boundary and does not alter these economics contracts.

Circuit health is local observation for an exact policy/route/credential-version target: `CLOSED` means Pythagoras has not tripped that target, `OPEN` suppresses it during cooldown, and `HALF_OPEN` admits one guarded real Product request. It is not a claim that a Provider is globally healthy, and no synthetic health request is generated.

AI-M7B uses the existing `KNOWLEDGE_INDEXING` cost center for document embedding Jobs. It creates one cost operation per embedding projection Job, reserves a conservative integer nano-cost before the first Provider call, accounts every Gateway attempt where usage identity permits, and settles actual cost or preserves the existing reconciliation state when usage is incomplete. It does not introduce a Student-facing cost counter.

## 1. Cost centers

AI-M7C query embedding and optional reranking are variable-cost work in the caller's existing `STUDENT_GENERATION` operation. M7C requires the matching reservation to be `EXECUTING`, records each actual Gateway attempt through M3A accounting, and leaves operation completion and reservation settlement to the owning orchestration milestone. M7C never charges query work to `KNOWLEDGE_INDEXING` and does not create a second admission.

AI-M8A performs provider-neutral cost preflight only. It estimates one bounded Tutor turn as QUERY embedding plus optional reranking plus Generation using the exact pinned Model/Provider and Rate Card revisions, integer nano-currency, and one UTF-8 byte as an upper bound for one input token. For a reasoning-capable Generation Model, `reasoningTokenUpperBound = maxOutputTokens`; the positive reasoning quantity must be priceable and is never assumed free. It requires all components to resolve to the Budget Policy currency and fails closed on incomplete or mixed-currency cards. M8A creates no Cost Operation, Budget Reservation, admission, settlement, or Provider usage record; M8B owns that lifecycle after the plan is accepted.

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

### AI-M3B admission contract

M3B executes a server-created `AIAdmissionPlan`; it does not resolve Student identity, subscription entitlement, or the eventual billing window. The plan pins `principalRef`, exact Budget and Rate Limit Policy revisions, an explicit `[startAt, endAt)` period, an existing M3A `costOperationId`, a conservative `maxCostNano` estimate, an idempotency key, and a SHA-256 request fingerprint. Mobile and other clients are not authorities for any of these values.

Budget Policy revisions are immutable. There is at most one Budget Account for a principal, stable Budget Policy identity, and exact period; that account pins one policy revision and snapshots its currency, cost center, and hard cap for the whole period. Later policy revisions do not rewrite or duplicate an open account: a plan requesting a different revision for that period fails closed, while a new period may use the newer revision. Admission uses a SQLite `BEGIN IMMEDIATE` transaction to read exposure and insert at most one reservation. Exact idempotent replays return the existing reservation; a different fingerprint or operation is a conflict. A valid new request that passes idempotency and rate-limit checks records a rate event even when the later budget or concurrency check rejects it. Rate-limited requests themselves do not create another event, so retry metadata remains meaningful.

For an account, the authoritative exposure is:

```text
effectiveSpentNano
  = sum(max(effective M3A cost per operation in account currency, 0))
    for operations whose original startedAt is inside the account period

additionalReservedExposure
  = sum(max(reservedNano - max(current effective operation cost, 0), 0))
    for RESERVED, EXECUTING, and RECONCILIATION_REQUIRED reservations

totalExposureNano = effectiveSpentNano + additionalReservedExposure
remainingNano = max(hardCapNano - totalExposureNano, 0)
```

M3A corrections are attributed through the original operation start time, not correction-entry time. A multi-currency or incomplete/unknown operation remains `RECONCILIATION_REQUIRED`; no currency conversion or zero-cost assumption is made. A trustworthy actual cost may exceed both its reservation and hard cap: M3B settles the real M3A cost, records overage metadata, reports `overCap`, and denies new exposure until the snapshot permits it.

Rate limits use persisted top-level request events in the half-open active window `occurredAt > now - windowMs` and `occurredAt <= now`, with server time only. Events and active reservations are scoped to the stable Rate Limit Policy identity while their exact revision remains recorded for audit. The oldest active event determines `retryAfterMs`; active reservations in `RESERVED`, `EXECUTING`, and `RECONCILIATION_REQUIRED` consume concurrency. M3B has no background expiry or cleanup path.

### AI-M3C1 recovery boundary

M3C1 provides durable at-least-once execution, never an exactly-once guarantee. Job claims, completion, heartbeat, failure, and expired-lease recovery are fenced by owner, token, and generation; handlers must be idempotent because a crash after a domain side effect and before completion can cause a retry. Job and Outbox payloads are bounded canonical JSON references with SHA-256 integrity hashes and no raw student content, secrets, prompts, answers, or provider bodies. A standalone worker and Outbox dispatcher select only exact registered kind/event-type plus payload-version pairs before ordering and limiting; unsupported future versions remain pending without starving compatible work. The worker is not a Next.js request handler.

M3B uncertain reservations are recovered without duplicating settlement arithmetic: stale `RESERVED` reservations use the existing pre-execution release transition; stale `EXECUTING` reservations use the existing settlement path; `RECONCILIATION_REQUIRED` reservations retain exposure and receive a deduplicated `admission.reconcile-reservation` Job keyed by the reservation and current safe accounting fingerprint. Incomplete reconciliation retries with bounded backoff and may dead-letter, but it never automatically releases the reservation. M3C2 Circuit Breakers are a separate passive operational boundary and do not alter M3A/M3B monetary arithmetic or admission semantics.

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
