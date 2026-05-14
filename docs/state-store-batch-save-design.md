# StateStore Batch Save Design

This document describes the batch-save interface for StateStore implementations and tracks its implementation phases.

## 1. Problem

A single `ActionFlowRuntime.tick` can update one FlowRun and multiple ActionRuns.

Current persistence is multiple independent calls:

- `saveFlowRun(nextRun)`
- `saveActionRun(actionRun)` for each ActionRun

If one write succeeds and a later write fails, persisted FlowRun and ActionRun records can become inconsistent. `FileStateStore` makes single-file writes relatively safe by using a temporary file and rename, but a multi-file update is still not atomic.

## 2. Goals

The batch-save design should:

- Provide batch save semantics for one tick.
- Let each store decide whether it can provide atomic behavior.
- Allow `MemoryStateStore` to apply the batch directly.
- Allow `FileStateStore` to start with best-effort behavior and improve later.
- Leave room for future SQLite/Postgres transaction-backed stores.

## 3. Non-Goals

This design does not attempt to provide:

- Distributed transactions.
- Multi-process locks.
- Database implementation.
- Event recovery.
- Schema migration.
- Exactly-once execution guarantee.

## 4. Proposed Interface

Proposed optional extension:

```ts
interface BatchStateStore extends StateStore {
  saveRunBatch(batch: StateStoreRunBatch): void;
}

interface StateStoreRunBatch {
  flowRun?: FlowRunRecord;
  actionRuns?: ActionRunRecord[];
}
```

This should be an optional extension to `StateStore`, not an immediate required method for every implementation.

`ActionFlowRuntime.tick` can detect whether the configured store supports `saveRunBatch`. If yes, it can save the FlowRun and ActionRuns with one store call. If no, it can keep the existing fallback behavior of `saveFlowRun` followed by `saveActionRun` calls.

## 5. Runtime Integration

Future `ActionFlowRuntime.tick` integration can be:

1. `FlowEngine.tick` returns `nextRun`.
2. Runtime builds a batch:
   - `flowRun: nextRun`
   - `actionRuns: Object.values(nextRun.actionRuns)`
3. If the store supports `saveRunBatch`, runtime calls it once.
4. Otherwise runtime uses the existing `saveFlowRun` plus `saveActionRun` loop.
5. FlowEngine semantics do not change.

This keeps execution behavior separate from storage behavior.

## 6. MemoryStateStore Behavior

`MemoryStateStore` can implement `saveRunBatch` by applying the same operations it already supports:

- Save the FlowRun if present.
- Save each ActionRun if present.

In-memory writes are not expected to fail under normal operation, so this mostly tests the interface semantics and runtime integration path.

## 7. FileStateStore Behavior

FileStateStore phases:

- Phase 1: best-effort batch save. Write records in a clear order and throw on failure. Implemented.
- Phase 2: staging directory. Write all target files into a staging area before moving them into place. Not implemented.
- Phase 3: commit marker / manifest. Record batch membership and commit status so startup or restore tooling can detect incomplete batches. Not implemented.

The current FileStateStore batch save is best-effort only. It is not an atomic transaction. Windows rename and replace behavior needs careful handling, especially when target files already exist or are held open by another process.

## 8. Error Handling

Batch save failure should throw an Error.

Runtime should not pretend persistence succeeded after a batch failure. Store implementations can include specific record kind/id information in error messages.

Rollback behavior is store-specific:

- `MemoryStateStore` can apply directly.
- `FileStateStore` MVP does not guarantee rollback.
- Future database-backed stores can use transactions.

## 9. Tests Needed

Future implementation tests should cover:

- Runtime uses `saveRunBatch` when the store supports it.
- Runtime falls back when the store does not support it.
- `MemoryStateStore` batch saves FlowRun and ActionRun records.
- `FileStateStore` batch writes ActionRun / FlowRun records.
- `FileStateStore` batch failure surfaces an error.
- `restoreRun` after batch save works.
- No duplicate ActionRuns after restore.

## 10. Implementation Plan

Phase 1:

- Add types only.
- Add optional type guard.
- Add `MemoryStateStore.saveRunBatch`.
- Make runtime use optional batch.

Status: implemented. `BatchStateStore`, `StateStoreRunBatch`, `supportsRunBatch`, MemoryStateStore batch support, and ActionFlowRuntime optional batch usage are in place.

Phase 2:

- Add `FileStateStore` best-effort `saveRunBatch`.

Status: implemented. FileStateStore writes the FlowRun first, then ActionRuns in order, and throws on failure without rollback.

Phase 3:

- Design FileStateStore staging / commit marker behavior.

Status: not implemented.

Phase 4:

- Add SQLite/Postgres transaction-backed stores later.

## 11. Open Questions

- Should batches include FlowDefinition / EventTriggerDefinition in the future?
- Is a transaction id needed?
- Should all records in a batch share the same `savedAt` timestamp?
- Is partial failure metadata needed?
- Is a commit marker required for FileStateStore?
- Should batch save eventually become a required `StateStore` method?
