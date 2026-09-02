# Knowledge and grounded retrieval

AI-M6 implements the source and published-package boundary only. Approved AI-M7A implements the first rebuildable structural Chunk Projection and lexical FTS5 foundation. Approved AI-M7B implements the semantic embedding/vector projection foundation over exact fresh M7A revisions. Approved AI-M7C adds the governed hybrid retrieval, deterministic fusion, optional reranking, and bounded runtime EvidencePack boundary. AI-M8A consumes that EvidencePack only through a trusted internal planning boundary; Package publication still does not create retrieval data automatically.

## 1. Knowledge is a separate domain

`pythagoras.knowledge-package` is a portable contract for approved source documents. Its V1 envelope and strict diagnostics are defined in [KNOWLEDGE-PACKAGE-V1.md](./KNOWLEDGE-PACKAGE-V1.md). It is not `pythagoras.question-package`, and it does not copy the relational Question domain.

The Question domain remains authoritative for Questions, Variants, Occurrences, shared Answers, taxonomy assignments, and placement-scoped Question Browse. AI-M6's read-only Question Knowledge Projector is a canonical SQLite read boundary: it exposes only published rows, derives the subject from the owning Package, rejects a caller scope that differs from that Package, and preserves Package revision/contentRevision, Question revision, Variant revision, and Occurrence revisions. Its stable logical projection identity is separate from a SHA-256 revision fingerprint built from safe IDs, revisions, display/order metadata, and taxonomy identity; raw Question/Answer text is not hashed as a substitute for revision identity. No Question rows are copied into Knowledge storage.

## 2. Knowledge Package contract

A Knowledge Package revision MUST be able to carry:

- stable Package identity and portable key;
- `subjectKey` and any explicitly approved material scope;
- source type from:
  - `OFFICIAL_TEXTBOOK`;
  - `MINISTERIAL_REFERENCE`;
  - `PYTHAGORAS_APPROVED`;
  - `TEACHER_SUPPLEMENT`;
  - `REFERENCE_TABLE`;
  - `OTHER_APPROVED`;
- title, edition/version, language, and content revision;
- trust tier and source owner/authority;
- page, chapter, section, paragraph, or equivalent provenance;
- structured content using an editor-neutral/document-neutral representation;
- rights, license, attribution, and usage metadata where applicable;
- source acquisition/validation metadata without embedding secret credentials.

The Package represents approved source content. It MUST NOT require precomputed chunks or embeddings to be portable. Chunking and embeddings are post-publication projections.

## 3. Publication boundary

```text
registered source
  -> Package validation and semantic checks
  -> governed Change Set
  -> review and OWNER approval
  -> atomic publication of Package revision
  -> durable projection jobs
  -> retrieval-ready projection revision
```

Only approved/published Knowledge revisions are eligible for production RAG. In M6, the eligibility read boundary additionally requires subject match, an existing pinned Source revision, and the current Source state to be enabled with `rightsStatus = CLEARED`; disabling/restricting a Source removes current eligibility without erasing historical Package rows. A later projection records the exact source `knowledgeRevision`, chunking revision, embedding configuration revision, and index revision. If a projection is stale or incomplete, the retrieval policy must fail closed, use a known-good prior published projection, or return insufficient evidence according to an explicit policy; it must not silently blend unpublished content.

M7A's structural projection uses bounded pages and one server-owned `structured-rich-v1` strategy. Its text is derived from canonical RichDocument semantic units, carries exact source/question revision metadata, and is indexed in a separate `ai_retrieval_fts` table. The current READY revision is activated atomically; a failed newer build leaves the prior READY revision available. BUILDING revisions are resumed from persisted cursors after restart, and SQLite protects Projection Set identity, lifecycle transitions, and chunk ownership/content. The Question origin uses the canonical published-only QuestionKnowledgeProjector and the explicit safe `PYTHAGORAS_APPROVED` trust tier rather than inferring official trust from an occurrence label. M7A does not implement semantic retrieval, vector storage, fusion, reranking, or EvidencePack.

M7B's semantic projection consumes one exact current/fresh M7A READY revision and one server-owned embedding Model Config. It pins Model/Provider revisions and the `float32-le-v1` codec/local exact cosine adapter identity; batches execute only through `AIProviderGateway.embed`, persist reference-only Jobs, reserve/cost-account `KNOWLEDGE_INDEXING`, and activate immutable/rebuildable vectors only after exact coverage and lease/config/M7A checks. Vector search is subject-scoped, bounded-memory, cosine-ranked, and rechecks current Knowledge Source rights/enabled state. The active search construction requires an explicit semantic-eligibility boundary and fails closed when M7A freshness/currentness or pinned Model/Provider configuration is not exact. Exact-revision health reports the requested Embedding revision rather than silently resolving a sibling current revision. Terminal embedding recovery scans only unresolved `BUILDING` projections joined to terminal embedding Jobs, in stable bounded batches, and uses the relational Job/Projection/Cost ownership contract rather than Job payload parseability; `BUILDING -> FAILED` is durable forward progress that survives restart, while retry-waiting Jobs remain BUILDING. Conversion from provider JavaScript numbers to Float32 can lose precision by design; exact dimensions, finite values, non-zero norm, byte length, and encoded-byte SHA-256 are the derived-index integrity contract. The replaceable `VectorIndexAdapter` keeps future vector storage out of the M7B public semantics. M7B does not turn query text into embeddings and does not implement fusion, reranking, or EvidencePack.

## 4. Retrieval pipeline

### AI-M7C implementation status

AI-M7C is approved. Retrieval Config is governed and subject-bound. Runtime selection is bounded and published-only: eligible origins must have exact fresh/current M7A projections and complete current M7B coverage in one embedding space before the query Provider is called. Lexical candidates are scoped to those M7A revisions; one query embedding is obtained through the existing Gateway; semantic ranks are recomputed globally; integer weighted RRF deduplicates the union; and an optional single reranker receives only bounded query plus candidate ID/text. A final live Source, projection, Model/Provider, and Config fence returns no evidence on a race. EvidencePack is runtime-only, no raw query is persisted, and M7C does not implement Generation, Web Search, or the Tutor.

The M7C correction makes the Config revision history append-only at SQLite level and pins the server-owned `weighted-rrf-v1@1` algorithm on every Config revision. `semanticCandidateLimit` is the global semantic K after per-origin vector scans and global cosine ordering; `fusionCandidateLimit` applies only after that semantic cap to the lexical/semantic union. The final fence re-enumerates and stable-sorts the eligible `(originKind, originId, subjectKey)` set, so newly published or newly re-enabled origins fail closed without another Provider call. Evidence items carry bounded cloned M7A origin metadata, including Question projection identity, occurrence revisions/source fields, and taxonomy assignments; text and serialized provenance consume the evidence byte budget together, and neither is truncated.

The baseline flow is:

```text
subject/material metadata filter
        |
        +--> lexical retrieval
        |
        +--> semantic retrieval through EmbeddingProviderAdapter + VectorIndexAdapter
        |
        v
deterministic fusion
        |
        v
optional reranking (bounded rerank K)
        |
        v
minimum evidence threshold
        |
        v
bounded Evidence Pack (evidence K)
        |
        v
Grounded Tutor Orchestrator
```

The pipeline distinguishes:

- **candidate K** — the bounded union of lexical and semantic candidates;
- **rerank K** — the bounded subset eligible for a reranker;
- **evidence K** — the small, deduplicated set that passes score, trust, scope, and provenance checks and is sent to generation.

Not every retrieved candidate is sent to the model. Every Evidence item retains chunk ID, source/package identity, page/section provenance, trust tier, projection revision, retrieval score, rerank score where present, and an inclusion reason.

## 5. Trust and conflict policy

Trust is an explicit ranking and eligibility dimension, not a prompt instruction. The baseline precedence is:

1. official curriculum and ministerial references;
2. Pythagoras-approved explanations and reference tables;
3. reviewed teacher supplements;
4. other explicitly approved sources.

When sources conflict, the higher trust tier wins for curriculum claims. Lower-tier evidence may explain, contextualize, or be flagged as a conflict, but it cannot override an official source. If conflict affects correctness and cannot be resolved, the Tutor should state that the evidence is insufficient rather than invent a synthesis.

Subject/material filters are mandatory before ranking. A source approved for one subject is not eligible merely because its words match a query in another subject.

## 6. Projection and adapter rules

`ChunkProjection`, `EmbeddingProviderAdapter`, `VectorIndexAdapter`, and `LexicalRetrieval` are derived/retrieval boundaries. They MUST support:

- deterministic source and chunk identity;
- source/config revision references;
- idempotent rebuild and deletion;
- bounded batches and retryable jobs;
- integrity/coverage health reporting;
- local exact vector search initially;
- future replacement by pgvector or a vector service without changing the Orchestrator/Evidence contracts.

Canonical content remains SQLite-first in the current architecture. AI-M0 does not install sqlite-vec, another extension, or an external Vector DB.

Existing Question FTS5 is a Product Question Search projection. It may be an input to a future lexical retrieval adapter, but its placement-scoped public search contract and health gate are not silently changed into AI RAG.

## 8. M8A Tutor boundary

M8A does not execute retrieval. A future M8B orchestrator must obtain the EvidencePack directly from approved M7C and pass it across the trusted internal boundary. `AITutorGenerationPlanner` requires sufficient, subject-matching Evidence with the exact Retrieval Config and fusion identity; it consumes whole items under the M5 evidence budget, emits deterministic `[E#]` labels, and sends only labels plus exact Evidence text as user/data messages. Provenance remains in the runtime citation map and metadata-only Response Trace references; it is not sent to Generation. An insufficient or mismatched EvidencePack produces no Generation plan and no Provider call.

## 7. Grounding contract

The Grounded Tutor receives:

- server-resolved principal and immutable subject scope;
- applicable global and subject policy revisions;
- ContextBudgetManager plan;
- relevant conversation summary/recent turns and allowed memory;
- bounded Evidence Pack;
- current message and output reserve.

It does not receive database handles, secret values, unrestricted search, arbitrary tools, or executable retrieved instructions. A response that cannot meet the minimum evidence threshold must follow the configured insufficient-evidence behavior.

## 9. Web Search

Web Search is OFF by default. The baseline Tutor is grounded in Pythagoras-owned published knowledge and approved Product data. External web retrieval is a future separately governed capability, not part of the baseline contract.
