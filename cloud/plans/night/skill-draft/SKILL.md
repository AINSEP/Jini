---
name: memory-performance-discipline
version: 0.1.0
last_updated: 2026-11-04
description: Use when designing, implementing, or reviewing polling, checkpointing, large payloads, caches, retained history, background lifecycles, or memory/performance fixes. Make recurring cost and retention bounds explicit and verify claimed savings on the real execution path.
---

# Skill: Memory & Performance Discipline

**DRAFT — not installed.** Evidence: [incident ledger](evidence.md); proposed persona wiring: [Cost contracts](persona-snippets.md).

## Ownership and scope

Software Architect defines resource bounds and durability tradeoffs; Programmer implements and reports cost; Code Inspection checks the actual path and evidence. Complement `coding-foundations` and `implementation-guardrails`; use `performance-engineering` for load/latency validation. Keep existing owners and injected ports; a performance fix does not justify a new framework or weaker correctness.
Apply the relevant rules to changed paths. Examples below are schematic TypeScript/SQL, not new APIs. Evidence IDs identify inspected incidents; numeric thresholds are local examples, not universal defaults.

## Rules and review signals

### 1. Calculate recurring work before optimizing it — E1

**Rule:** Model rate × payload × copies/scans × concurrent consumers, plus retained state. Define each variable; include read, serialization, bound-parameter and write costs separately. Growing snapshots can make cumulative work quadratic.
**Bad:** `cost = "O(n)"; // one tick` → **Good:** `cost = { ticksPerSecond, bytesPerTick, copiesPerTick, activeConsumers, retainedBytes };`
**Detect:** Enumerate timer, poll, focus-refresh and completion triggers; multiply worst supported sizes and concurrency. Ask what still happens when nothing changed.

### 2. Read the smallest projection that answers the question — E2

**Rule:** Poll a scoped message/cursor, list metadata, fetch bodies on detail, and use existence/aggregate queries for predicates or sequence numbers. Never read whole history on a recurring path just to extract one value; use bounded pages when history itself is required.
**Bad:** `Math.max(...(await repo.listRevisions({ id }, {})).map(r => r.seq))` → **Good:** `await repo.maxRevisionSeq({ id }, {});`
**Detect:** Trace repository calls through projections to serialization. Check that list responses exclude unused bodies and predicates cover matches beyond the first page; response size alone does not prove cheap storage access.

### 3. Avoid full JSON round trips on recurring paths — E3

**Rule:** Check a cheap validator before reading payloads; use validated stored JSON or deltas where contracts permit. Stream large required responses with backpressure. Guard delta writes and retain an authoritative merge fallback, replay/barrier ordering and terminal fencing; move their why-comments with the implementation.
**Bad:** `res.json({ events: JSON.parse(row.events_json) }); // every poll` → **Good:** `if (unchanged) return res.status(304).end(); return pipeValidatedJson({ source, res }, {});`
**Detect:** Count full parses, stringifies, copies and SQL parameters on changed AND unchanged paths. Test text-tail growth, Unicode, concurrent appends and equal-length replacements; SQL TEXT splicing can still rewrite the full row/WAL.

### 4. Prove the physical query is bounded — E4

**Rule:** `LIMIT 1` bounds output, not search work. Use a suitable index/projection for recurring predicates; check the no-match case. Deliver indexes through normal migrations and fresh bootstrap; account for one-time build I/O and write blocking.
**Bad:** `SELECT id FROM messages WHERE status='running' LIMIT 1; -- no usable index` → **Good:** `CREATE INDEX active_messages ON messages(status,id) WHERE status='running'; -- matching probe`
**Detect:** Inspect real-engine query plans on fresh and migrated databases, including many terminal rows with large payloads. Confirm index predicates match the query; avoid inferring disk work from selected columns.

### 5. Validate cache usefulness as well as correctness — E5

**Rule:** Name key, invalidation scope, owner/lifetime and fallback. Publish persistence receipts after commit. A conservative global version can be correct yet invalidate on every unrelated write; measure hit/fallback rates with concurrent consumers before claiming savings.
**Bad:** `cache.set(key, receipt); await transaction.commit();` → **Good:** `await transaction.commit(); cache.set(key, receipt); // validated owner still live`
**Detect:** Exercise rollback, another row's write, equal-length replacement, process/kernel replacement and late completion. Check retained bytes and invalidation frequency, not just cache-hit unit tests.

### 6. Schedule progress; do not create self-sustaining retries — E6

**Rule:** Coalesce to one pending write and one trailing timer per owner; scale cadence to payload and the allowed crash-loss window. Successful/unchanged completion needs newer progress to reschedule. Retry retryable storage failures during quiet waits with a positive minimum delay and explicit retry/stop policy. Stop scheduling and clear timers before awaiting teardown; late promises cannot revive retired owners. Terminal persistence bypasses throttling.
**Bad:** `save().finally(() => checkpoint());` → **Good:** `save().catch(scheduleBackedOffRetry).finally(() => { if (!stopped && newerProgress) scheduleTrailing(); });`
**Detect:** Fake-clock/deferred-promise cases: zero interval, false write result, quiet failed save, skipped final frame, cancellation, settlement and completion after cleanup. Assert write counts, live timers and durable final state.

### 7. Reclaim resources only when their owner proves idle — E7

**Rule:** Count background work after HTTP completion; release request holds exactly once on finish OR close. Recheck synchronous activity after async probes and fence intake without yielding before graceful stop. Unknown/busy defers reclamation. Share existing samplers/control channels and cancel restart timers on Stop/delete/quit.
**Bad:** `if (requests === 0) stop();` → **Good:** `if (await hasDurableOrBackgroundWork({}, {})) return; if (hasLiveHolds()) return; fenced = true; gracefulStop();`
**Detect:** Race new work against the probe; close SSE/abort a request; keep publish/export/upload/send jobs active after their response. Check both no mid-work shutdown and eventual sleep; test late old-process exits cannot remove replacement bindings.

### 8. Give retained stores explicit capacity and loss policies — E8

**Rule:** Define count/byte/age bounds as appropriate, cleanup owner and overflow behavior for caches, log tails, job results and revisions. Count caps do not bound bytes when entries are unbounded. Durable revisions require an explicit retention/deletion contract; reject/defer new work at capacity if deletion is not authorized. Do not silently discard saved work to meet a budget.
**Bad:** `revisions.push(fullFile); // forever` → **Good:** `await revisions.admit({ fileBytes }, { retentionPolicy, onCapacity: "refuse" });`
**Detect:** Project edits × file size × retention duration; exceed capacity and inject cleanup failure. Verify active jobs, sibling files and manual trash survive eviction, and user-facing reversibility promises match retention.

### 9. Include scanning and buffering CPU in the cost — E9

**Rule:** Avoid rescanning growing prefixes or regex suffixes at every possible start. Bound stream carry and define overflow behavior; sanitize before retention/delivery. Use an existing scanner/buffer owner and preserve its security semantics.
**Bad:** `text.replace(/\b[\w.+-]+@(?:[\w-]+\.)+[A-Za-z]{2,}\b/g, mask);` → **Good:** `redactWithForwardScanner({ text }, { maxLocalPart: 64 }); // seek @, inspect bounded local part`
**Detect:** Probe long nonmatches, repeated labels, unterminated markers, split secrets and oversized lines at increasing sizes. Check scaling and output parity; a byte cap alone does not prove linear CPU.

### 10. Label memory metrics and separate churn from retention — E10

**Rule:** Report RSS/resident, heap-used, native/external allocation and OS footprint separately, with units, PID scope and sampling method. Sample natural peaks and post-idle recovery; forced GC is supplementary. RSS can count shared pages in multiple processes; reserved virtual space is not physical use. A sawtooth alone does not establish a leak.
**Bad:** `memorySaved = oldRss - newFootprint;` → **Good:** `report({ metric: "rss", unit: "MiB", pids, baseline, peak, postIdle, runtime, flags }, {});`
**Detect:** Compare the same metric, workload, runtime and process ownership before/after. Preserve unavailable samples as unknown; do not report missing data as zero or sums of RSS as unique physical consumption.

### 11. Verify budgets on the production mechanism before release — E11

**Rule:** For a performance fix or material new recurring cost, define the supported workload and acceptance budget before implementation, then run the existing harness on baseline and changed artifacts. Include large payloads, concurrent writers, quiet waits, reconnect and terminal completeness where relevant; measure latency/CPU tradeoffs for runtime flags. Deterministic timer/query tests complement process measurements.
**Bad:** `await rewriteMessageTwentyTimes(); // proves finalizer savings` → **Good:** `await budgetRun({ artifact, path: "production-finalizer", workload, budgets }, {});`
**Detect:** Trace the harness to the real production owner and consumed dependency build. Require complete samples, natural peak/growth, correctness and failure-on-overrun evidence; green unit tests or an unrun harness do not establish the memory budget.

## Output expectations

Emit one `Cost:` line per materially affected recurring/retained path (or `Cost: N/A — <reason>`). Include trigger/rate × payload/work × concurrency; retained-state bound; durability/latency tradeoff; evidence and budget status: **ESTIMATED / MEASURED / UNVERIFIED**. Name remaining full-work fallbacks and the next validation needed. Use existing review severity rules; this skill introduces no numeric gate or approval requirement.
