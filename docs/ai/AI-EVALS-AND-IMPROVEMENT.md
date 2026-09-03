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

The code-owned `deterministic-evals-v1@1` registry supplies fixed, bounded checks for terminal behavior, M8C citation integrity, Evidence/source expectations, retrieval coverage, literal expectations, security leakage, output bounds, cost, and latency. Suite configuration references grader identities only; it cannot store JavaScript, SQL, regex programs, or executable prompt templates. Scores, thresholds, and permitted baseline regressions use integer units from 0 through 1,000,000. Missing required deterministic or future judge dimensions are `INCOMPLETE`; a blocking security failure is always `BLOCKED`.

M9A Runs pin the exact Suite revision, manifest fingerprint, safe Tutor/Policy/Context/Retrieval/Model/Provider identity snapshot, and candidate SHA-256 fingerprint. Runtime observations are trusted internal inputs; durable Case results retain only bounded hash/size, status, Evidence identities, latency, privacy, and an optional canonical `EVALS` Cost Operation reference. No chain-of-thought, raw Student conversation, prompt, Provider secret, or unbounded output store is created. Run, result, aggregate, and gate history is append-only.

Absolute gates are evaluated before baseline/regression gates for required dimensions, cost, latency, retrieval/source coverage, and security. Baselines must be completed, passing, same-suite, same-revision, same-manifest, and grader-comparable; self-baselines and incomplete/failed baselines are not comparable. `PASS_RECOMMENDED` is an Eval recommendation only: it never publishes or mutates Tutor, Model, Provider, Policy, Retrieval, Knowledge, Question, routing, or credentials. M9B will later bind live target execution and judge work to `EVALS` Cost Operations through `evalRunId`; M9A makes zero Generation, Embedding, Rerank, or judge calls.

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
