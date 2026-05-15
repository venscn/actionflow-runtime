# Processed Event ID Design

## 1. Problem

Event Recovery will process external `RuntimeEvent` values. `RuntimeEvent` already has an `id`, but the runtime does not currently record which events have been processed.

`matchWaitingRuns` and `previewEventRecovery` are read-only and do not need processed event id storage. A future `recoverWaitingRuns` or `recoverAndTick` API may execute `tick`, and then repeated events could repeat recovery work.

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
- Neither method mutates event state.
- Neither method records processed ids.
- Neither method ticks.
- `recoverWaitingRuns` is not implemented.

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

`ProcessedEventRecord`, `ProcessedEventStore`, and `supportsProcessedEvents(store)` are implemented. MemoryStateStore processed event id storage is implemented.

This extension is optional and does not enter the base `StateStore` interface. Runtime can detect support. Stores that do not support it keep current behavior.

FileStateStore processed event storage is not implemented. Runtime integration is not implemented. `recoverWaitingRuns` is not implemented. Exactly-once behavior is not implemented.

MemoryStateStore uses in-memory records. Future FileStateStore support can write `processed-events/{safeEventId}.json`.

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

- First implementation should support Observe only or configurable Skip completed.
- Default behavior should not silently discard events.
- Exactly-once must not be claimed.

## 9. Runtime Integration Sketch

A future `recoverWaitingRuns` can:

1. Validate `RuntimeEvent`.
2. Check processed event store if supported.
3. Create or update `ProcessedEventRecord` with `status: "started"`.
4. Match waiting runs.
5. Preview or tick depending on policy.
6. Save `completed` or `failed` record.
7. Return `EventRecoveryResult` with skip reasons.

Current `matchWaitingRuns` and `previewEventRecovery` should not write processed event records. Processed event id records should be used for recovery attempts, not pure read-only matching.

## 10. FileStateStore Layout

Candidate layout:

```text
.actionflow/
  processed-events/
    {safeEventId}.json
```

Rules:

- Use `safeFileName`.
- Use JSON-compatible checks.
- Whether corrupted records throw or become health issues should be decided later.
- Whether `clear()` removes `processed-events` must be defined during implementation.
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

`checkHealth` should stay read-only. Cleanup should be an explicit API.

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

Remaining future tests should cover:

- FileStateStore writes processed event JSON.
- FileStateStore lists processed events deterministically.
- FileStateStore rejects invalid processed event JSON.
- FileStateStore clear removes processed events.
- Runtime processed event integration does not affect matchWaitingRuns or previewEventRecovery.
- recoverWaitingRuns records started / completed.
- Failed recovery records failed.
- Duplicate completed event behavior follows the selected policy.
- matchWaitingRuns does not write processed event records.
- previewEventRecovery does not write processed event records.

## 16. Open Questions

- Should the default policy be observe only or skip completed?
- How old must `started` be before it is stale?
- Is a payload hash needed?
- Is per-run recovery status needed?
- Should trigger path and waiting path be separated in the record?
- How long should processed event records be retained?
- Is a cleanup API needed?
- Should MemoryStateStore be implemented before FileStateStore?
- Should production store design come first?
