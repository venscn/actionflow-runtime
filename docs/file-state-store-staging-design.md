# FileStateStore Staging Design

This document designs a future staging directory and commit marker approach for FileStateStore batch writes. It is not implemented yet.

## 1. Problem

Current FileStateStore `saveRunBatch` is best-effort.

Single-file writes use a temporary file plus rename, which is relatively safe for one record. A batch writes multiple JSON files: one FlowRun and zero or more ActionRuns. That multi-file write is not atomic.

If the process fails halfway through a batch, FlowRun and ActionRun records can become inconsistent. A staging directory and commit marker can reduce the risk and allow future inspection tools to detect incomplete batches.

## 2. Goals

The staging design should:

- Provide a clearer commit boundary for FileStateStore batch save.
- Allow incomplete batches to be detected.
- Keep the implementation simple and local-development oriented.
- Avoid introducing a database.
- Reduce partial-write risk without claiming true cross-platform atomic transactions.
- Provide a conceptual reference for future SQLite/Postgres transaction-backed stores.

## 3. Non-Goals

This design does not provide:

- Complete database transactions.
- Distributed transactions.
- Multi-process concurrent write safety.
- Durable recovery guarantee.
- Event recovery.
- Automatic migration.
- `fsync` guarantee.
- Exactly-once execution.

## 4. Proposed Directory Layout

Suggested layout:

```text
.actionflow/
├─ action-runs/
├─ flow-runs/
└─ batches/
   ├─ pending/
   ├─ committed/
   └─ failed/
```

Each batch can use:

- `batches/pending/{batchId}/manifest.json`
- `batches/pending/{batchId}/records/...`
- `batches/committed/{batchId}.json` or another commit marker file

`batchId` can start as a timestamp plus random suffix. It only needs to be unique within the store root.

## 5. Batch Manifest Format

Proposed manifest:

```json
{
  "schemaVersion": 1,
  "kind": "runBatch",
  "batchId": "2026-05-15T00-00-00.000Z-abcd",
  "createdAt": "2026-05-15T00:00:00.000Z",
  "status": "pending",
  "flowRunId": "flow-run-1",
  "actionRunIds": ["flow-run-1:node-1"],
  "targetFiles": ["flow-runs/abc.json", "action-runs/def.json"]
}
```

`status` can be:

- `pending`
- `committed`
- `failed`

The manifest is for diagnostics and future recovery tooling. It does not change runtime execution semantics. It does not save action function bodies or FlowDefinition records.

## 6. Write Flow

Proposed save flow:

1. Create `batchId`.
2. Create a staging directory under `batches/pending/{batchId}`.
3. Write `manifest.json` with status `pending`.
4. Write all record envelopes into `records/`.
5. Validate that staging records can be parsed.
6. Move or rename records to target `action-runs/` and `flow-runs/` paths.
7. Write a commit marker or update manifest status to `committed`.
8. Clean up the staging directory as best effort.

Windows rename and replace behavior needs care. If a target file already exists, the store still needs a clear replace strategy. The MVP can continue using delete target plus rename, but that strategy should be documented as non-atomic and single-process oriented.

## 7. Failure Handling

Failure cases include:

- Staging directory creation fails.
- Manifest write fails.
- One record write fails.
- Parse validation fails.
- Moving a staged record to its target fails.
- Commit marker write fails.
- Cleanup fails.

Failure handling should:

- Throw an Error.
- Avoid swallowing errors.
- Preserve pending or failed batch artifacts for human or tool inspection.
- Avoid automatic rollback of target files unless a later design explicitly supports it.
- Record failure state in the manifest when possible.

## 8. Startup / Inspection Behavior

Current runtime should not automatically scan `batches/`.

Future APIs could include:

- `inspectBatches()`
- `checkStoreHealth()`

FileStateStore currently exposes `listPendingBatches()` for manual inspection. It reads and parses pending batch manifests without mutating them. It does not automatically recover, mark pending batches as failed, or change runtime execution. Invalid or corrupted pending manifests are reported as errors.

If a pending batch is found, the runtime should not automatically recover it. Tooling can report incomplete batches and let the host or user decide what to do.

## 9. Recovery Semantics

Staging and commit markers are not event recovery.

They are also not a durable recovery guarantee. They only help determine whether a batch write appears complete.

`restoreRun` still reloads a FlowRun plus matching ActionRuns. If a batch is incomplete, `restoreRun` may still fail or return incomplete records.

## 10. Implementation Plan

Phase 1:

- Document the staging design.

Phase 2:

- Add `batchId` helper and manifest types.

Status: implemented as helper/types only. FileStateStore does not write pending manifests yet.

Phase 3:

- Make FileStateStore write batch manifests in `batches/pending/`.

Status: partially implemented. FileStateStore writes a pending batch manifest before best-effort record writes. It does not write staging records, committed markers, or failed markers yet. The pending manifest is diagnostic only and does not change `restoreRun` behavior.

Phase 4:

- Make FileStateStore validate staging records before moving them.

Phase 5:

- Add commit marker support.

Phase 6:

- Add store health inspection helper.

Status: partially implemented for pending manifests only. `FileStateStore.listPendingBatches()` can list and parse pending batch manifests, but broader store health checks are not implemented.

## 11. Tests Needed

Future tests should cover:

- Successful batch creates committed marker.
- Failed batch leaves pending/failed marker.
- Corrupted staging record fails.
- Target write failure surfaces an error.
- `restoreRun` after committed batch works.
- Pending batch is detectable.
- `clear` does not accidentally delete outside store root.
- Windows unsafe ids remain safe through staging.

## 12. Open Questions

- Should `batchId` be exposed to users?
- Should committed markers be retained or cleaned up?
- Should pending batches automatically move to failed?
- Is `fsync` needed?
- Is a lock file needed?
- Is a health check API needed?
- Is a batch cleanup API needed?
- Should all records in a batch share a `savedAt` timestamp?
