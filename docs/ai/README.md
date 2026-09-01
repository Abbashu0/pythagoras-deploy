# Pythagoras AI Intelligence System

## AI-M0 status

**AI-M0 — Architecture Lock & Backend Readiness Specification** is a documentation-only milestone. It records the boundaries, contracts, safety rules, and delivery gates for the future Pythagoras AI Intelligence System.

AI-M0 adds no AI runtime, provider SDK, database table, migration, API call, Admin AI surface, or Mobile AI surface. It does not import or transform curriculum data and it does not read or write runtime data.

## Product position

Pythagoras AI is an educational intelligence platform, not a chatbot integration. Providers and models are replaceable compute engines. Pythagoras owns curriculum grounding, policy, retrieval, memory, conversation state, analytics, evaluation, economics, governance, and revision traceability.

The current repository remains the root Next.js Backend/Admin application plus the Expo Student application under `mobile/`. The current persistence boundary is SQLite + Drizzle with runtime data under `PYTHAGORAS_DATA_DIR`; the current governance boundary is Change Sets, review, OWNER approval, and atomic publication. AI-M0 places future AI services behind those existing boundaries rather than replacing them.

## Document map

| Document | Responsibility |
| --- | --- |
| [AI-ARCHITECTURE.md](./AI-ARCHITECTURE.md) | System shape, trust boundaries, invariants, and production request flow |
| [AI-DOMAIN-CONTRACTS.md](./AI-DOMAIN-CONTRACTS.md) | Ownership and conceptual contracts for every AI domain |
| [AI-DATA-CLASSIFICATION.md](./AI-DATA-CLASSIFICATION.md) | Data classes, storage, privacy, retention, and de-identification rules |
| [AI-THREAT-MODEL.md](./AI-THREAT-MODEL.md) | Threats, controls, abuse boundaries, and security gates |
| [AI-ECONOMICS.md](./AI-ECONOMICS.md) | Cost centers, rate cards, reservations, settlement, and limits |
| [AI-RAG-AND-KNOWLEDGE.md](./AI-RAG-AND-KNOWLEDGE.md) | Knowledge Packages, publication, projections, retrieval, and evidence |
| [AI-EVALS-AND-IMPROVEMENT.md](./AI-EVALS-AND-IMPROVEMENT.md) | Eval gates, Agent 2, Second Brain, and improvement governance |
| [AI-MILESTONES.md](./AI-MILESTONES.md) | M0 definition of done and independently testable M1–M15 plan |

The existing platform references remain authoritative for current non-AI behavior:

- [project-context.md](../../project-context.md) — current repository and product context;
- [M1 local foundation](../content-system/m1-foundation.md), [M2 Admin identity](../content-system/m2-admin-identity.md), and [M3 Asset storage](../content-system/m3-asset-storage.md) — current persistence, identity, and asset boundaries;
- [Question Package V1](../question-system/question-package-v1.md) — current portable Question Package contract;
- [Rich Content boundaries](../../src/lib/rich-content/README.md) — current portable/canonical/public content separation.

## Normative language

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe the architecture locked by AI-M0. These documents are contracts for later implementation; they are not implementation instructions that authorize work in a future milestone.

## Review gate

AI-M0 is complete only when the documents are internally linked, the current-repository audit is recorded, and an independent review accepts the boundaries. Each later milestone is one coherent, independently testable commit and must be reviewed before the next milestone begins.
