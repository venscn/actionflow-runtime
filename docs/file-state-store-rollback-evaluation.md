# FileStateStore Rollback Evaluation

## 1. Problem

FileStateStore batch writes currently use a pending manifest, staging record envelopes, committed markers, and failed markers.

Target writes are still best-effort. If a batch fails after some target files are written, FlowRun and ActionRun records may become inconsistent. A failed marker can help diagnose the failed batch, but it cannot restore consistency.

Rollback may look like the obvious next step, but file-system rollback can easily delete or overwrite valid data if the target file existed before the batch.

## 2. Current Batch Flow

The current save flow is:

1. Write pending manifest.
2. Write staging record envelopes.
3. Validate staging records.
4. Write target FlowRun.
5. Write target ActionRuns.
6. Write committed marker on success.
7. Write failed marker on failure after pending manifest exists.

Pending, committed, and failed markers are diagnostics. `restoreRun` still reads only the stored FlowRun plus matching ActionRuns. `checkHealth` only summarizes marker state.

## 3. Rollback Goals

If rollback is implemented later, it should:

- Reduce manual recovery cost after partial writes.
- Avoid deleting valid pre-existing records.
- Give health tooling clearer repair suggestions.
- Keep ActionFlowRuntime execution semantics unchanged.
- Avoid introducing automatic event recovery.
- Avoid presenting FileStateStore as durable recovery.

## 4. Non-Goals

Rollback evaluation does not aim to provide:

- Database transaction replacement.
- Multi-process safe rollback.
- Distributed transactions.
- Exactly-once execution.
- Event recovery.
- Automatic resume of waiting actions.
- Automatic deletion of user data without an explicit API call.

## 5. Main Rollback Risks

Key risks:

- A target file may have existed before the batch.
- Overwriting a target loses the previous value unless a backup exists.
- Deleting a target after a failed batch may delete a valid old record.
- Partial rollback can be worse than partial write.
- The process may crash during rollback.
- Windows rename and delete behavior needs care.
- Another process may write concurrently.
- Old committed markers may not map to current files.
- Corrupted manifests can mislead rollback tooling.

## 6. Possible Strategies

### Strategy A: No Automatic Rollback

Keep the current behavior. Use markers and `checkHealth` for diagnostics. Let the user or a tool decide what to do.

This is the lowest-risk option.

### Strategy B: Backup-Before-Replace

Before writing a target file, copy the existing target to a backup area. Rollback can restore backups.

This adds disk usage, metadata, and cleanup complexity.

### Strategy C: Staged Replace With Commit Marker

Write all records to staging and use a commit marker to indicate that a batch appears complete.

Target writes are still not atomic across files. This improves inspection more than rollback.

### Strategy D: Journaled Target Operations

Record intended file operations before applying them. Tooling can inspect what was attempted and possibly create a repair plan.

This adds metadata and migration complexity.

### Strategy E: Use Database Backend Instead

SQLite or Postgres transactions solve atomic multi-record writes more cleanly.

FileStateStore can remain a local development and inspection store.

## 7. Recommended Direction

Do not implement automatic rollback yet.

Prefer health check improvements and explicit repair tooling design first. If rollback is needed, start with backup-before-replace as an explicit API, not automatic behavior.

For production atomicity, prefer a future SQLite or Postgres store.

Reasons:

- FileStateStore is local and development oriented.
- Automatic rollback can destroy valid existing records.
- Current diagnostics are enough for the MVP.
- The next higher-value step may be health report improvements or waiting index design.

## 8. Candidate Future APIs

Possible APIs:

- `inspectBatch(batchId)`
- `checkHealth({ includeFiles: true })`
- `createRepairPlan(batchId)`
- `applyRepairPlan(plan)`
- `cleanupBatchMarkers(options)`
- `backupTargetRecord(...)`
- `restoreTargetBackup(...)`

APIs should default to read-only behavior. Destructive repair must require an explicit method call.

## 9. Tests Needed If Implemented

If rollback or repair tooling is implemented later, tests should cover:

- Rollback does not delete pre-existing target records.
- Rollback restores backups.
- Rollback failure preserves diagnostics.
- Corrupted manifest prevents rollback.
- Unsafe ids remain safe.
- Concurrent write assumptions are documented.
- Explicit repair API is required.
- No automatic rollback during `restoreRun` or `checkHealth`.

## 10. Open Questions

- Should FileStateStore ever implement destructive repair?
- Should backups be retained after committed batch?
- How long should markers and backups be retained?
- Should rollback be a separate package or tool?
- Should SQLite store be prioritized instead?
- Should `checkHealth` include file existence validation before rollback is considered?
