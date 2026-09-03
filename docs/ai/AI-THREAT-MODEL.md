# AI threat model and security controls

AI-M0 treats prompts, retrieved text, provider output, and derived analytics as untrusted at different boundaries. Security must be enforced by server permissions, scoped contracts, validation, and accounting—not by prompt wording alone.

## 1. Threat register

| Threat | Main impact | Required control boundary |
| --- | --- | --- |
| **Prompt injection** | Student text changes policy, requests secrets, or attempts unauthorized actions | Treat input as data; apply server policy and tool allowlists; never let a prompt grant identity, scope, or permissions |
| **Retrieved-content injection** | A textbook/source passage contains instructions that hijack the Tutor | Evidence is inert data; provenance/trust metadata is preserved; Orchestrator separates evidence from control instructions |
| **Sensitive information disclosure** | Private messages, secrets, or other students' data enter context or output | Principal-scoped access, minimization, redaction, output checks, no secret prompts, and trace minimization |
| **Cross-user memory leakage** | One student's memory or conversation appears in another student's answer | Memory keys and queries require server principal; no global fallback; isolation tests and deletion checks |
| **Data poisoning** | Unreviewed or malicious content becomes curriculum evidence | Only validated, approved, published Knowledge revisions enter production RAG; source trust and publication governance |
| **Vector/embedding poisoning** | A derived projection causes irrelevant or malicious evidence to rank highly | Projection source revision, integrity checks, rebuildability, metadata filters, evals, and anomaly monitoring |
| **Excessive agency** | Model or Agent 2 changes content, credentials, policy, or contacts students | Models receive bounded capabilities; Agent 2 is read-only/proposal-only; governance owns mutations |
| **Unbounded consumption** | Large prompts, repeated retries, or tool loops exhaust money or provider quotas | Context budgets, rate limits, pre-reservation, max attempts, cancellation, circuit breakers, and cost ledger |
| **Secret leakage** | Provider keys appear in logs, snapshots, client responses, or prompts | `credentialRef` only in config; `AISecretStoreAdapter`; redaction and access audit |
| **Provider retention/training risk** | Private content is retained or used by an external provider | Provider contract records retention/training terms; minimize payloads; configurable provider eligibility and deletion path |
| **Tool abuse** | A future tool fetches data or performs actions outside subject/user scope | Explicit server-side tool registry, capability-specific authorization, bounded arguments, audit, and no Web Search by default |
| **Replay/idempotency abuse** | A replayed request duplicates generation, charges, or state changes | Server idempotency keys, request status, immutable ledger entries, and safe retry semantics |
| **Budget race conditions** | Concurrent requests spend the same remaining allowance | Atomic reservation before provider execution; settlement/release by reservation ID |
| **Denial of wallet** | An attacker burns a student's or platform's budget | Principal rate limits, anomaly controls, hard budget caps, authentication, and cancellation settlement |
| **Provider outage/fallback risk** | Fallback silently changes policy, model, cost, or grounding | Versioned routing/fallback policy, capability checks, circuit breakers, trace resolved provider/model, and fail closed when required |
| **Client entitlement tampering** | Client claims Premium, a different subject, or a larger budget | Server-resolved principal and EntitlementService; ignore client-supplied studentId/plan/allowance |
| **Unauthorized publication** | Draft insight/config/knowledge becomes production truth | Change Set review, OWNER approval, publication transaction, revision checks, and no model-side publication authority |

## 2. Trust zones

```text
Untrusted: Student input, client metadata, provider output, retrieved text
        |
        v
Server validation + principal/policy/scope boundary
        |
        +--> Published Pythagoras evidence (trusted as data, not instructions)
        |
        +--> bounded provider request through an adapter
        |
Governed: canonical config, Knowledge publication, eval promotion, approvals
Restricted: secrets, raw private data, operational controls
```

“Trusted evidence” means source-authorized and published; it does not mean executable. The model cannot call a repository, read a secret store, publish a Change Set, or bypass an entitlement because text told it to do so.

## 3. M8A Tutor planning controls

M8A is a no-execution boundary: preflight and planning do not call Generation, Embedding, Rerank, admission, or settlement. Tutor Config owns only governed routing references and bounded output; Instruction Policies own product instructions. The planner accepts EvidencePack only from a trusted internal M7C-to-M8B boundary, places Evidence in an explicitly labelled user/data envelope, and never puts Evidence or Student text into trusted instructions. Response Trace persists only revision/ownership metadata and immutable references, so prompt injection remains data and cannot become stored authority.

M8B adds the first execution boundary without weakening those controls: only the server-owned `{ principal, responseId, tutorConfigId, signal? }` input is accepted; one response-bound Cost Operation and Budget Reservation cover M7C plus one exact-pinned Generation; M7C's final fence is re-run before Generation; and the Gateway receives no credential reference, secret version, provenance, or database handle. Cumulative usage is recorded before terminal status/settlement, output is bounded through M4's UTF-8-safe stream, and Provider output is retained only in the scoped Assistant Message. No production Provider, tools, Web Search, or Student API is part of M8B.

## 4. Security requirements for provider calls

- Provider adapters receive only the minimum context required for the operation.
- Credentials are resolved immediately before use and are not copied into request objects that can be logged or traced.
- Circuit enforcement binds the target to the exact Secret version returned by version-fenced resolution; rotation or revocation races fail closed before Provider invocation.
- Timeouts, cancellation, response-size limits, and retry policy are enforced by the Gateway.
- Provider response text is output data and is checked against policy/grounding requirements before being returned.
- Provider capability, retention, region, and training-use metadata are part of routing eligibility.
- Fallback must preserve subject scope, policy revision, budget accounting, and traceability.

## 5. Security tests and operational evidence

Before a capability is production-eligible, its Eval/security suite must include:

- injection attempts in current messages and retrieved chunks;
- cross-user and cross-subject access attempts;
- client identity/entitlement substitution;
- duplicate/replayed request settlement;
- concurrent reservation races and cancellation;
- secret redaction in errors, traces, snapshots, and logs;
- poisoned/invalid source and projection rebuild behavior;
- provider timeout, outage, partial stream, and fallback behavior;
- Agent 2 attempts to publish, mutate, or contact a student.

Security incidents require an append-only audit record, affected revision/request IDs, containment, deletion or key-rotation assessment, and a regression Eval where the failure can be reproduced safely.

## 6. Web Search policy

Generic Web Search is **OFF by default**. The baseline Student Tutor is grounded in Pythagoras-owned published knowledge and existing approved Product data. Any future external retrieval capability would require a separate threat review, source policy, cost policy, provenance model, and explicit Product approval.
