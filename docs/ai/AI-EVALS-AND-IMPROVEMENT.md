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
- latency.

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
