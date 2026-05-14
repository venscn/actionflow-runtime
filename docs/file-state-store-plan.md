# FileStateStore MVP Plan

This document outlines a minimal FileStateStore implementation plan. The current implementation covers ActionRun and FlowRun persistence only; flow definition persistence, trigger persistence, and durable recovery are not implemented.

## 1. Purpose

FileStateStore should provide a small local persistence layer for:

- local development
- single-machine debugging
- validating JSON serialization boundaries
- shaping record formats for future SQLite/Postgres stores

It should be simple enough to implement and inspect manually.

## 2. Non-Goals

The MVP should not attempt to provide:

- distributed storage
- concurrent multi-process writes
- database transactions
- high-performance indexes
- compression
- encryption
- automatic schema migration
- event recovery

The MVP is a local development store, not a production persistence system.

## 3. Directory Layout

Suggested layout:

```text
.actionflow/
├─ action-runs/
├─ flow-runs/
├─ flows/
├─ triggers/
└─ metadata.json
```

Suggested file names:

- `action-runs/{runId}.json`
- `flow-runs/{flowRunId}.json`
- `flows/{flowId}/{version}.json`
- `triggers/{triggerId}.json`

File names must be safely encoded or escaped. Raw ids may contain `/`, `\`, `:`, or other characters that affect paths, especially on Windows. The MVP should use a deterministic safe file name helper rather than concatenating ids directly into paths.

## 4. Record Format

Each JSON file should use an envelope:

```json
{
  "schemaVersion": 1,
  "kind": "actionRun",
  "savedAt": "2026-05-14T00:00:00.000Z",
  "data": {}
}
```

Fields:

- `schemaVersion`: persisted file schema version.
- `kind`: record kind, such as `actionRun` or `flowRun`.
- `savedAt`: wall-clock timestamp for debugging and inspection.
- `data`: the persisted runtime record.

The envelope keeps store metadata separate from runtime data.

## 5. Serialization Rules

FileStateStore should only accept JSON-compatible data.

Rules:

- `ActionDefinition` function bodies are not saved.
- `Error` values need safe serialization before writing.
- `undefined` should not silently round-trip as a meaningful value. Either remove it through JSON serialization or reject it explicitly; the MVP should choose and document one behavior.
- Non-JSON values such as functions, symbols, class instances, streams, sockets, and circular references should fail explicitly.

The first implementation should prefer explicit failure over lossy persistence.

## 6. Write Strategy

MVP write strategy:

1. Ensure the target directory exists.
2. Serialize the envelope to JSON.
3. Write to a temporary file in the same directory.
4. Rename the temporary file to the target path.
5. Clean up temporary files on best effort if writing fails.

This reduces the chance of half-written target files.

Windows rename behavior needs attention. Rename may fail if the target exists or is held open by another process. The MVP should use Node filesystem APIs carefully and document that it does not guarantee multi-process concurrency safety.

## 7. Read Strategy

Read behavior:

- Read a single record by resolving its safe file name.
- `list` operations scan the relevant directory and parse each JSON file.
- Corrupted JSON should produce a clear error. The MVP should fail explicitly rather than skipping corrupted files silently.
- `schemaVersion` mismatch should fail explicitly.
- Unexpected `kind` should fail explicitly.

This makes local corruption visible during development.

## 8. Delete And Clear

Delete behavior:

- `deleteActionRun` deletes one file from `action-runs`.
- `deleteFlowRun` deletes one file from `flow-runs`.
- `clear` removes only the FileStateStore-managed directory contents.

Safety rules:

- Never delete arbitrary computed paths without verifying they are inside the configured store root.
- Do not allow `clear` to target the project root, user home, drive root, or any path outside the configured `.actionflow` directory.
- Use resolved absolute paths for containment checks.

## 9. StateStore Interface Mapping

Current StateStore methods map directly to ActionRun and FlowRun files:

- `saveActionRun` -> write `action-runs/{runId}.json`
- `getActionRun` -> read `action-runs/{runId}.json`
- `listActionRuns` -> scan `action-runs`
- `saveFlowRun` -> write `flow-runs/{flowRunId}.json`
- `getFlowRun` -> read `flow-runs/{flowRunId}.json`
- `listFlowRuns` -> scan `flow-runs`
- `deleteActionRun` -> delete `action-runs/{runId}.json`
- `deleteFlowRun` -> delete `flow-runs/{flowRunId}.json`
- `clear` -> clear managed store directories

The MVP can initially implement only ActionRun and FlowRun persistence because those are in the current `StateStore` interface.

Persisting `FlowDefinition` and `EventTriggerDefinition` would require extending the store interface or adding separate store components later.

## 10. Error Handling

The implementation should report clear errors for:

- directory create failed
- file write failed
- file read failed
- invalid JSON
- `schemaVersion` mismatch
- non-serializable data
- unsafe id/path

Errors should include enough context to identify the record kind and id.

## 11. Test Plan

Future implementation tests should cover:

- save/get ActionRun
- overwrite ActionRun
- list ActionRuns
- delete ActionRun
- save/get FlowRun
- overwrite FlowRun
- list FlowRuns
- clear
- corrupted JSON
- unsafe id
- non-serializable value
- temp file rename behavior

Tests should use temporary directories and avoid relying on global filesystem state.

## 12. Implementation Phases

Phase 1:

- File envelope helpers
- safe file name helper
- JSON serializability check

Status: base helpers are implemented in `src/file-state-store-utils.ts`.

Phase 2:

- FileStateStore for ActionRun / FlowRun

Status: implemented for the current `StateStore` interface only. It persists ActionRun and FlowRun records as local JSON envelopes and does not persist FlowDefinition or EventTriggerDefinition records.

Phase 3:

- tests and README docs

Phase 4:

- optional flow/trigger persistence extension

## 13. Open Questions

- Should FileStateStore save `FlowDefinition`?
- Should FileStateStore save `EventTriggerDefinition`?
- What exact error serialization format should be used?
- Should stores support codecs for non-JSON outputs?
- Is `fsync` required for the MVP?
- Is a lock file needed for single-process safety?
- How should Windows path length limits be handled?
