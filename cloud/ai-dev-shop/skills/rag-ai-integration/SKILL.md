---
name: rag-ai-integration
version: 1.0.0
last_updated: 2026-02-26
description: Guidance for building RAG pipelines and LLM integration layers.
---

# Skill: RAG & AI Integration

RAG systems fail silently — they return plausible but wrong answers when retrieval quality degrades. This skill provides the architecture patterns, quality guardrails, and evaluation methods that prevent a RAG pipeline from becoming a confident hallucination generator.

## RAG Architecture Components

- **Document ingestion pipeline**: source → chunk → embed → store.
- **Retrieval pipeline**: query → embed query → similarity search → rerank → context assembly.
- **Generation**: assembled context + query → LLM → response.

## Chunking Strategies

- **Fixed-size**: simple, predictable, loses semantic boundaries — use only as baseline.
- **Sentence/paragraph-aware**: respects natural language boundaries — preferred for prose.
- **Semantic**: split on topic shifts — best quality, highest compute cost.
- **Chunk size guidance**: 256–512 tokens for factual retrieval, 512–1024 for narrative content.
- **Overlap**: 10–20% overlap between chunks to avoid cutting context at boundaries.
- Always store chunk metadata: source document ID, page/section, character offset.

## Vector Database Selection

- **pgvector (Postgres extension)**: suitable for < 1M vectors, existing Postgres infrastructure.
- **Pinecone / Weaviate / Qdrant**: suitable for > 1M vectors or when dedicated vector ops needed.
- **Supabase**: includes pgvector support — use when project already uses Supabase (see `<AI_DEV_SHOP_ROOT>/skills/supabase/SKILL.md`).
- **Index type**: HNSW preferred over IVFFlat for most use cases (better recall, slower build).

## Embedding Models

- Use the same model for ingestion and retrieval — never mix models.
- **Dimension size tradeoff**: larger = better quality, higher cost and storage.
- **Common choices**: OpenAI `text-embedding-3-small` (1536d, cost-effective), `text-embedding-3-large` (3072d, higher quality).
- Store the model name and version alongside embeddings — model changes require re-embedding.

## Retrieval Quality

- **Similarity threshold**: filter results below cosine similarity 0.7 — do not pass low-quality context to LLM.
- **Hybrid search**: combine vector similarity with keyword search (BM25) for better recall on specific terms.
- **Reranking**: use cross-encoder reranker on top-k results before passing to LLM (improves precision).
- **Retrieved context window**: stay within LLM context limit — prioritize highest-scoring chunks.

## LLM Integration Patterns

- **System prompt**: define role, output format, and constraints — keep stable across requests.
- **User prompt**: query + assembled context — clearly delimit context from query.
- Never inject unvalidated user input directly into system prompt (prompt injection risk — reference `<AI_DEV_SHOP_ROOT>/skills/security-review/SKILL.md`).
- **Temperature**: 0 for factual retrieval tasks, 0.3-0.7 for generative tasks.
- **Max tokens**: always set — never allow unbounded generation.

## Evaluation

- **Retrieval quality**: precision@k (are retrieved chunks relevant?), recall@k (are all relevant chunks retrieved?).
- **Generation quality**: faithfulness (does response contradict retrieved context?), answer relevance.
- Use LLM-as-judge for automated evaluation — reference `<AI_DEV_SHOP_ROOT>/skills/evaluation/eval-rubrics.md`.
- Establish baseline before tuning — cannot improve what you do not measure.
- For model routing, prompt versioning, fallback chains, and AI cost guardrails, pair this skill with `<AI_DEV_SHOP_ROOT>/skills/llm-operations/SKILL.md`.

## Cost Management

- Cache embedding results — same text should not be re-embedded.
- Cache LLM responses for identical query+context pairs (TTL based on content change frequency).
- Log token usage per request — set budget alerts.
- If the feature depends on multiple providers or needs runtime budget enforcement, use `<AI_DEV_SHOP_ROOT>/skills/llm-operations/SKILL.md` instead of inventing ad hoc retry and fallback rules.
