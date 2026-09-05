# Evals, Agent 2, and improvement governance

## 1. Pythagoras Eval Suite

The Eval Suite is mandatory infrastructure before automated or model-routing improvements reach production. A suite is versioned by dataset, expected evidence, grader configuration, policy/configuration revisions, model/provider resolution, and run identity.

Evaluation dimensions include:

- correctness;
- curriculum fidelity;
- groundedness;
- source fidelity;
- relevance;
- conciseness;
- instruction following;
- Arabic quality;
- Iraqi naturalness;
- mathematics correctness;
- off-topic behavior;
- retrieval quality;
- cost;
- latency;
- security.

Deterministic graders are preferred for IDs, scope, citations/provenance, required structure, policy outcomes, arithmetic, cost, latency, and retrieval coverage. LLM-as-judge MAY supplement these checks but MUST NOT be the sole authority for curriculum correctness, security, or publication.

Production failures that can be minimized safely MUST be promotable to regression Eval cases with their source revision, policy context, expected behavior, and privacy classification.

## 2. Eval gates

Before a model, provider, prompt/policy revision, retrieval setting, or reranker becomes production-eligible, the run must show:

1. no blocking security or cross-user failures;
2. acceptable curriculum/source fidelity on the applicable subject suites;
3. retrieval evidence quality above the configured threshold;
4. budget and latency within the approved envelope;
5. no unexplained regression against the last approved baseline;
6. a complete reproducible trace and reviewer decision.

An Eval result recommends; Governance decides. A passing score does not grant publication authority to a model or Agent 2.

## 2A. AI-M9A implementation boundary

AI-M9A creates the durable evaluation truth, but does not execute an evaluation target. `ai.eval-suite` and `ai.eval-case` are governed through Change Sets and OWNER publication; their revisions are append-only, and each Suite revision pins a non-empty ordered manifest of exact Case IDs and Case revisions. Cases use closed origin/privacy classifications: synthetic cases are public-safe, curated cases are internal, and `DEIDENTIFIED_REGRESSION` requires explicit de-identification proof. No StudentPrincipal, principal reference, Conversation ID, Response ID, credential, or raw production failure may enter a Case.

The code-owned `deterministic-evals-v1@1` registry supplies fixed, bounded checks for terminal behavior, M8C citation integrity, Evidence/source expectations, retrieval coverage, literal expectations, security leakage, output bounds, cost, and latency. Suite configuration references grader identities only; it cannot store JavaScript, SQL, regex programs, or executable prompt templates. Scores, thresholds, and permitted baseline regressions use integer units from 0 through 1,000,000. `ai_eval_grader_results` is the deterministic-result boundary: a result must match an exact grader configured in the pinned Suite revision and a `DETERMINISTICALLY_GRADED` dimension; it cannot impersonate a supplementary judge. `JUDGE_REQUIRED` remains `INCOMPLETE` in M9A/M9B1 until the separate M9B2 judge boundary. Missing required deterministic or future judge dimensions are `INCOMPLETE`; a blocking security failure is always `BLOCKED`.

M9A Runs pin the exact Suite revision, manifest fingerprint, safe Tutor/Policy/Context/Retrieval/Model/Provider identity snapshot, and candidate SHA-256 fingerprint. Runtime observations are trusted internal inputs; durable Case results retain only bounded hash/size, status, Evidence identities, latency, privacy, and an optional canonical `EVALS` Cost Operation reference. No chain-of-thought, raw Student conversation, prompt, Provider secret, or unbounded output store is created. Run, result, aggregate, and gate history is append-only.

Absolute gates are evaluated before baseline/regression gates for required dimensions, cost, latency, retrieval/source coverage, and security. Every pinned manifest Case must have exactly one matching Case result before any run can be `PASS_RECOMMENDED`; this manifest gate also applies when all dimensions are `NOT_APPLICABLE`. Observations and deterministic grader results are accepted only while a Run is `RUNNING`; the `SCORING` transition freezes those inputs, after which only aggregates, gates, and terminalization are written. When a maximum-cost gate is configured, it requires a terminal `EVALS` operation with complete canonical usage records, exact Run/subject ownership, and a single safe currency total; unknown, open, empty, partial, multi-currency, or unsafe accounting is `INCOMPLETE`, never zero. A terminal operation with no usage record is not treated as provable zero. A passing or blocked cost gate also stores a safe immutable accounting basis containing the operation, usage-record, and correction identities, currency, total, and SHA-256 fingerprint; later append-only Corrections make the basis `STALE` without rewriting the historical gate. Baselines must be completed, passing, same-suite, same-revision, same-manifest, and grader-comparable; self-baselines and incomplete/failed baselines are not comparable. `PASS_RECOMMENDED` is an Eval recommendation only: it never publishes or mutates Tutor, Model, Provider, Policy, Retrieval, Knowledge, Question, routing, or credentials. M9B will later bind live target execution and judge work to `EVALS` Cost Operations through `evalRunId`; M9A makes zero Generation, Embedding, Rerank, or judge calls.

## 2B. AI-M9B1 target execution boundary

M9B1 uses a governed subject-bound Eval Execution Config with append-only revisions. A Run is pinned to one exact Execution Config revision and schedules its pinned manifest in fixed batches of at most 100 Cases, in deterministic ordinal order, without duplicate work. Each Case has one durable safe Case Execution and one target `EVALS` Cost Operation with `opaquePrincipalRef`, Conversation, Response, Job, and idempotency identities null; the technical idempotency key remains in the Case Execution/admission scope. EVAL admission uses the code-owned `system-evals` scope so EVAL operations participate in the ordinary M3 budget/rate-limit accounting without inventing a Student identity. Transient Admission retries use a durable generation and reset the latency boundary for the next candidate attempt; a successful retry clears the prior infrastructure failure reason.

The target invokes the real internal M7C Retrieval, M8A Preflight/Generation Planner, M8C validator, and Provider Gateway with deterministic test adapters only. It requires the Run candidate snapshot, including the exact embedding projection/model space, to remain current before Provider work, records QUERY Embedding/Rerank/Generation usage against the same operation, and never mixes Provider attempts or performs Generation fallback. Synthetic M4 Conversations have durable metadata-only cleanup ownership and are deleted through the approved M4 path; cleanup is bounded, idempotent, recoverable after restart, and target coverage remains incomplete while cleanup is pending. Target latency is the bounded integer interval from Case Execution `startedAt` to terminal observation. Rate-limit and transient concurrency denials remain retryable infrastructure state without a candidate Case result; budget denial is terminal operational failure without a fabricated candidate result. Jobs are reference-only and terminal recovery uses relational Case Execution ownership without requiring a parseable payload. M9B1 leaves Runs `RUNNING` for explicit later scoring; it does not add a Judge, Student API/UI, or production Provider.

## 2C. AI-M9B2 supplementary judge and final M9 integration boundary

AI-M9B2 introduces the governed Supplementary LLM Judge domain via migrations `0037_eval-supplementary-judge.sql` and `0038_eval-judge-execution-hardening.sql`, and the `ai.eval-judge-config` resource type managed through Change Sets with OWNER-only approval and publication. A Judge Config pins the subjectKey, Model Config, Provider Config, Budget Policy, Rate Limit Policy, timeout, max output tokens, and code-owned protocol identity `eval-judge-v1@1`.

Key invariants and delivered architectural boundaries include:
1. **Runtime-Only Evaluation Handoff:** Target execution hands candidate output and retrieved evidence snippets directly to the Judge Execution Service in memory. Raw candidate output, evidence text, prompt templates, and raw judge outputs are strictly ephemeral and never written to SQLite or disk.
2. **Distinct EVALS Cost Accounting:** Every Judge execution runs under a separate, dedicated `EVALS` Cost Operation and Budget Reservation under the `system-evals` admission scope. Private identities (`opaquePrincipalRef`, conversation, response, job) remain null. Target and Judge operations are both included in the Run's accounting basis for max-cost gates.
3. **Self-Judge Prevention:** A candidate model revision cannot evaluate itself; self-judge configurations fail closed at execution time and trigger database-level trigger constraints.
4. **Prohibition of Judge Security Evaluation:** Security is strictly deterministic; SQLite triggers and protocol validators forbid the Judge from evaluating the `SECURITY` dimension.
5. **Strict Protocol & Non-Repairing JSON Parser:** The Judge must output valid JSON conforming strictly to `{"protocol": "eval-judge-v1", "revision": 1, "scores": [{"dimension": string, "rubricBand": string, "scoreUnits": number}]}`. Malformed JSON, extra keys, missing dimensions, duplicate dimensions, or invalid rubric bands fail safely without secondary model repair loops.
6. **Fixed-Point Integer Scoring & Strict Rubric Bands:** Qualitative scores use the 0..1,000,000 scale with exact rubric band boundaries enforced at the protocol parser, repository, and SQLite trigger layers: `EXCELLENT` (900,000..1,000,000), `PASS` (700,000..899,999), `MARGINAL` (500,000..699,999), and `FAIL` (0..499,999). Both `EXCELLENT` and `PASS` count towards passed cases.
7. **Crash / Re-Entry Fail-Closed Recovery:** Re-entering a nonterminal Judge Execution fails closed to `AMBIGUOUS` if invocation is proven with accounting, or `INPUT_LOST` if unproven, with ZERO second Gateway calls.
8. **Lease / Cancellation Propagation:** Lease loss before Judge Provider work aborts with `EVALS_JUDGE_LEASE_LOST` (re-throwing `AI_JOB_LEASE_LOST`); lease loss after Provider work marks the execution `AMBIGUOUS` while preserving recorded usage and financial accounting.
9. **Proven Provider Invocation:** Judge Results are rejected by the repository and database triggers unless the parent execution proves `provider_invoked = 1`, `provider_invocation_state = 'INVOKED_WITH_ACCOUNTING'`, and a linked `judge_cost_operation_id`.
10. **Deterministic Security Priority:** Deterministic security failures block the Run regardless of high qualitative Judge scores.
11. **Strict Baseline Comparability:** Baseline comparisons require exact identity match across Judge configuration, protocol, model revision, and provider revision. Divergence results in `BASELINE_NOT_COMPARABLE`.
12. **Candidate Latency Purity:** The `MAX_LATENCY_MS` gate evaluates candidate target generation latency only, strictly excluding judge latency.

### AI-M11 analytics handoff boundary

AI-M11 is implemented pending independent review and provides only bounded, de-identified metadata/events and read DTOs for future Admin analytics and Agent 2. It does not perform clustering, generate insights, publish changes, or alter Eval truth. M3 Cost Operations/Usage Records and M9 Eval records remain canonical; telemetry references them without copying raw Student, Assistant, Evidence, Memory, Summary, Provider, or Judge content.

## 3. Agent 2 is read-only intelligence

Agent 2 is not a free-running autonomous agent. Its baseline pipeline is:

```text
deterministic SQL / normalized events
        -> optional embeddings and clustering
        -> representative samples
        -> structured LLM analysis
        -> Insight / proposal candidate
```

Agent 2 MAY create:

- structured insights;
- evidence links to de-identified samples;
- QuestionCluster, Misconception, KnowledgeGap, ExplanationPattern, or RetrievalProblem candidates;
- ImprovementProposal candidates.

Agent 2 MUST NOT:

- approve or publish anything;
- mutate curriculum truth;
- change provider credentials or routing directly;
- message students;
- access arbitrary tools or unrestricted Web Search;
- bypass Evals, privacy, budget, or governance.

Agent 2 receives only the minimum de-identified/approved data needed for the analysis and writes through a proposal boundary.

## 4. Second Brain relational model

Second Brain is relational and typed. No graph database is required. The conceptual entities are:

- `Insight`;
- `InsightEvidence`;
- `InsightRelation`;
- `QuestionCluster`;
- `Misconception`;
- `KnowledgeGap`;
- `ExplanationPattern`;
- `RetrievalProblem`;
- `ImprovementProposal`.

`InsightRelation` carries a controlled relationship type, source/target identity, confidence, evidence references, and revision metadata. The model must be visualizable later without making the visualization the source of truth.

Second Brain records are hypotheses, observations, or proposals—not Curriculum Facts. A curriculum change requires the Knowledge/Question governance path, human review, and the relevant Evals.

## 5. Improvement lifecycle

```text
event/failure or Agent 2 observation
  -> de-identification and evidence review
  -> structured ImprovementProposal
  -> deterministic + supplementary Eval run
  -> Admin review / OWNER decision
  -> Change Set for governed resources
  -> OWNER publication
  -> post-publication monitoring and rollback/rebuild plan
```

The proposal records what changed, why, evidence, affected subjects, risk, cost/latency impact, Eval runs, reviewer, and resulting publication revision. Proposal status cannot itself make a change active.
