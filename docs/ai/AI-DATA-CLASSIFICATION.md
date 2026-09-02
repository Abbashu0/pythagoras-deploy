# AI data classification, privacy, and retention

AI-M0 established data handling rules before AI runtime existed. AI-M4 materializes the private Conversation core, AI-M5 materializes governed Policy/Context metadata, AI-M6 materializes governed Knowledge content, AI-M7A materializes rebuildable Chunk/FTS projections, and AI-M7B materializes rebuildable embedding/vector projections while preserving these classifications. Classification follows the strictest applicable class when a record contains multiple kinds of data.

## 1. Data classes

| Class | Examples | Allowed use | Default handling |
| --- | --- | --- | --- |
| **C1 — Published curriculum** | Published Questions, Variants, Occurrences, approved Knowledge Package content, taxonomy, source provenance | Student grounding, approved retrieval, deterministic eval fixtures | Canonical source remains Pythagoras-owned; public or internal access follows the existing publication boundary. M6 package content is eligible only after governed publication and current Source rights/enabled checks |
| **C2 — Governed Product configuration** | Global/subject instruction policy, context budgets, model routing, retrieval settings, budget policy, eval thresholds, approved insights, bounded Knowledge Source/Package publication metadata | Backend decisions and reviewed operations | Revisioned Change Set snapshots and atomic publication; large M6 Package content is hash-pinned in a runtime artifact rather than copied into a snapshot; no secret values |
| **C3 — Derived projections** | M7A chunks and separate lexical FTS rows, M7B embedding projections and vector indexes, later retrieval features, clusters, compact summaries | Retrieval, analysis, diagnostics | Rebuildable, revision-linked, deletable/recomputable; never treated as canonical truth; M5 Context Snapshots are immutable metadata audit records, not raw-content projections; M7A/M7B rows retain no Student C4 data, secrets, or provider credential material |
| **C4 — Student private content** | Messages, conversation history, summaries, memory, feedback text, uploaded student content | The scoped student's experience and privacy-controlled operations | Access isolated by server principal and subject; not curriculum truth; retention and deletion apply |
| **C5 — Sensitive operational data** | Provider errors, rate-limit state, budget reservations, trace identifiers, abuse signals | Operations, audit, cost controls, incident response | Least-privilege internal access; minimize payloads and redact logs |
| **C6 — Credentials and secrets** | Provider keys, encryption/master keys, secret-manager tokens | Adapter execution only | Secret-store boundary; never normal SQLite strings, API DTOs, snapshots, prompts, logs, Mobile, or Git |
| **C7 — De-identified analytics** | Pseudonymous usage aggregates, retrieval quality metrics, eval and event projections | Product analytics, Agent 2, operations | Redact/minimize before projection; no direct account identity unless specifically authorized |
| **C8 — Evaluation and improvement data** | Curated prompts, expected evidence, grader results, failure cases, proposal evidence | Evals and governed improvement | Versioned and reviewable; production data enters only through an approved minimization path |

## 2. Raw conversation versus analytics

AI-M7C query text and EvidencePacks are request-scoped runtime data. The query is untrusted and bounded, is sent only to the selected embedding/reranker adapter through the Gateway, and is not placed in configuration, durable Jobs, projections, vectors, trace metadata, or cost records. EvidencePack items retain only bounded published evidence and safe provenance/scores for the future Tutor boundary.

The **Raw Conversation Store** and **De-identified Analytics Projection** are different boundaries.

```text
server-resolved principal + raw message
        -> access-controlled Raw Conversation Store
        -> redaction / PII detection / minimization
        -> pseudonymous event and analytics projection
```

Account metadata removal is not de-identification: a student may type a phone number, address, name, school, or other personal information into a message. The minimization pipeline must inspect message content and derived fields before analytics, Agent 2, or eval export.

Raw content may be retained for the declared conversation-history period and legally required audit purpose, but it does not automatically enter model context, training data, curriculum, Agent 2 samples, or eval datasets. Every secondary use requires a purpose, access policy, retention, and provenance.

## 3. Secret rules

- Provider configuration stores only a non-sensitive `credentialRef` and safe capability metadata.
- `AISecretStoreAdapter` is the only boundary allowed to resolve a secret for a provider call.
- A local implementation may encrypt secrets under `PYTHAGORAS_DATA_DIR`, but its encryption/master key MUST be outside the database and repository. A production secret manager remains a replaceable adapter.
- Secret values are never returned through Admin APIs, included in Change Set or publication snapshots, placed in prompts, included in provider error text, or written to normal logs.
- Secret access, rotation, revocation, and failed access are auditable without recording the secret.

## 4. Cross-user and subject isolation

- Every Student conversation and memory lookup is scoped by a server-resolved opaque principal and immutable `subjectKey`.
- A client-supplied principal, `studentId`, conversation owner, or entitlement cannot widen that scope.
- Retrieval filters are enforced server-side before evidence reaches the Orchestrator.
- Memory keys include principal scope; there is no global student-memory fallback.
- Analytics aggregation removes direct identity and must not make one student's text discoverable through another student's response.

## 5. Retention and deletion

Future implementation must define policy values before enabling production data:

1. Conversation retention by account/product policy, with explicit deletion semantics.
2. Memory retention, review/expiry, and deletion when the source conversation or principal is deleted.
3. Projection deletion/rebuild for chunks, embeddings, traces, analytics, and eval derivatives.
4. Secret revocation and audit retention independent of conversation retention.
5. Legal hold handling without silently keeping unrelated data.

AI-M4 implements explicit Student-owned Conversation deletion: active response state is terminalized safely, temporary chunks and raw Messages are purged, and only minimal response/Conversation tombstone metadata remains. The opaque top-level idempotency key is retained as operational identity so deletion cannot make a request reusable, while raw C4 content and its fingerprint/message references are removed. Broader retention, derived projections, queued jobs, caches, analytics references, and provider-side deletion responsibilities remain future privacy-hardening work. Deletion is a workflow, not a single row delete.

## 6. Prompt and trace minimization

- Current-message content is untrusted and is included only after policy/context checks.
- Retrieved evidence is data with provenance, not executable instructions.
- Traces store revision IDs, chunk IDs, scores, decisions, and minimized references rather than unrestricted prompt copies where possible.
- Raw chain-of-thought is never persisted or exposed as Product data. A short structured decision/result reason may be stored when needed for audit.
- Provider responses are normalized at the adapter boundary; provider debug payloads are not automatically persisted.

## 7. Access model

| Actor | C1/C2 | C4 | C5/C6 | C7/C8 |
| --- | --- | --- | --- | --- |
| Student request | Scoped published evidence | Own scoped conversation only | No direct access | No direct access |
| ADMIN | Governed read/review according to role | No arbitrary raw conversation access | No secret values | Minimized analytics/eval views |
| OWNER | Governance and publication | Controlled support/audit access | Secret administration through the secret boundary, never raw API return | Approve eval/proposal changes |
| Agent 2 | Published/minimized data only | De-identified samples by policy | No secrets or live credentials | Create insight/proposal candidates |
| Provider | Request-scoped data necessary for execution | No implicit ownership | Credential is resolved server-side | No platform database access |
