# Stale Waiting Index Health Design

## 1. Problem

`WaitingIndexStore` records query entries for waiting ActionRuns. Runtime tick writes a waiting index entry when an ActionRun is waiting, and removes an entry when an ActionRun becomes done, failed, or ready.

The waiting index can still become inconsistent with stored run records:

- A waiting index entry points to an ActionRun that does not exist.
- The ActionRun is already done, failed, or ready, but the waiting index entry remains.
- The ActionRun is still waiting, but its `waitReason` differs from the index entry.
- The waiting index entry has no `flowRunId`.
- The waiting index entry points to a FlowRun that does not exist.

These cases can make `matchWaitingRuns` and `previewEventRecovery` return stale entries. Current FileStateStore `checkHealth` reports batch marker issues and missing committed target files, but it does not validate waiting index consistency.

## 2. Goals

- Design waiting index health issue types.
- Let health reporting detect stale waiting index entries.
- Keep health checks read-only.
- Avoid automatic repair.
- Avoid automatic waiting action wakeup.
- Avoid trigger execution.
- Avoid durable recovery claims.
- Leave room for future explicit repair APIs.

## 3. Non-Goals

- Automatic repair.
- Automatic waiting wakeup.
- Trigger execution.
- Exactly-once recovery.
- Database transactions.
- Distributed locks.
- Production scheduler behavior.
- Event replay.
- Destructive cleanup.

## 4. Current Waiting Index Behavior

- `WaitingIndexStore` is an optional `StateStore` extension.
- MemoryStateStore and FileStateStore implement waiting index storage.
- Runtime tick updates the waiting index after persistence succeeds.
- `matchWaitingRuns(event)` reads the waiting index.
- `previewEventRecovery(event)` uses waiting index `flowRunId` values for restore preview.
- `recoverWaitingRuns(event)` is based on `previewEventRecovery`.
- `tickRecoveredRuns(result, options)` only processes the `result.recovered` values passed by the host.
- Current health checks do not validate whether waiting index entries are stale.

## 5. Proposed Health Issue Types

Candidate issue types:

```ts
type WaitingIndexHealthIssueType =
  | "waiting-index-missing-action-run"
  | "waiting-index-action-run-not-waiting"
  | "waiting-index-wait-reason-mismatch"
  | "waiting-index-missing-flow-run-id"
  | "waiting-index-missing-flow-run"
  | "waiting-index-action-id-mismatch";
```

Candidate issue shape:

```ts
interface WaitingIndexHealthIssue {
  type: WaitingIndexHealthIssueType;
  runId: string;
  flowRunId?: string;
  actionId?: string;
  waitReason?: string;
  message: string;
}
```

These are design candidates only. They are not implemented.

## 6. Validation Rules

For each waiting index entry, a future read-only validation can:

1. Resolve ActionRun by `entry.runId`.
2. If missing, report `waiting-index-missing-action-run`.
3. If `actionRun.status !== "waiting"`, report `waiting-index-action-run-not-waiting`.
4. If `actionRun.waitReason !== entry.waitReason`, report `waiting-index-wait-reason-mismatch`.
5. If `entry.flowRunId` is missing or empty, report `waiting-index-missing-flow-run-id`.
6. If `entry.flowRunId` exists but the FlowRun is missing, report `waiting-index-missing-flow-run`.
7. If `actionRun.actionId !== entry.actionId`, report `waiting-index-action-id-mismatch`.

All rules report diagnostics only. They do not repair records. If the store cannot list waiting index entries, this check should not run. If ActionRun JSON is corrupted, the existing read/list error strategy should surface the error.

## 7. FileStateStore checkHealth Integration

FileStateStore `checkHealth` currently reports batch marker counts, pending and failed batch issues, and missing committed target files.

Future waiting index integration can add either:

- `waitingIndexIssueCount` and `waitingIndexIssues`, or
- additional entries in the existing `issues` array.

The first implementation should avoid breaking current `checkHealth` output. It must not delete `waiting-runs` files, rewrite ActionRuns, or change waiting entries.

## 8. MemoryStateStore Considerations

MemoryStateStore has a waiting index, but it does not currently expose a health API. A first implementation can focus on FileStateStore because FileStateStore is where stale JSON records are inspectable.

If a generic health API is needed later, it should be designed separately as a `StateStoreHealth` capability rather than forced into the base `StateStore` interface.

## 9. Relationship With Event Recovery

Stale waiting index entries affect `matchWaitingRuns` and `previewEventRecovery`. A health check should discover these problems, not block or rewrite event recovery behavior.

`recoverWaitingRuns` should not automatically ignore stale entries unless a future explicit policy says so. `tickRecoveredRuns` should not handle stale index state because it only consumes recovered FlowRun records already passed by the host.

Automatic wakeup is still not implemented.

## 10. Relationship With Repair APIs

Future repair-oriented APIs could include:

- `inspectWaitingIndex()`
- `createWaitingIndexRepairPlan()`
- `applyWaitingIndexRepairPlan()`
- `removeStaleWaitingEntry(runId)`

The default API posture should remain read-only. Destructive repair must require an explicit method call and should not run inside `checkHealth`.

## 11. Safety Rules

- `checkHealth` is read-only.
- No automatic cleanup.
- No automatic wakeup.
- No trigger execution.
- No exactly-once claim.
- No durable recovery claim.
- No deletion without an explicit repair API.
- Stale entries are reported as diagnostics only.

## 12. Tests Needed If Implemented

- Clean waiting index produces no waiting health issues.
- Missing ActionRun produces `waiting-index-missing-action-run`.
- Done ActionRun with a waiting entry produces `waiting-index-action-run-not-waiting`.
- Failed ActionRun with a waiting entry produces `waiting-index-action-run-not-waiting`.
- `waitReason` mismatch produces `waiting-index-wait-reason-mismatch`.
- Missing `flowRunId` produces `waiting-index-missing-flow-run-id`.
- Missing FlowRun produces `waiting-index-missing-flow-run`.
- `actionId` mismatch produces `waiting-index-action-id-mismatch`.
- `checkHealth` does not mutate waiting index entries.
- Corrupted waiting index JSON behavior is explicit.
- Existing batch health issues are still reported.
- Health status clean/dirty policy is deterministic.

## 13. Open Questions

- Should waiting index health checks be FileStateStore-only first?
- Should MemoryStateStore get a health API?
- Should issue objects include target file paths?
- Should stale entries make status dirty?
- Should missing FlowRun be warning or error?
- Should waitReason mismatch be warning or error?
- Should repair plan API come before implementation?
- Should health check scan all ActionRuns to find missing waiting index entries?
- Should waiting index be rebuildable from ActionRuns?
- Should a production database store expose stronger consistency checks?
