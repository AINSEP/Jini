# Pipeline / Batch Architecture

## What It Is

Process data in staged pipelines (extract, transform, validate, load/evaluate), often for analytics, AI training, ETL, or offline jobs. Each stage accepts a well-defined input schema, applies a transformation, and emits a well-defined output schema. The contract between stages is the data shape, not function calls.

The key constraint: stages are isolated units. A stage must not depend on the in-memory state of another stage — all inter-stage communication goes through durable, versioned artifacts (files, tables, object storage). This makes pipelines reproducible, restartable from any checkpoint, and independently testable.

## When to Use

- Large dataset processing: ETL, ML training data preparation, feature engineering
- Scheduled jobs: nightly reporting, data aggregation, batch invoicing
- Workloads tolerant to delayed completion (seconds to hours)
- Workflows needing reproducibility — same input must produce same output on replay
- Offline AI/ML pipelines: data cleaning, instruction generation, dataset publishing

## When NOT to Use

- Interactive, low-latency user-facing requests — even a 2-second pipeline stage is unacceptable for a UI action; use request/response services instead
- Simple one-step transforms where pipeline scaffolding adds overhead without value — a cron job calling one function may be simpler
- Real-time sub-second streaming with event-per-event processing — use stream processing (Kafka Streams, Flink, Spark Streaming) not batch stages
- When the orchestration cost (managing stage dependencies, artifact storage, retry logic) exceeds the complexity of the actual workload — don't introduce pipeline infrastructure for a 20-line script

## Decision Signals

| Signal | Pipeline/Batch | Stream Processing |
|--------|----------------|-------------------|
| Latency tolerance | Minutes to hours | Sub-second |
| Data arrival | Bounded datasets or scheduled | Continuous unbounded stream |
| Reproducibility | Required — replay support needed | Often best-effort |
| Processing unit | Dataset or file | Individual event |
| Orchestration | DAG scheduler (Prefect, Airflow) | Stream processor (Flink, Kafka) |
| Cost model | Run-on-schedule | Always-on |

## TypeScript Implementation

```typescript
// Stage type contract — every stage has the same shape
interface PipelineStage<TInput, TOutput> {
  name: string
  validate(input: TInput): Promise<ValidationResult>
  transform(input: TInput, ctx: RunContext): Promise<TOutput>
}

interface RunContext {
  runId: string          // unique per pipeline execution — makes transforms reproducible
  executedAt: string     // ISO timestamp passed in, not generated inside stages
  checkpointDir: string  // where to write stage artifacts
}

// Stage 1: Ingest
const ingestStage: PipelineStage<RawDocumentBatch, CleanedDocumentBatch> = {
  name: 'ingest',

  async validate(input) {
    const errors: string[] = []
    if (!input.documents.length) errors.push('Empty document batch')
    return { valid: errors.length === 0, errors }
  },

  async transform(input, ctx) {
    const cleaned = input.documents.map(doc => ({
      id: doc.id,
      content: doc.content.trim().replace(/\s+/g, ' '),
      source: doc.source,
      ingestedAt: ctx.executedAt,  // deterministic — same runId = same timestamp
    }))
    // Write artifact so pipeline can resume here if later stages fail
    await writeArtifact(ctx.checkpointDir, ctx.runId, 'ingest', cleaned)
    return { documents: cleaned }
  }
}

// Stage 2: Validate quality
const qualityStage: PipelineStage<CleanedDocumentBatch, ValidatedDocumentBatch> = {
  name: 'quality',

  async validate(input) {
    return { valid: input.documents.length > 0, errors: [] }
  },

  async transform(input, ctx) {
    const valid: CleanedDocument[] = []
    const rejected: { doc: CleanedDocument; reason: string }[] = []

    for (const doc of input.documents) {
      if (doc.content.length < 50) {
        rejected.push({ doc, reason: 'content too short' })
      } else {
        valid.push(doc)
      }
    }

    // Dead-letter store — rejected records are NOT silently discarded
    if (rejected.length > 0) {
      await writeArtifact(ctx.checkpointDir, ctx.runId, 'quality-rejected', rejected)
    }

    await writeArtifact(ctx.checkpointDir, ctx.runId, 'quality', { documents: valid })
    return { documents: valid, rejectedCount: rejected.length }
  }
}

// Pipeline runner — compose stages, checkpoint between each, support resume
async function runPipeline(
  initialInput: RawDocumentBatch,
  ctx: RunContext
): Promise<PipelineResult> {
  const stages = [ingestStage, qualityStage /*, more stages */]
  let currentData: unknown = initialInput

  for (const stage of stages) {
    // Resume from checkpoint if this stage already completed in a previous attempt
    const existing = await loadArtifact(ctx.checkpointDir, ctx.runId, stage.name)
    if (existing) {
      currentData = existing
      continue  // skip — already done
    }

    const validation = await stage.validate(currentData as never)
    if (!validation.valid) {
      throw new PipelineStageError(stage.name, validation.errors)
    }

    currentData = await stage.transform(currentData as never, ctx)
  }

  return { runId: ctx.runId, output: currentData }
}
```

## Testing Strategy

- **Stage unit tests**: test each stage's `transform` function with fixed inputs and a deterministic `RunContext` (fixed `runId`, `executedAt`); assert output shape and values exactly
- **Data quality assertion tests**: test the `validate` function with boundary inputs (empty batch, oversized documents, malformed schemas)
- **Reproducibility tests**: run the same stage twice with identical `RunContext`; assert byte-identical artifact output — catches hidden non-determinism (random IDs, `new Date()` calls, non-stable sort)
- **Resume tests**: write a checkpoint artifact for stage N, run the pipeline, verify stage N is skipped and the existing artifact is used

## Common Failure Modes

**Silent schema drift between stages**: Stage 2 adds a new required field to its output. Stage 3 was written before that field existed and never reads it — the field silently drops from the final artifact. Fix: define explicit TypeScript types for each stage's input/output contract and validate schemas at stage boundaries using Zod or similar before processing begins.

**Non-deterministic transforms producing irreproducible outputs**: Stage calls `new Date()` or `crypto.randomUUID()` inside the transform. Replaying the pipeline with the same input produces different output — makes debugging and regression testing impossible. Fix: pass `runId` and `executedAt` in `RunContext`; all deterministic identifiers derive from the context, never from internal calls.

**No checkpointing — full restart on partial failure**: A 6-hour pipeline fails at stage 5, restarts from stage 1, wastes 4 hours. Fix: write a versioned artifact after every stage completes. The pipeline runner checks for an existing artifact before executing a stage — skip if already complete. Artifacts are keyed by `(runId, stageName)`.

**Unbounded memory accumulation in large dataset stages**: Stage loads the entire 50GB dataset into an array before processing. Works in dev with 100 records, crashes in prod. Fix: use streaming transforms that operate on chunks (async generators, streams, batch cursors). Never buffer an entire dataset in memory unless the dataset is explicitly bounded and size-validated.

**Failed records silently discarded**: Quality validation rejects 12% of records with no trace. The final dataset is unexpectedly small but no alert fires. Fix: every rejected record goes to a dead-letter artifact (`quality-rejected`, `validation-rejected`) with the original record, the failing stage name, and the rejection reason. Pipeline metrics always report `(processed, rejected, failed)` counts — never just `processed`.

## Pairs Well With

- **Serverless Architecture** — orchestrate pipeline stages as Lambda functions composed with Step Functions or EventBridge Pipes; each stage is a serverless function with artifact checkpointing
- **Event-Driven Architecture** — trigger pipeline runs from domain events (e.g., "dataset uploaded" → pipeline starts); pipeline completion events notify downstream consumers
- **Repository Pattern** — abstract stage artifact storage (S3, GCS, local filesystem) behind a storage interface; swap implementations between prod (object storage) and test (in-memory or temp directory)
- **CQRS** — use pipelines to build read-model projections from an event store; the pipeline IS the projection builder, running offline against the full event log
