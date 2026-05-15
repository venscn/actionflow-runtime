# Waiting Index Design

## 1. Problem

ActionRun can currently enter `waiting` status. FlowEngine can also move a node or flow to `waiting`. `ActionFlowRuntime.restoreRun` can reload saved run records.

The runtime does not yet have an index for finding which ActionRuns are waiting for a specific external event or reason. `EventTriggerRegistry` is still only a descriptive registry and does not automatically wake waiting actions.

Without a waiting index, future event recovery would need to scan all ActionRun records. That is inefficient and leaves the matching semantics unclear.

## 2. Goals

Waiting Index should:

- Record queryable entries for waiting ActionRuns.
- Support lookup by `waitReason` or a future event key.
- Provide groundwork for later event recovery.
- Keep current ActionFlowRuntime execution semantics unchanged.
- Avoid automatically resuming waiting actions.
- Avoid automatically executing EventTrigger definitions.
- Remain an optional StateStore extension, so stores do not need to implement it immediately.

## 3. Non-Goals

This design does not implement:

- Event recovery.
- Automatic wakeup.
- Distributed queues.
- Scheduler workers.
- External event bus.
- Durable recovery guarantee.
- Exactly-once event delivery.
- Trigger execution.
- Waiting timeout system.

## 4. Current Waiting Semantics

Current waiting behavior:

- `ActionResult` waiting contains `state` and `reason`.
- `ActionRunRecord` can save `status: "waiting"`, `state`, and `waitReason`.
- FlowRun can enter `waiting`.
- `restoreRun` can reload records.
- A waiting run does not automatically continue.
- A later `tick` still requires the host to register the matching flow and actions and call `tick` explicitly.
- There is no API to query waiting ActionRuns by reason or event.

## 5. Proposed Data Model

Candidate entry shape:

```ts
interface WaitingRunIndexEntry {
  runId: string;
  flowRunId?: string;
  nodeId?: string;
  actionId: string;
  actionVersion?: string;
  waitReason: string;
  status: "waiting";
  indexedAt: string;
}
```

- `runId` comes from `ActionRunRecord.runId`.
- `flowRunId` and `nodeId` can be derived from the existing runId prefix convention or recorded explicitly.
- `waitReason` comes from `ActionRunRecord.waitReason`.
- `indexedAt` is diagnostic metadata and does not affect scheduling semantics.
- The index does not save action function bodies.
- The index does not save FlowDefinition records.

## 6. Proposed Store Extension

Candidate optional interface:

```ts
interface WaitingIndexStore extends StateStore {
  indexWaitingActionRun(run: ActionRunRecord): void;
  removeWaitingActionRun(runId: string): void;
  listWaitingActionRuns(filter?: WaitingRunFilter): readonly WaitingRunIndexEntry[];
}

interface WaitingRunFilter {
  waitReason?: string;
  flowRunId?: string;
  actionId?: string;
}
```

This should be an optional extension. Runtime can detect whether a store supports it. If the store does not support it, current behavior should remain unchanged.

The waiting index should not be forced into the base `StateStore` interface.

## 7. Runtime Integration Sketch

Future runtime integration could be:

1. `ActionFlowRuntime.tick` produces `nextRun`.
2. Runtime saves FlowRun and ActionRuns.
3. Runtime checks `nextRun.actionRuns`.
4. If an ActionRun is `waiting` and has `waitReason`, runtime writes it to the waiting index.
5. If an ActionRun is `done`, `failed`, or `ready`, runtime removes its run id from the waiting index.
6. If the store does not support waiting index, runtime skips this step.
7. FlowEngine semantics do not change.
8. Runtime does not automatically wake waiting actions.

## 8. FileStateStore Waiting Index Layout

Possible local JSON layout:

```text
.actionflow/
  waiting-runs/
    {safeRunId}.json
```

Each file stores one `WaitingRunIndexEntry`.

Rules:

- Use `safeFileName`.
- Use JSON-compatible checks.
- Whether corrupted index files throw or become health issues needs a later decision.
- Whether `clear()` removes `waiting-runs` needs to be defined.
- Waiting index must not be treated as an event queue.

## 9. MemoryStateStore Behavior

MemoryStateStore can use `Map<runId, WaitingRunIndexEntry>`.

Expected behavior:

- `indexWaitingActionRun` overwrites the same run id.
- `removeWaitingActionRun` deletes the entry.
- `listWaitingActionRuns` supports `waitReason`, `flowRunId`, and `actionId` filters.

## 10. FileStateStore Behavior

Suggested phases:

- Phase 1: helper/types only.
- Phase 2: MemoryStateStore waiting index.
- Phase 3: Runtime optional waiting index path.
- Phase 4: FileStateStore waiting index JSON files.
- Phase 5: health report integration.
- Phase 6: event recovery design.

## 11. Event Recovery Relationship

Waiting Index only helps find waiting runs.

Event recovery still needs separate design:

- Event shape.
- Event matching.
- Wakeup API.
- Resume policy.
- Idempotency policy.
- Conflict handling.

`EventTriggerRegistry` does not currently use Waiting Index automatically. Waiting Index is a prerequisite for event recovery, not event recovery itself.

## 12. Risks

Known risks:

- Waiting entries can become stale.
- The runId prefix convention may not be stable enough.
- `waitReason` may not be a strict event key.
- Action state may not be recoverable.
- Action implementations must be registered again by the host.
- Waiting index may become inconsistent with ActionRunRecord.
- Failed removal can leave stale index entries.
- FileStateStore does not provide multi-process safety.

## 13. Tests Needed

Future implementation tests should cover:

- MemoryStateStore indexes waiting ActionRun.
- MemoryStateStore removes index when an action is no longer waiting.
- Filtering by `waitReason`, `flowRunId`, and `actionId`.
- Runtime uses waiting index only when the store supports it.
- Runtime fallback when the store does not support it.
- FileStateStore writes waiting index entries.
- FileStateStore lists waiting index entries.
- FileStateStore rejects invalid index JSON.
- `restoreRun` does not automatically wake waiting runs.
- Event recovery is not triggered by the index alone.

## 14. Open Questions

- Is `waitReason` enough as an event key?
- Is a separate `eventKey` field needed?
- Is timeout or `expiresAt` needed?
- Should indexed FlowRun status be included?
- Should sequence/parallel node waiting states be indexed?
- Should the index be rebuildable from ActionRun records?
- Should Waiting Index participate in `checkHealth`?
- Is a delete-stale-index API needed?
