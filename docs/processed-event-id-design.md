# Processed Event ID Design

## 1. Problem

Event Recovery will process external `RuntimeEvent` values. `RuntimeEvent` already has an `id`, but the runtime does not currently record which events have been processed.

`matchWaitingRuns` and `previewEventRecovery` are read-only and do not need processed event id storage. The current match/preview-only `recoverWaitingRuns` writes observe-by-default processed event attempts when `ProcessedEventStore` is available and can explicitly skip completed processed event records with `duplicatePolicy: "skip-completed"`. Future retry-failed / stale-started policies or a `recoverAndTick` API may execute `tick`, and then repeated events could repeat recovery work.

Without processed event id records, the runtime cannot distinguish a first event, a duplicate event, or a retry after failure.

## 2. Goals

Processed Event ID should:

- Define a processed event id index.
- Record event recovery attempts.
- Provide idempotency groundwork for future `recoverWaitingRuns` and explicit tick recovery.
- Support querying whether an event has been processed.
- Remain an optional StateStore extension.
- Avoid claiming exactly-once behavior.
- Avoid automatically dropping events unless the host explicitly chooses a policy.
- Leave current `matchWaitingRuns` and `previewEventRecovery` behavior unchanged.

## 3. Non-Goals

This design does not implement:

- Exactly-once guarantee.
- Distributed deduplication.
- External event bus.
- Background worker.
- Durable recovery guarantee.
- Automatic retry scheduler.
- Transactional event processing.
- Trigger execution.

## 4. Current Event Recovery State

Current implementation:

- `RuntimeEvent` has `id` and `name`.
- `matchWaitingRuns(event)` matches by `event.name` / `waitReason`.
- `previewEventRecovery(event)` restores matched FlowRuns for preview.
- `recoverWaitingRuns(event)` currently returns preview results and records observe-by-default processed event attempts when supported.
- ActionFlowRuntime exposes explicit processed event accessors.
- `matchWaitingRuns` and `previewEventRecovery` do not mutate event state or record processed ids.
- `recoverWaitingRuns` records observe-only `started`, `completed`, and `failed` attempts when supported and can explicitly skip completed processed event records.
- These match/preview methods do not tick.

## 5. Proposed Data Model

Candidate structure:

```ts
interface ProcessedEventRecord {
  eventId: string;
  eventName: string;
  status: "started" | "completed" | "failed";
  firstSeenAt: string;
  updatedAt: string;
  attemptCount: number;
  matchedRunIds: string[];
  recoveredFlowRunIds: string[];
  error?: string;
}
```

- `eventId` comes from `RuntimeEvent.id`.
- `eventName` comes from `RuntimeEvent.name`.
- `status` describes a runtime recovery attempt, not business success.
- `attemptCount` records how many attempts have been made.
- `matchedRunIds` and `recoveredFlowRunIds` are diagnostic fields.
- Full event payload should not be stored by default, to avoid privacy and size issues.
- A payload hash can be a future extension, but is not required for the first version.

## 6. Proposed Store Extension

Current optional interface:

```ts
interface ProcessedEventStore extends StateStore {
  getProcessedEvent(eventId: string): ProcessedEventRecord | undefined;
  saveProcessedEvent(record: ProcessedEventRecord): void;
  listProcessedEvents(): readonly ProcessedEventRecord[];
  deleteProcessedEvent(eventId: string): boolean;
}
```

`ProcessedEventRecord`, `ProcessedEventStore`, and `supportsProcessedEvents(store)` are implemented. MemoryStateStore and FileStateStore processed event id storage are implemented.

This extension is optional and does not enter the base `StateStore` interface. Runtime can detect support. Stores that do not support it keep current behavior.

Runtime explicit processed event store accessors are implemented. `recoverWaitingRuns` writes observe-by-default `started`, `completed`, and `failed` records when `ProcessedEventStore` is available. `matchWaitingRuns` and `previewEventRecovery` do not write processed event records. The explicit `skip-completed` duplicate policy is implemented on `recoverWaitingRuns`. Retry-failed policy, stale-started policy, exactly-once behavior, and durable recovery remain future work.

MemoryStateStore uses in-memory records. FileStateStore writes local JSON records under `processed-events/{safeEventId}.json`.

## 7. Status Semantics

Statuses:

- `started`: recovery attempt began but did not complete.
- `completed`: recovery attempt completed according to the selected strategy.
- `failed`: recovery attempt ended with an error.

Important limits:

- `completed` does not equal business success.
- `failed` does not necessarily mean the event cannot be retried.
- `started` may be a leftover from a crash.
- Status must not be treated as exactly-once proof.

## 8. Event Handling Policy Options

### Policy A: Observe only

- Record attempts only.
- Do not block duplicate events.
- Lowest risk.

### Policy B: Skip completed

- If `eventId` is already `completed`, skip later recovery attempts.
- Simple idempotency behavior.
- May block legitimate replay.

### Policy C: Allow retry failed

- Skip `completed`.
- Allow retry for `failed`.
- Needs a policy for `started`: in progress or stale.

### Policy D: Always run but record attempts

- No deduplication.
- Provides audit records only.
- Riskier for side-effect-heavy actions.

Recommendation:

- Default behavior remains Observe only.
- `skip-completed` is implemented as an explicit `recoverWaitingRuns` option.
- Default behavior should not silently discard events.
- Exactly-once must not be claimed.

See [Duplicate Event Skip Policy](duplicate-event-skip-policy.md) for the explicit skip-completed policy. Exactly-once behavior is not implemented.

## 9. Runtime Integration Sketch

Current Runtime integration exposes explicit processed event accessors when the configured store supports `ProcessedEventStore`:

- `getProcessedEvent(eventId)`
- `saveProcessedEvent(record)`
- `listProcessedEvents()`
- `deleteProcessedEvent(eventId)`

These accessors do not imply automatic idempotency. They do not change `matchWaitingRuns` or `previewEventRecovery`.

Current `recoverWaitingRuns` observe-only wiring:

1. Validate `RuntimeEvent`.
2. Check processed event store if supported.
3. Create or update `ProcessedEventRecord` with `status: "started"`.
4. Match waiting runs and preview recovery records.
5. Save `completed` or `failed` record.

Current `skip-completed` policy:

1. Read processed event records before recovery.
2. Skip only when an existing processed event record is `completed`.
3. Return `eventSkipped`.
4. Do not mutate the existing completed record.

Future retry-failed or stale-started policies can add more behavior later.

Current `matchWaitingRuns` and `previewEventRecovery` do not write processed event records. Current `recoverWaitingRuns` writes observe-by-default records and can explicitly skip duplicate completed events. Exactly-once remains unimplemented.

## 10. FileStateStore Layout

Current layout:

```text
.actionflow/
  processed-events/
    {safeEventId}.json
```

Rules:

- Use `safeFileName`.
- Use JSON-compatible checks.
- Corrupted or invalid records throw during reads and lists.
- `clear()` removes `processed-events`.
- FileStateStore does not provide multi-process safety.
- FileStateStore does not guarantee exactly-once behavior.

## 11. MemoryStateStore Behavior

Current MemoryStateStore behavior:

- Stores processed event records in memory.
- `saveProcessedEvent` overwrites the same event id.
- `listProcessedEvents` returns records sorted by `eventId`.
- `deleteProcessedEvent` deletes a record.
- `clear` removes processed event records.

## 12. Relationship With Waiting Index

Waiting Index finds waiting runs. Processed Event ID records event recovery attempts.

They are complementary indexes, not the same data:

- Waiting index staleness should not be automatically repaired by processed event id logic.
- Processed event id cannot prove a waiting run completed.
- A processed event record can reference matched or recovered run ids for diagnostics.

See [Stale Waiting Index Health Design](stale-waiting-index-health-design.md) for the proposed waiting index consistency checks. Processed event records cannot automatically repair waiting index entries.

## 13. Relationship With EventTriggerRegistry

Processed event id may eventually apply to both:

- Start-flow trigger handling.
- Waiting-run recovery.

Those paths must still be designed separately. If one event can both start a flow and recover a waiting run, the processed event record should either include separate sub-results or define its scope clearly.

`EventTriggerRegistry` still does not execute automatically.

## 14. Health Check Relationship

Future `checkHealth` could report:

- `started` event records older than a threshold.
- `failed` event records.
- Processed event records with missing referenced runs.

`checkHealth` should stay read-only. Cleanup should be an explicit API. Waiting index consistency checks are designed separately in [Stale Waiting Index Health Design](stale-waiting-index-health-design.md) and are not implemented.

## 15. Tests Needed If Implemented

Implemented tests currently cover:

- MemoryStateStore saves processed event record.
- MemoryStateStore overwrites same event id.
- MemoryStateStore lists processed events sorted by eventId.
- MemoryStateStore deletes processed event records.
- MemoryStateStore clear removes processed events.
- MemoryStateStore validates eventId.
- MemoryStateStore validates eventName.
- MemoryStateStore validates status.
- MemoryStateStore validates firstSeenAt and updatedAt.
- MemoryStateStore validates attemptCount.
- MemoryStateStore validates matchedRunIds.
- MemoryStateStore validates recoveredFlowRunIds.
- MemoryStateStore validates optional error field.
- supportsProcessedEvents detects MemoryStateStore and compatible stores.
- FileStateStore writes processed event JSON.
- FileStateStore lists processed events deterministically.
- FileStateStore rejects invalid processed event JSON.
- FileStateStore clear removes processed events.
- FileStateStore deletes processed event records.
- FileStateStore supports unsafe event ids through safe file names.
- FileStateStore processed event storage does not affect matchWaitingRuns or previewEventRecovery.
- supportsProcessedEvents detects FileStateStore.
- Runtime explicit processed event accessors.
- Runtime processed event accessors do not affect matchWaitingRuns or previewEventRecovery.
- recoverWaitingRuns records started and completed processed event attempts.
- recoverWaitingRuns records failed processed event attempts.
- recoverWaitingRuns increments attemptCount for repeated event ids.
- recoverWaitingRuns preserves firstSeenAt for repeated event ids.
- recoverWaitingRuns defaults to observe behavior for duplicate completed events.
- recoverWaitingRuns supports explicit skip-completed duplicate policy.

Remaining future tests should cover:

- Retry-failed and stale-started policies once designed.
- EventTriggerRegistry event handling records trigger-path results once designed.
- Exactly-once behavior is not claimed.

## 16. Open Questions

- Should the default policy be observe only or skip completed?
- How old must `started` be before it is stale?
- Is a payload hash needed?
- Is per-run recovery status needed?
- Should trigger path and waiting path be separated in the record?
- How long should processed event records be retained?
- Is a cleanup API needed?
- Should production store design come first?
