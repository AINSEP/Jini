# Serverless Architecture

## What It Is

Build systems from managed compute and services (functions, queues, managed databases) with on-demand execution. You define event handlers; the cloud provider manages scaling, servers, and runtime lifecycle.

The key inversion: you stop thinking about "servers that handle requests" and start thinking about "events and responses." Every function is stateless by design. The state lives in managed storage between invocations, not in memory. This forces good practices but punishes patterns that assume persistent in-process state.

## When to Use

- Variable or bursty traffic where predictable scaling without over-provisioning matters
- Event-driven workloads: file uploads, queue processing, webhooks, scheduled jobs
- Small teams minimizing ops overhead — no servers to patch, no clusters to manage
- Independent functions with infrequent invocations where pay-per-use economics are favorable
- Rapid prototyping or isolated features where a full deployment pipeline is overhead

## When NOT to Use

- Long-running processing (>15 minutes) — Lambda hard limits, Step Functions add overhead; use containers or a job runner instead
- Team with limited cloud operations experience — serverless debugging toolchain (distributed traces, cold start profiling, IAM debugging) is harder than traditional app debugging
- Tightly coupled synchronous workflows where function A calls function B calls function C — cold starts compound, latency spikes unpredictably; a long-lived service handles this better
- Cost-sensitive workloads with predictable, consistent high throughput — at sustained load, reserved EC2 or containers are significantly cheaper than per-invocation billing

## Decision Signals

| Signal | Serverless | Container/Server |
|--------|------------|-----------------|
| Traffic pattern | Bursty, variable, or infrequent | Steady, predictable |
| Execution duration | < 15 minutes per invocation | Long-running or unbounded |
| State requirements | Stateless OK, external state | In-process state or streaming |
| Ops preference | Minimize infra management | Full control over runtime |
| Cost model | Pay-per-invocation | Reserved capacity |
| Debugging maturity | Team comfortable with distributed tracing | Team prefers traditional logging |

## TypeScript Implementation

```typescript
// Lambda handler — keep thin; heavy init outside the handler for warm reuse
import { SQSEvent, SQSHandler, SQSBatchResponse } from 'aws-lambda'
import { DocumentProcessor } from './document-processor'

// Module-level init: runs once per container, reused across warm invocations
const processor = new DocumentProcessor()

export const handler: SQSHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = []

  for (const record of event.Records) {
    try {
      const payload = JSON.parse(record.body) as ProcessDocumentCommand

      // Idempotency check — SQS delivers at-least-once
      const alreadyProcessed = await isAlreadyProcessed(payload.documentId)
      if (alreadyProcessed) continue  // safe to skip, already done

      await processor.process(payload)
      await markProcessed(payload.documentId)

    } catch (err) {
      // Return failed message IDs — SQS will retry or DLQ them
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }

  return { batchItemFailures }
}

// Idempotency store — DynamoDB conditional write pattern
async function markProcessed(documentId: string): Promise<void> {
  await dynamo.put({
    TableName: IDEMPOTENCY_TABLE,
    Item: { pk: documentId, processedAt: new Date().toISOString() },
    ConditionExpression: 'attribute_not_exists(pk)'  // fails if already exists
  }).catch(err => {
    if (err.name === 'ConditionalCheckFailedException') return  // already processed, fine
    throw err
  })
}

// Environment-driven config — no hardcoded resource names
interface Config {
  queueUrl: string
  bucketName: string
  idempotencyTable: string
}
export const config: Config = {
  queueUrl: process.env.QUEUE_URL!,
  bucketName: process.env.BUCKET_NAME!,
  idempotencyTable: process.env.IDEMPOTENCY_TABLE!,
}
// Validate at cold start so misconfiguration fails fast
for (const [key, val] of Object.entries(config)) {
  if (!val) throw new Error(`Missing required env var for: ${key}`)
}
```

## Testing Strategy

- **Function unit tests with mocked cloud SDKs**: inject mock AWS SDK clients; test handler logic, idempotency branching, and error paths without network calls
- **Integration tests in staging cloud environment**: deploy to a real cloud account with test resources; SQS → Lambda → DynamoDB paths must be validated end-to-end
- **Idempotency and retry tests**: send the same event twice; assert exactly one record written. Test DLQ routing by sending a malformed payload

## Common Failure Modes

**Non-idempotent handlers causing duplicated work**: SQS delivers at-least-once. If the handler creates a DB record without checking, duplicate events create duplicate records. Fix: implement idempotency keys (DynamoDB conditional write, Redis SETNX, or a dedup table) checked before any write operation.

**Hidden cold start latency in critical paths**: VPC-attached Lambda with no warm-up causes 2–4 second first-request latency. Acceptable for background processing; unacceptable for user-facing APIs. Fix: provisioned concurrency for latency-sensitive functions; move VPC attachment out of the Lambda if the VPC resource (RDS) can use a proxy or Data API instead.

**Fan-out cost explosion**: One S3 upload triggers a Lambda that creates 50 SQS messages, each triggering another Lambda. At 10K uploads/day that's 500K invocations/day. Fix: model the fan-out intentionally — use batch processing (process N records per invocation), set explicit concurrency limits, alert on invocation count anomalies.

**State in function memory between invocations**: A module-level cache fills with data from invocation A and is read in invocation B running on a different container — state is inconsistent. Or worse: the cache grows unbounded across warm invocations, causing OOM. Fix: treat all in-process state as non-durable and instance-specific. External shared state lives in Redis, DynamoDB, or S3 only.

**Distributed tracing gaps making failures invisible**: Step Functions shows "state failed" but no structured log tells you which document ID, which error type, or what the input was. Fix: structured JSON logging with correlation IDs (`{ level, message, documentId, traceId, error }`) from the first day. Integrate AWS X-Ray or equivalent; a trace without context makes on-call debugging significantly harder.

## Pairs Well With

- **Event-Driven Architecture** — functions ARE event consumers; SNS/SQS/EventBridge are the event bus; pairs naturally for async side effects
- **Pipeline/Batch Architecture** — orchestrate pipeline stages as Lambda functions composed with Step Functions; each stage is a serverless function with checkpointing
- **CQRS** — separate Lambda handlers for commands (write path) and queries (read path); query Lambdas can read from read-optimized projections without touching the write store
- **Repository Pattern** — abstract managed storage (S3, DynamoDB, RDS) behind repository interfaces; swap implementations between prod (real AWS) and test (in-memory or localstack)
