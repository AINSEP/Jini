Spec ID: SPEC-JINI-ANALYTICS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:f1dfae6ea4baa896b57f440933750c56095469193644930455457c8e5972d1d7
spec_mode: reverse_spec

# API Contract: @jini-ai/analytics

Node ESM, sole public entry `.`. Source: `src/index.ts`, `types.ts`, `ports.ts`, `salt.ts`, `ingest.ts`, and `repo.memory.ts`. This package owns ingestion and sink contracts; rollup/query types do not imply an implemented reporting service.


| Export | Current signature / return |
|---|---|
| `deriveDailySalt` | `(required: DailySaltRequired): Buffer` |
| `createNodeAnalyticsHash` | `({}): AnalyticsHashPort` |
| `validateEventProps` | `({ props: JsonObject | null | undefined, privacyPolicy: AnalyticsPrivacyPolicy }): JsonObject | null` |
| `normalizeIngestContext` | `({ input: CoarseIngestInput, dailySalt: Buffer }, { hash?: AnalyticsHashPort } = {}): NormalizedIngestContext` |
| `ingestHit` | `(required: IngestHitRequired, optional: IngestHitOptional = {}): Promise<IngestHitResult>` |
| `new LocalBufferSink` | `({}, { initialHits?: readonly NormalizedHit[] } = {})` |

`DailySaltRequired` supplies rootKeySeed/workspaceId/utcDate/saltContext. `AnalyticsSaltContext` supplies extractionSalt and infoPrefix; the consumer owns both. Hash port provides sha256({ parts }) and deriveDailySalt(required). Coarse input is ip/userAgent/siteHost; normalized context returns visitorHash/deviceClass/browserFamily/osFamily. Privacy policy requires maxEventPropCount/maxEventPropStringLength/sessionWindowMinutes.

`IngestHitRequired` is `{ input: RawHitInput, deps: IngestHitDeps }`. Raw input is beacon `{ host, path, referrer, kind, eventName?, eventProps?, dnt?, gpc? }` and context `{ ip, userAgent, acceptLanguage, receivedAt }`. Dependencies require sink/config/resolveWorkspaceForHost/rootKeySeed/saltContext/privacyPolicy. `ResolveWorkspaceForHost({ host }): UUID | null | Promise<UUID | null>` is the resolver type. `IngestDeps` holds sink/config; `AnalyticsHooks.beforeIngest({ hit })` returns a transformed hit or null; optional hash replaces hashing. Result has accepted and optional IngestDropReason.

`AnalyticsConfigPort.get({ workspaceId }): Promise<AnalyticsSiteConfig>` supplies enabled/honorDoNotTrack/honorGlobalPrivacyControl/rawRetentionDays/excludedPaths/excludedIpRanges/sink/workspaceId. `AnalyticsSinkPort.capabilities({}): AnalyticsSinkCapabilities`, accept({ hit })/acceptBatch({ hits }): Promise<void>, list({}, { limit? }?): Promise<NormalizedHit[]>. LocalBufferSink also exposes all({}): NormalizedHit[]. Capabilities are durable false and batch true.

Primitive aliases UUID, ISODateTime and JsonValue/JsonObject come from core/primitives. Analytics exports AnalyticsPrivacyPolicy, HitKind, DeviceClass, AnalyticsGranularity, DimensionName, MetricName, AnalyticsPermission, AnalyticsSinkKind, VisitorSketch, UtmParams, IngestBeacon/Context, NormalizedHit, AnalyticsEventRow, AnalyticsAggregateRow, AnalyticsSessionRow, AnalyticsGoalDef, AnalyticsSiteConfig, DimensionOverflowValue, StatsFilter, StatsQuery, TimeSeriesPoint, BreakdownRow, StatsResult, RealtimeSnapshot, AnalyticsDomainEventName, AnalyticsDomainEventPayloads, RollupCompletedPayload, GoalTriggeredPayload; plus sink/config/hooks/dependencies, salt/hash, and ingest input/result types above. These row/stat/goal/event types do not imply implemented rollup, querying, retention, or goal evaluation. `AnalyticsPiiRejectedError` is exported.

```ts
import { ingestHit, LocalBufferSink } from '@jini-ai/analytics';
const sink = new LocalBufferSink({}, {});
const result = await ingestHit({ input: { beacon, context }, deps: {
  sink, config: hostAnalyticsConfig, resolveWorkspaceForHost: hostWorkspaceResolver,
  rootKeySeed: credentials.analyticsSeed, saltContext: { extractionSalt: 'consumer-v1', infoPrefix: 'traffic:' },
  privacyPolicy: { maxEventPropCount: 20, maxEventPropStringLength: 200, sessionWindowMinutes: 30 }
} }, {});
```


## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `IngestContext` | interface; [types.ts](../../src/types.ts) |

## Current manifest boundary

The current `package.json` exposes `.`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
