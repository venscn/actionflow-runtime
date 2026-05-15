# Waiting Index Repair Design

## 1. Problem

FileStateStore `checkHealth` can report stale waiting index diagnostics, but health checks are read-only and do not repair data.

Stale waiting index entries can come from several cases:

- A waiting index entry points to a missing ActionRun.
- The ActionRun is already done, failed, or ready, but the index remains.
- `waitReason` or `actionId` differs between the index entry and the ActionRun.
- `flowRunId` is missing or points to a missing FlowRun.

Users need an explicit repair API, but repair must not run inside `checkHealth`. If repair is too aggressive, it can delete waiting entries that are still valid.

## 2. Goals

- Design an explicit waiting index repair API.
- Base repair on health issues or a repair plan.
- Keep inspect and plan operations read-only by default.
- Require an explicit call for destructive repair.
- Keep `checkHealth` read-only.
- Avoid automatic waiting action wakeup.
- Avoid trigger execution.
- Avoid exactly-once claims.
- Avoid durable recovery claims.
- Leave room for a first FileStateStore implementation.

## 3. Non-Goals

- Automatic repair inside `checkHealth`.
- Automatic waiting wakeup.
- Trigger execution.
- Exactly-once recovery.
- Distributed locks.
- Database transactions.
- Production scheduler behavior.
- Event replay.
- Implicit deletion without an explicit call.

## 4. Current Health Inputs

Current FileStateStore health inputs:

- `FileStateStore.checkHealth()`
- `waitingIndexIssues`
- `waitingIndexIssueCount`
- `WaitingIndexHealthIssue` values with these types:
  - `waiting-index-missing-action-run`
  - `waiting-index-action-run-not-waiting`
  - `waiting-index-wait-reason-mismatch`
  - `waiting-index-missing-flow-run-id`
  - `waiting-index-missing-flow-run`
  - `waiting-index-action-id-mismatch`

## 5. Repair Strategy Options

### Strategy A: Manual delete by runId

Candidate API:

```ts
removeWaitingActionRun(runId)
```

This already exists on `WaitingIndexStore`. It is a low-level API, and the caller must decide whether deletion is safe.

### Strategy B: createRepairPlan()

Generate a repair plan from `checkHealth().waitingIndexIssues`. The plan describes actions but does not execute them.

### Strategy C: applyRepairPlan(plan)

Explicitly execute a plan. The first version should only touch waiting index entries and should not modify ActionRun or FlowRun records.

### Strategy D: rebuildWaitingIndexFromActionRuns()

Scan all ActionRun records with `status: "waiting"` and rebuild waiting index files. This has higher risk because it can drop metadata or preserve the wrong convention. It is not recommended for the first version.

Recommended first design: Strategy B plus Strategy C. Start with removing stale waiting index entries, and do not implement automatic rebuild.

## 6. Repair Plan Model

Implemented FileStateStore repair plan types:

```ts
type WaitingIndexRepairActionType = "remove-waiting-index-entry";

interface WaitingIndexRepairAction {
  type: WaitingIndexRepairActionType;
  runId: string;
  reason: string;
  issueTypes: WaitingIndexHealthIssueType[];
}

interface WaitingIndexRepairPlan {
  createdAt: string;
  actions: WaitingIndexRepairAction[];
  skippedIssues: WaitingIndexHealthIssue[];
}
```

Notes:

- The first version only allows `remove-waiting-index-entry`.
- The plan does not modify ActionRun or FlowRun records.
- `skippedIssues` records issues that cannot be safely repaired by default.
- The plan should be JSON-serializable.

## 7. Issue-to-Repair Mapping

Issues that can produce a remove action:

- `waiting-index-missing-action-run`
- `waiting-index-action-run-not-waiting`
- `waiting-index-missing-flow-run`
- `waiting-index-missing-flow-run-id`

Issues that should be skipped by default:

- `waiting-index-wait-reason-mismatch`
- `waiting-index-action-id-mismatch`

Mismatch cases are ambiguous: either the ActionRun or the index entry may be stale. The first repair version should put mismatch issues in `skippedIssues` unless an explicit option opts in.

## 8. Candidate APIs

Implemented FileStateStore APIs:

```ts
createWaitingIndexRepairPlan(options?: WaitingIndexRepairPlanOptions): WaitingIndexRepairPlan;

applyWaitingIndexRepairPlan(plan: WaitingIndexRepairPlan): WaitingIndexRepairResult;

interface WaitingIndexRepairPlanOptions {
  includeMismatches?: boolean;
}

interface WaitingIndexRepairResult {
  appliedAt: string;
  removedRunIds: string[];
  skippedRunIds: string[];
  errors: Array<{ runId: string; message: string }>;
}
```

Rules:

- `includeMismatches` defaults to `false`.
- `createWaitingIndexRepairPlan` is read-only.
- `applyWaitingIndexRepairPlan` only deletes waiting index entries.
- If an entry is already missing, it is reported in `skippedRunIds`.
- Per-action filesystem errors are reported structurally and do not stop later actions.
- Options validation errors can throw.

## 9. Safety Rules

- `checkHealth` does not repair.
- Creating a plan does not repair.
- Applying a plan is the only repair operation.
- Applying a plan only deletes waiting index entries.
- Do not delete ActionRun records.
- Do not delete FlowRun records.
- Do not execute `tick`.
- Do not wake waiting actions.
- Do not execute triggers.
- Do not claim exactly-once behavior.
- Do not claim durable recovery.
- All destructive operations are explicit.

## 10. FileStateStore First Implementation Scope

First implementation scope is:

- FileStateStore only.
- Use existing `checkHealth().waitingIndexIssues`.
- Create repair plans from current health issues.
- Apply plans by calling `removeWaitingActionRun(runId)`.
- Do not implement MemoryStateStore repair.
- Do not implement index rebuild.

## 11. Relationship With Event Recovery

Repair APIs affect future `matchWaitingRuns` and `previewEventRecovery` results by removing stale waiting index entries.

Repair should not call `recoverWaitingRuns`, should not call `tickRecoveredRuns`, and should not start recovery work. If a stale entry is deleted, a later event match may no longer return it. That is explicit user repair, not automatic wakeup.

## 12. Relationship With Processed Events

Waiting index repair should not modify `ProcessedEventRecord` data.

Processed event records cannot prove the waiting index has been repaired. If `recoverWaitingRuns` previously recorded `matchedRunIds`, repair should not rewrite those records.

Exactly-once behavior is still not implemented.

## 13. Relationship With EventTriggerRegistry

Repair APIs do not execute `EventTriggerRegistry`.

Future trigger start-flow design is a separate path. Repair should not create a new FlowRun.

## 14. Tests

Implemented tests cover:

- `createWaitingIndexRepairPlan` returns an empty plan for clean health.
- `createWaitingIndexRepairPlan` creates a remove action for missing ActionRun.
- `createWaitingIndexRepairPlan` creates a remove action for ActionRun not waiting.
- `createWaitingIndexRepairPlan` creates a remove action for missing FlowRun.
- `createWaitingIndexRepairPlan` creates a remove action for missing `flowRunId`.
- `createWaitingIndexRepairPlan` skips waitReason mismatch by default.
- `createWaitingIndexRepairPlan` skips actionId mismatch by default.
- `includeMismatches` includes mismatch remove actions.
- Multiple repairable issues for one runId are merged into one action.
- `applyWaitingIndexRepairPlan` removes waiting index entries.
- `applyWaitingIndexRepairPlan` does not delete ActionRun records.
- `applyWaitingIndexRepairPlan` does not delete FlowRun records.
- `applyWaitingIndexRepairPlan` is explicit and `checkHealth` remains read-only.
- `applyWaitingIndexRepairPlan` handles an already missing entry as skipped.
- `applyWaitingIndexRepairPlan` reports invalid action type and invalid runId as structured errors.
- Repair does not wake waiting actions.

Future tests should cover:

- Partial filesystem delete errors if a stable filesystem simulation is added.
- MemoryStateStore repair APIs if that store ever exposes repair behavior.

## 15. Open Questions

- Should mismatch issues be auto-removable?
- Should repair plans include file paths?
- Should `applyRepairPlan` throw or collect errors?
- Should plans include an expected issue hash or version?
- Should repair plans expire?
- Should `rebuildWaitingIndexFromActionRuns` be added later?
- Should MemoryStateStore get repair APIs?
- Should production stores use transactions for repair?
- Should repair be exposed from ActionFlowRuntime or only FileStateStore?
