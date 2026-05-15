# State Persistence Status

This document summarizes the current state persistence work. It is a status checkpoint, not a new runtime design or feature claim.

## 1. Implemented

Current implemented pieces:

- FileStateStore local JSON persistence for ActionRun / FlowRun.
- File envelopes with `schemaVersion`, `kind`, `savedAt`, and `data`.
- `safeFileName` for deterministic id-to-file-name encoding.
- JSON serializability checks for persisted records.
- `ActionFlowRuntime.restoreRun`.
- `MemoryStateStore.saveRunBatch`.
- FileStateStore best-effort `saveRunBatch`.
- Runtime optional batch save path.
- Pending batch manifest writing.
- Pending staging record writes and validation.
- `listPendingBatches` pending manifest inspection.
- Committed marker writing.
- `listCommittedBatches` committed marker inspection.
- Failed marker writing.
- `listFailedBatches` failed marker inspection.
- FileStateStore `checkHealth` diagnostic summary.
- Health report issues for pending, failed, and missing target diagnostics.
- MemoryStateStore waiting index.
- Runtime optional waiting index path.
- FileStateStore waiting index.
- Event Recovery match-only API.
- Event Recovery restore preview API.
- Event Recovery resume policy design.
- Explicit Tick Recovery design.
- Explicit tick recovery helper.
- Duplicate Event Skip Policy design.
- Duplicate event skip-completed policy.
- Stale Waiting Index Health design.
- FileStateStore stale waiting index health checks.
- Waiting Index Repair design.
- Processed Event ID design.
- Processed Event ID store types.
- MemoryStateStore processed event id.
- FileStateStore processed event id.
- Runtime explicit processed event accessors.
- `recoverWaitingRuns` match/preview-only API.
- Observe-by-default processed event policy wiring for `recoverWaitingRuns`.
- Restore done run example in `examples/file-state-store-restore.ts`.
- Restore yielded sliceable run plus explicit tick example in `examples/file-state-store-resume.ts`.
- `collect-check` runs all `example:*` npm scripts.

## 2. Not Implemented

The following are not implemented:

- Durable recovery guarantee.
- Waiting index repair APIs.
- Waiting action wakeup.
- Retry-failed / stale-started duplicate policies.
- Exactly-once behavior.
- Event trigger execution.
- FlowDefinition persistence.
- EventTriggerDefinition persistence.
- Database stores.
- Transaction / atomic multi-file batch save.
- Rollback.
- Atomic multi-file batch recovery.
- Schema migration.
- Production concurrency safety.
- Error serialization strategy.

## 3. Current Recovery Semantics

Current recovery is local record reload only.

- `restoreRun` reloads a stored FlowRun and matching ActionRuns.
- `restoreRun` does not tick.
- `restoreRun` does not require the flow to be registered.
- A later `tick` requires the host to register the matching flow and actions.
- A yielded sliceable action can continue if its state is JSON-compatible.
- A waiting action still cannot recover from an event automatically.

## 4. Current FileStateStore Limits

`FileStateStore` is intentionally small.

- It stores only ActionRun / FlowRun records.
- It uses local JSON files only.
- It rejects `undefined`, function, Error, Date, circular values, and other non-JSON-compatible data.
- It does not use `fsync`.
- It does not use a lock file.
- It does not provide multi-process safety.
- It does not provide database transactions.

## 5. Risks

Known risks:

- FlowRun and ActionRun saves are not atomic together.
- FlowRun and ActionRun saves now use batch when supported, but FileStateStore batch remains best-effort and not atomic.
- Partial write risk still exists for FileStateStore.
- Pending manifests help diagnose batch writes but do not prevent partial writes.
- Committed markers improve inspection but do not make writes atomic.
- Failed markers improve inspection but do not repair partial writes.
- Health check reports marker state, missing committed target files, and stale waiting index diagnostics, but does not validate full data consistency or repair partial writes.
- Missing target detection reports possible inconsistency but does not repair it.
- `listPendingBatches` can report invalid manifests but does not repair them.
- Corrupted JSON fails reads and lists.
- There is no migration story yet.
- There is no error serialization strategy.
- There is no complete schema validation.
- `restoreRun` ActionRun merge relies on the `runId` prefix convention.
- Action code must be re-registered by the host.

## 6. Recommended Next Step

Prefer not to expand FileStateStore broadly yet. The recommended sequence is:

- Phase A: Waiting index repair implementation.
- Phase B: Trigger start-flow design.

The reason is that single-record local persistence is already enough for development and inspection. The next real risks are FlowRun / ActionRun consistency and waiting recovery, not adding more storage backends.

## 7. Candidate Next Implementation

Two reasonable next implementation candidates:

- Waiting index repair implementation.
- Trigger start-flow design.

Recommendation: start with waiting index repair implementation. MemoryStateStore and FileStateStore storage plus explicit runtime accessors now exist, and FileStateStore can report stale waiting index diagnostics, but repair APIs, automatic wakeup, exactly-once behavior, event trigger execution, and durable recovery are still not implemented.
