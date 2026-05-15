# Event Recovery Design

## 1. Problem

ActionRun can currently enter `waiting` status. Runtime can write waiting ActionRuns into a waiting index, and both MemoryStateStore and FileStateStore can query that index.

The runtime now has a read-only `matchWaitingRuns(event)` API that can match an external event name to waiting index entries. `EventTriggerRegistry` currently manages descriptive trigger definitions only. It does not automatically start flows or wake waiting actions.

`ActionFlowRuntime.restoreRun` can reload run records, but `matchWaitingRuns` does not call `restoreRun` or `tick`. As a result, waiting actions currently require the host to explicitly decide what to do after a match, and they cannot recover from an event automatically.

## 2. Goals

Event Recovery should:

- Define how external events can match waiting index entries.
- Define the boundary of a wakeup API.
- Let the host explicitly trigger recovery.
- Avoid automatic external event listeners in Runtime.
- Keep FlowEngine semantics unchanged.
- Provide groundwork for future durable event recovery.
- Avoid treating `EventTriggerRegistry` as an implemented event bus.

## 3. Non-Goals

This design does not implement:

- Background workers.
- Distributed queues.
- External event buses.
- Automatic polling.
- Exactly-once delivery guarantees.
- Durable recovery guarantees.
- Automatic trigger execution.
- Automatic retry policy.
- Production scheduler behavior.

## 4. Current Building Blocks

Current implemented pieces:

- `ActionResult` waiting with `state` and `reason`.
- `ActionRunRecord.waitReason`.
- FlowRun waiting status.
- `ActionFlowRuntime.restoreRun`.
- `WaitingIndexStore`.
- MemoryStateStore waiting index.
- FileStateStore waiting index.
- `ActionFlowRuntime.matchWaitingRuns(event)` read-only matching.
- `EventTriggerRegistry` definitions.
- FileStateStore local persistence.

These are prerequisites for Event Recovery. They are not Event Recovery by themselves.

## 5. Proposed Event Shape

Candidate event structure:

```ts
interface RuntimeEvent {
  id: string;
  name: string;
  payload?: unknown;
  occurredAt?: string;
  source?: string;
}
```

- `id` is for idempotency or diagnostics.
- `name` is the first matching key.
- `payload` should be JSON-compatible data.
- `occurredAt` is diagnostic metadata.
- `source` is optional event origin metadata.
- Payload schema validation is out of scope for the first design stage.

## 6. Matching Model

Initial matching can use:

```text
event.name === waitingEntry.waitReason
```

Future versions may introduce a stricter `eventKey`.

`EventTriggerDefinition.event` can be used for a start-flow trigger path later, but waiting recovery should be designed separately first. A trigger definition must not automatically imply waiting recovery.

One event may match multiple waiting entries. One waiting entry may also be matched by duplicate events, so idempotency needs a separate policy.

## 7. Proposed Runtime API

Candidate result types:

```ts
interface EventRecoveryResult {
  eventId: string;
  matched: readonly WaitingRunIndexEntry[];
  recovered: readonly FlowEngineRunRecord[];
  skipped: readonly EventRecoverySkip[];
}

interface EventRecoverySkip {
  runId: string;
  reason: string;
}
```

Candidate method:

```ts
recoverWaitingRuns(event: RuntimeEvent, options?: EventRecoveryOptions): Promise<EventRecoveryResult>
```

The host calls this explicitly. Runtime does not listen to external events.

The implemented `matchWaitingRuns(event)` API queries the waiting index by `event.name` and returns matching entries only. It does not call `restoreRun`, does not call `tick`, does not wake actions, does not execute triggers, and does not implement exactly-once behavior.

A future recovery API may attempt to `restoreRun(entry.flowRunId)` depending on the selected strategy. Whether it should immediately call `tick` must be defined separately. If ticking is introduced later, the host must have registered the matching flow and actions.

If an entry has no `flowRunId`, the recovery path should skip it. If `restoreRun` fails, the result should either record a skip or surface an error. The recommended first behavior is skip with reason.

## 8. Recovery Strategy Options

### Strategy A: Match and report only

- API only returns matched waiting entries.
- Host decides whether to restore or tick.
- Lowest risk.
- Best fit for the first implementation.

### Strategy B: Restore and tick

- API calls `restoreRun`, then `tick`.
- More automatic.
- Requires matching flow and action definitions to be registered.
- Error handling is more complex.
- May repeat work if events are duplicated.

### Strategy C: Wake token / state mutation

- API mutates waiting action state so a later tick can continue.
- Requires an action contract for event injection.
- The current `ActionResult` model does not support clearing wait reason or injecting event data.
- Not recommended for the first version.

Recommendation: start with Strategy A, match and report only. Design an explicit restore/tick policy after matching behavior is stable.

## 9. Relationship With EventTriggerRegistry

`EventTriggerRegistry` is currently event-to-flow metadata.

Event recovery for waiting runs is a separate path. Future event handling may have two independent behaviors:

1. An event starts a new flow through a trigger.
2. An event matches a waiting run through the waiting index.

The two paths should not be conflated. A single event may eventually do both, but that needs explicit policy.

## 10. Idempotency and Duplicate Events

Risks:

- The same event may arrive more than once.
- The same waiting run may be matched repeatedly.
- Waiting index entries can be stale.
- An action may already be `done` or `failed` while an index entry remains.
- FileStateStore is not a transaction store.

Candidate future strategy:

- Store processed event ids in a separate processed-events index.
- Do not claim exactly-once delivery in the first version.
- Return `matched` and `skipped` records so the API does not pretend recovery succeeded.

## 11. Error Handling

Suggested behavior:

- Missing waiting index support: return empty `matched` with an unsupported note or skip reason.
- Corrupted waiting index: throw, because the store cannot be trusted.
- Missing `flowRunId`: skip.
- Missing FlowRun during restore: skip with reason.
- Unregistered flow/action: not relevant for Strategy A; if future ticking is added, surface the tick error.
- Invalid event payload: do not validate in the first version.

## 12. Store Requirements

Event Recovery depends on `WaitingIndexStore`.

- MemoryStateStore is suitable for tests.
- FileStateStore is suitable for local inspection.
- Production Event Recovery is better served by a database-backed store.
- FileStateStore does not provide exactly-once delivery or multi-process safety.

## 13. Health Check Relationship

`checkHealth` may later validate stale waiting index entries.

Current health reporting does not verify that waiting entries correspond to existing ActionRun records. Future issues could include:

- Missing waiting action target.
- Stale waiting index entry.
- Waiting entry without `flowRunId`.

`checkHealth` should remain read-only and should not repair data automatically.

## 14. Implementation Plan

Phase 1:

- Design document only.

Phase 2:

- Add `RuntimeEvent` and `EventRecoveryResult` types. Implemented.

Phase 3:

- Add a read-only `matchWaitingRuns(event)` API. Implemented.

Phase 4:

- Add `recoverWaitingRuns` Strategy A: match and report only. Not implemented. Current `matchWaitingRuns` only matches and does not recover.

Phase 5:

- Add optional restore preview.

Phase 6:

- Design explicit resume/tick policy.

Phase 7:

- Integrate the `EventTriggerRegistry` start-flow path separately.

## 15. Tests Needed

Implemented tests currently cover:

- Event name matches `waitReason`.
- Nonmatching event returns empty `matched`.
- Missing waiting index support fallback.
- `matchWaitingRuns` validates event id and name.
- `matchWaitingRuns` does not restore or tick.
- `matchWaitingRuns` does not mutate waiting index.
- `EventTriggerRegistry` does not auto-run during matching.
- Waiting index errors are surfaced.

Remaining future tests should cover:

- Multiple waiting entries match one event.
- Stale waiting index entry is reported.
- Missing `flowRunId` is skipped.
- Corrupted waiting index surfaces an error.
- Explicit restore preview behavior once designed.
- Explicit resume/tick recovery policy once designed.
- Duplicate event id behavior once designed.

## 16. Open Questions

- Should `event.name` directly match `waitReason`?
- Is an `eventKey` field needed?
- Is a processed event index needed?
- Is a match-only API enough for the first version?
- Should recovery belong to `ActionFlowRuntime`?
- Is a separate `EventRecoveryService` needed?
- Can one event both start a flow and wake a waiting run?
- Is payload schema validation needed?
- Are timeout or expiration fields needed?
- Should database store design come first?
