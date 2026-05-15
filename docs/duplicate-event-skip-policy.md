# Duplicate Event Skip Policy

## 1. Problem

`RuntimeEvent` has an `id`.

`recoverWaitingRuns(event)` currently writes observe-only `started`, `completed`, and `failed` processed event records. It does not skip when the same `eventId` already has a completed record.

If explicit tick recovery is repeated for the same event, the runtime may repeat ticks or duplicate side effects. A duplicate event policy is needed, but it must not be described as exactly-once behavior.

## 2. Current Behavior

- `matchWaitingRuns(event)` does not write processed event records.
- `previewEventRecovery(event)` does not write processed event records.
- `recoverWaitingRuns(event)` writes observe-only processed event attempts.
- `recoverWaitingRuns(event)` does not skip duplicate completed events.
- `tickRecoveredRuns(result, options)` does not write processed event records.
- `tickRecoveredRuns` runs only when the host explicitly calls it.
- Exactly-once behavior is not implemented.
- Durable recovery is not implemented.

## 3. Goals

- Design handling for repeated `eventId` values.
- Keep default behavior safe and compatible.
- Avoid silently dropping events unless a policy explicitly enables that behavior.
- Provide idempotency groundwork for future `recoverWaitingRuns` and `tickRecoveredRuns` usage.
- Make skip reasons visible.
- Avoid claiming exactly-once behavior.
- Avoid automatic trigger execution.
- Avoid automatic waiting action wakeup.

## 4. Non-Goals

- Exactly-once guarantee.
- Distributed deduplication.
- External event bus.
- Automatic polling.
- Automatic trigger execution.
- Automatic wakeup.
- Durable recovery guarantee.
- Production scheduler.

## 5. Policy Options

### Policy A: observe-only

Current behavior:

- Every event records an attempt.
- Completed events are not skipped.
- Useful for development and diagnostics.
- Repeated events may repeat preview work or later explicit ticks.

### Policy B: skip-completed

Candidate behavior:

- If `ProcessedEventRecord.status === "completed"`, skip this recovery attempt.
- Do not run preview.
- Do not tick.
- Return a clear duplicate skip result.
- Do not claim exactly-once behavior, because concurrency, persistence, and external side effects are still not guaranteed.

### Policy C: retry-failed

Candidate behavior:

- Completed events are skipped.
- Failed events can be retried.
- Started events need a stale handling policy.

### Policy D: stale-started handling

Candidate behavior:

- Recent `started` records are treated as in-progress and may be skipped.
- Old `started` records are treated as stale and may be retried or marked failed.
- Requires clock and threshold policy.

Recommended first implementation:

- Keep Policy A as the default.
- Add Policy B as an explicit option.
- Defer retry-failed and stale-started handling.

## 6. Proposed API Shape

Candidate types, not implemented:

```ts
type DuplicateEventPolicy = "observe" | "skip-completed";

interface RecoverWaitingRunsOptions {
  duplicatePolicy?: DuplicateEventPolicy;
}

recoverWaitingRuns(event: RuntimeEvent, options?: RecoverWaitingRunsOptions): EventRecoveryResult
```

Rules:

- `duplicatePolicy` defaults to `"observe"`.
- `"observe"` keeps current behavior.
- `"skip-completed"` skips only when `ProcessedEventStore` is available and `existing.status === "completed"`.
- If the store does not support `ProcessedEventStore`, duplicate detection is unavailable and behavior stays observe-only.
- `tickRecoveredRuns` is unchanged.
- `tickRecoveredRuns` still does not write processed event records.

## 7. Result Shape Options

### Option A: Add eventSkipped field

Candidate:

```ts
interface EventRecoveryDuplicateSkip {
  eventId: string;
  reason: string;
  existingStatus: ProcessedEventStatus;
}

interface EventRecoveryResult {
  // existing fields
  eventSkipped?: EventRecoveryDuplicateSkip;
}
```

Advantages:

- Event-level skip is explicit.
- Run-level `skipped` remains run-level.

Tradeoff:

- Expands a public type.

### Option B: Use skipped with pseudo runId

Candidate:

```ts
skipped: [{ runId: event.id, reason: "Duplicate event already completed" }]
```

This is not recommended because `EventRecoverySkip` is run-level. Using an event id as `runId` is misleading.

### Option C: Return empty result and rely on processed event

This is not recommended because callers cannot distinguish no match from duplicate skip.

Recommended first implementation: Option A.

## 8. Processed Event Record Behavior

Candidate behavior for `skip-completed`:

### Strategy A: Do not mutate completed record

- Keep the completed record unchanged.
- Do not increment `attemptCount`.
- Least side effect.

### Strategy B: Increment attemptCount and keep completed

- Records duplicate attempts.
- Mixes completed status with duplicate attempt metadata.

### Strategy C: Add duplicateCount

- Requires extending `ProcessedEventRecord`.

Recommended first implementation: Strategy A. Do not mutate completed records on skip.

## 9. Runtime Flow

Candidate `skip-completed` flow:

1. Validate `RuntimeEvent`.
2. If `duplicatePolicy === "skip-completed"` and store supports `ProcessedEventStore`:
   - `existing = getProcessedEvent(event.id)`.
   - If `existing?.status === "completed"`:
     - Return `EventRecoveryResult` with `eventSkipped`.
     - Do not call `previewEventRecovery`.
     - Do not write `started`, `completed`, or `failed`.
     - Do not tick.
3. Otherwise use current observe-only `recoverWaitingRuns` behavior.

## 10. Interaction With tickRecoveredRuns

Duplicate skip belongs to `recoverWaitingRuns`, not `tickRecoveredRuns`.

`tickRecoveredRuns` processes an `EventRecoveryResult` explicitly passed by the host. It should not consult `ProcessedEventStore` and should not implement exactly-once behavior.

If a future result has `eventSkipped`, `tickRecoveredRuns` should safely return empty `runResults` or process empty `recovered` data.

## 11. Error Handling

- Invalid `duplicatePolicy`: throw.
- Existing completed record: return event-level skip result.
- Existing failed record: do not skip in the first version.
- Existing started record: do not skip in the first version.
- `ProcessedEventStore` read error: throw.
- Store without `ProcessedEventStore`: observe behavior.
- Preview error under observe policy: keep current failed record behavior.

## 12. Safety Rules

- Default stays observe-only.
- `skip-completed` must be explicitly enabled.
- `skip-completed` does not tick.
- `skip-completed` does not wake waiting actions.
- `skip-completed` does not execute triggers.
- Do not claim exactly-once behavior.
- Do not guarantee concurrency safety.
- Do not guarantee external side-effect idempotency.
- Durable recovery is not implemented.

## 13. Tests Needed If Implemented

- Default `recoverWaitingRuns` still observes duplicate completed events.
- `skip-completed` returns `eventSkipped` for completed existing event.
- `skip-completed` does not call preview on completed existing event.
- `skip-completed` does not write a new processed event record.
- `skip-completed` does not tick.
- `skip-completed` does not execute trigger.
- `skip-completed` does not affect failed existing event.
- `skip-completed` does not affect started existing event.
- Store without `ProcessedEventStore` falls back to observe behavior.
- Invalid `duplicatePolicy` throws.
- `tickRecoveredRuns` ignores `eventSkipped` or empty recovered result safely.
- Exactly-once is not claimed.

## 14. Open Questions

- Should the default stay observe-only permanently?
- Should `skip-completed` increment `attemptCount`?
- Is `duplicateCount` needed?
- Should failed records retry by default?
- How should stale started records be handled?
- Should skip policy be applied before or after matching?
- Should `eventSkipped` be added to `EventRecoveryResult`?
- Should a separate `RecoveryAttemptRecord` be introduced?
- How should production stores handle concurrent duplicate events?
