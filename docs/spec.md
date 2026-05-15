# ActionFlow Runtime Specification

## 1. Scope

This specification describes the core behavior currently implemented in ActionFlow Runtime:

- versioned action registration
- instant ActionRun execution
- minimal async ActionRun execution
- sliceable ActionRun start/resume/yield/done/waiting/failed handling
- frame-budgeted slice scheduling
- FlowEngine execution for action, sequence, and parallel nodes
- ActionFlowRuntime facade composition for core in-memory components
- in-memory FlowRegistry management for FlowDefinition records
- in-memory run records used by the current runtime
- FileStateStore local JSON persistence for ActionRun and FlowRun records
- package manifest shape, lightweight validation, and optional registry consistency checks
- event trigger shape, lightweight validation, and in-memory registry

This specification does not cover a complete distributed workflow system, persistent recovery protocol, plugin marketplace, dynamic code loading, permission enforcement system, or AI agent framework.

ActionFlow Runtime is not an AI Agent framework. It does not define prompts, LLM tool calls, model selection, agent planning, or AI API integration.

ActionFlow Runtime is not a plugin market. It has a minimal package manifest description, validator, and optional registry consistency check, but no publishing protocol, dependency resolution, registry service, dynamic code loading, sandbox, or permission execution.

ActionFlow Runtime is not a distributed workflow system. The current implementation is local and in-memory.

## 2. Core Terms

- **Action**: a versioned semantic operation definition registered in `ActionRegistry`.
- **ActionRun**: one execution instance of an Action, with input, status, optional state, output, and error.
- **Slice**: one resumable execution step of a sliceable ActionRun.
- **Flow**: a JSON-serializable workflow definition with a root `FlowNode`.
- **FlowRun**: one execution instance of a Flow, including node run records and action run records.
- **FlowNode**: a node inside a Flow. Current node kinds are `action`, `sequence`, and `parallel`.
- **FlowRegistry**: an in-memory registry for versioned FlowDefinition records.
- **SliceScheduler**: the component that advances ready sliceable ActionRuns within frame and slice budgets.
- **FlowEngine**: the component that applies Flow semantics and delegates action execution to ActionRun helpers and SliceScheduler.
- **ActionFlowRuntime**: a lightweight facade that wires registries, store, and FlowEngine together.
- **StateStore**: storage abstraction for run records. Current implementations include MemoryStateStore and FileStateStore. FileStateStore persists ActionRun / FlowRun records only. `BatchStateStore` is an optional extension currently implemented by MemoryStateStore and FileStateStore. `WaitingIndexStore` is an optional extension currently implemented by MemoryStateStore and FileStateStore. `ProcessedEventStore` is an optional extension currently implemented by MemoryStateStore and FileStateStore. ActionFlowRuntime exposes explicit processed event accessors, but it does not automatically write processed event records during event matching or preview.
- **Package Manifest**: a descriptive package metadata object for actions, flows, rules, config schema, and permission labels. Current support is validation and optional action/flow registry consistency checks.
- **Event Trigger**: a descriptive rule that maps an event name to a flow id. Current support is validation and in-memory definition management only.

## 3. Action Definition

An `ActionDefinition<I, O, S>` defines a reusable action:

- `id`: stable action identifier used by flow action nodes.
- `version`: action definition version.
- `mode`: execution mode, one of `instant`, `async`, or `sliceable`.
- `inputSchema`: placeholder for input validation metadata.
- `outputSchema`: placeholder for output validation metadata.
- `stateSchema`: placeholder for serializable state validation metadata.
- `sideEffects`: explicit side effect labels declared by the action author.
- `start`: optional function used by sliceable actions to create initial state.
- `run`: optional function used by instant actions.
- `resume`: optional function used by sliceable actions to advance from saved state.

Action functions receive an `ActionContext`. Its `now()` and `deadline()` values are runtime monotonic milliseconds, not wall-clock time. They are intended for scheduling budgets and yield decisions.

Execution modes:

- **instant**: implemented. The runtime calls `run(input, context)` once.
- **async**: implemented for direct ActionRun execution through `runAsyncActionOnce` and for FlowEngine action nodes. Waiting actions can move a node or flow to `waiting`, but there is no event recovery system.
- **sliceable**: implemented. The runtime calls `start(input, context)` if no state exists, then calls `resume(state, context)` on each slice.

## 4. ActionResult

`ActionResult<O, S>` has four result variants:

- `yield`: the action saves `state`, ActionRun status becomes `ready`, and the run can be scheduled again.
- `done`: the action saves `output`, ActionRun status becomes `done`, and the run is complete.
- `waiting`: the action saves `state` and `reason`, ActionRun status becomes `waiting`, and the run is not requeued.
- `failed`: the action saves `error`, ActionRun status becomes `failed`, and the run is not requeued.

For instant actions, current `runActionOnce` supports `done` and `failed`. Other result types from an instant action are treated as unsupported and produce a failed ActionRun.

For async actions, `runAsyncActionOnce` supports `done`, `waiting`, and `failed`. A `yield` result is currently unsupported for async actions and produces a failed ActionRun while preserving returned state.

## 5. ActionRun Lifecycle

ActionRun statuses:

- `ready`: available to be run or resumed.
- `running`: currently being advanced.
- `waiting`: paused on an external condition or event.
- `done`: completed successfully.
- `failed`: completed with an error.

Sliceable lifecycle:

```text
createActionRun
└─ ready
   └─ start(input, context) if state is empty
      └─ resume(state, context)
         ├─ yield -> save state -> ready
         ├─ resume again
         ├─ done -> save output -> done
         ├─ waiting -> save state and waitReason -> waiting
         └─ failed -> save error -> failed
```

`runAsyncActionOnce` provides minimal async action execution. It can produce `done`, `waiting`, or `failed`, and FlowEngine can execute async action nodes. It does not connect waiting actions to an event trigger or external resume system. `resumeActionRun` remains sliceable-only. If called with a non-sliceable action, it returns a failed ActionRun.

Runtime-generated `ActionRunRecord` values should omit optional fields when their value is `undefined`. This matters because `FileStateStore` rejects `undefined` as non-JSON-compatible data. For example, a yielded sliceable action should save `state`, but should not include `output`, `error`, or `waitReason` fields if those values are undefined.

## 6. Flow Definition

Current `FlowDefinition` uses a single root node:

```ts
{
  id: string;
  version: string;
  root: FlowNode;
}
```

Supported `FlowNode` kinds:

- `action`
- `sequence`
- `parallel`

JSON example:

```json
{
  "id": "example-flow",
  "version": "1.0.0",
  "root": {
    "type": "parallel",
    "id": "parallel-root",
    "branches": [
      {
        "type": "action",
        "id": "branch-a",
        "action": "count.a",
        "input": 0
      },
      {
        "type": "sequence",
        "id": "branch-b-sequence",
        "steps": [
          {
            "type": "action",
            "id": "branch-b-step-1",
            "action": "count.b",
            "input": 0
          }
        ]
      }
    ]
  }
}
```

## 7. Sequence Semantics

A sequence node has ordered `steps`.

- Steps execute in order.
- The next step starts only after the previous step is `done`.
- If a step becomes `failed`, the sequence becomes `failed` and later steps do not execute.
- If a sliceable action step yields, the FlowRun remains `running`; the next tick continues the same node.
- A sequence becomes `done` when all steps are done.

## 8. FlowRegistry

`FlowRegistry` manages `FlowDefinition` records in memory.

- It supports registration, lookup by id, lookup by id and version, listing, deletion, and clearing.
- `get(id)` returns the latest registered version for that id using simple dotted-version comparison, not full semver.
- It validates only the minimal flow shape: non-empty `id`, non-empty `version`, and a present `root`.
- It does not execute flows.
- It does not persist flows.
- It does not automatically integrate with `EventTriggerRegistry`.

## 9. ActionFlowRuntime

`ActionFlowRuntime` is a convenience facade over the current in-memory components.

- It creates default `ActionRegistry`, `FlowRegistry`, `EventTriggerRegistry`, `MemoryStateStore`, and `FlowEngine` instances when dependencies are not provided.
- The default store remains `MemoryStateStore`.
- `FileStateStore` can be injected through dependencies.
- It exposes `actions`, `flows`, `triggers`, `store`, and `engine`.
- `createRun(flowId, runId, version?)` resolves a flow from `FlowRegistry`, creates a FlowRun through `FlowEngine`, saves it to the store, and returns it.
- `tick(run, flowId, options?, version?)` resolves a flow, advances it through `FlowEngine`, saves the updated FlowRun, and saves contained ActionRuns.
- When the configured store supports `saveRunBatch`, `tick` uses it to save the FlowRun and ActionRuns; otherwise it falls back to individual `saveFlowRun` and `saveActionRun` calls.
- When the configured store supports `WaitingIndexStore`, `tick` updates the waiting index after FlowRun and ActionRun persistence succeeds.
- Waiting index updates do not wake or resume waiting actions.
- `restoreRun(flowRunId)` reloads a saved FlowRun from `StateStore`, fills missing FlowEngine record fields, and merges stored ActionRuns whose run ids start with the FlowRun id.
- `matchWaitingRuns(event)` queries `WaitingIndexStore` by matching `event.name` against `waitReason`.
- `matchWaitingRuns(event)` is read-only and returns matched waiting entries only.
- `matchWaitingRuns(event)` does not restore, tick, wake waiting actions, or execute triggers.
- `previewEventRecovery(event)` matches waiting entries and attempts `restoreRun` preview for matched `flowRunId` values.
- `previewEventRecovery(event)` returns skipped entries for missing `flowRunId` or missing FlowRun records.
- `previewEventRecovery(event)` does not tick, wake waiting actions, or execute triggers.
- `recoverWaitingRuns(event)` currently returns match/preview recovery results.
- `recoverWaitingRuns(event)` records processed event `started`, `completed`, and `failed` attempts when `ProcessedEventStore` is supported.
- `recoverWaitingRuns(event, { duplicatePolicy: "skip-completed" })` skips completed processed events when `ProcessedEventStore` is supported.
- The default duplicate policy is `observe`.
- `skip-completed` returns `eventSkipped` and does not mutate the completed processed event record.
- `recoverWaitingRuns(event)` does not tick, wake waiting actions, execute triggers, or provide exactly-once behavior.
- `tickRecoveredRuns(result, options)` can explicitly tick recovered runs from a preview/recovery result.
- `tickRecoveredRuns` defaults to `maxRuns: 1`.
- `tickRecoveredRuns` supports `dryRun` and `continueOnError`.
- `tickRecoveredRuns` does not execute triggers or write processed event records.
- `getProcessedEvent`, `saveProcessedEvent`, `listProcessedEvents`, and `deleteProcessedEvent` proxy to `ProcessedEventStore` when supported.
- `saveProcessedEvent` throws if the configured store does not support `ProcessedEventStore`.
- `matchWaitingRuns` and `previewEventRecovery` do not automatically write processed event records.
- `checkPackageManifest(manifest)` first validates manifest structure, then checks referenced actions and flows against the runtime registries.
- It does not add new execution semantics.
- It does not install packages, load code, or execute flows during package checks.
- It does not automatically execute triggers.
- It does not automatically continue restored runs.
- It does not provide persistent recovery.
- Injecting `FileStateStore` does not add durable recovery.

## 10. Parallel Semantics

A parallel node has `branches`.

- Branches enter ready execution together.
- Each action branch has an independent ActionRun.
- Sliceable action branches are advanced through `SliceScheduler`.
- Parallel becomes `done` only when all branches are `done`.
- If any branch becomes `failed`, parallel becomes `failed`.
- If active branches remain, parallel stays `running`.
- If only waiting branches remain, parallel becomes `waiting`.
- With small `frameBudgetMs`, branches may complete across multiple ticks and are advanced in a rotating order rather than fully completing one branch before starting the next.

## 11. SliceScheduler Semantics

`SliceScheduler` manages ready sliceable ActionRuns.

- `frameBudgetMs`: total budget for one scheduling frame.
- `maxSliceMs`: maximum budget assigned to one ActionRun slice.
- Scheduling time uses runtime monotonic milliseconds, not wall-clock time.
- Ready queue: stores ActionRuns whose status is `ready`.
- After `yield`, the run status becomes `ready` and the scheduler requeues it.
- After `done`, `failed`, or `waiting`, the run is not requeued.
- `getRun(runId)` returns the latest scheduler-held ActionRunRecord.
- `listRuns()` returns all scheduler-managed ActionRunRecords.

`FrameReport` fields:

- `startedAt`
- `endedAt`
- `budgetMs`
- `consumedMs`
- `slicesRun`
- `completedRuns`
- `yieldedRuns`
- `failedRuns`
- `waitingRuns`

## 12. FileStateStore

`FileStateStore` implements `StateStore`.

- It stores ActionRun and FlowRun records as JSON files under a configured `rootDir`.
- It uses file envelopes with `schemaVersion`, `kind`, `savedAt`, and `data`.
- It uses `safeFileName` for ids.
- It uses `createEnvelope` and `parseEnvelope` for file format handling.
- It rejects non-JSON-compatible data.
- It implements best-effort `saveRunBatch` for ActionRun / FlowRun records.
- `saveRunBatch` writes a pending batch manifest before best-effort record writes.
- `saveRunBatch` writes staging record envelopes and validates they can be parsed before best-effort target writes.
- `saveRunBatch` writes a committed marker after successful best-effort target writes.
- After a batch fails and the pending manifest exists, `saveRunBatch` tries to write a failed marker.
- Staging records are validation and diagnostic groundwork only.
- `listPendingBatches()` can list and parse pending batch manifests.
- `listCommittedBatches()` can list and parse committed markers.
- `listFailedBatches()` can list and parse failed markers.
- `checkHealth()` summarizes pending, committed, and failed batch marker counts.
- `checkHealth()` can report issue records for pending batches, failed batches, and missing committed target files.
- Pending manifests are diagnostic only.
- Committed markers are diagnostic only and do not make batch writes atomic.
- Failed markers are best-effort diagnostics only and do not roll back or recover partial writes.
- `checkHealth()` is diagnostic only and does not repair, recover, roll back, delete markers, or validate full data consistency.
- Missing target file reports do not perform repair.
- A `clean` health status does not mean durable recovery is guaranteed.
- `listPendingBatches()` does not mutate pending batches.
- Invalid or corrupted pending manifests are reported as errors.
- It implements `WaitingIndexStore` using `waiting-runs` JSON files.
- When configured on `ActionFlowRuntime`, runtime can maintain the waiting index after successful persistence.
- It can persist yielded sliceable ActionRun records as long as action state is JSON-compatible.
- It can be used with `ActionFlowRuntime.restoreRun` for local record reload.
- `restoreRun` can reload yielded sliceable ActionRun records, and a later explicit `tick` can continue execution.
- It is useful for local development and inspection.
- It is not a durable recovery system.
- It does not provide atomic multi-file transactions.
- It does not implement rollback or atomic recovery.
- It does not persist FlowDefinition or EventTriggerDefinition.
- It does not provide event recovery.
- It does not guarantee multi-process write safety.

`WaitingIndexStore` is an optional StateStore extension for querying waiting ActionRun records:

- It indexes ActionRuns with `status: "waiting"` and a non-empty `waitReason`.
- It supports filtering by `waitReason`, `flowRunId`, and `actionId`.
- It is currently implemented by MemoryStateStore and FileStateStore.
- FileStateStore stores waiting index entries under `waiting-runs` JSON files.
- Runtime updates it from `ActionFlowRuntime.tick` when the configured store supports the optional interface.
- Event recovery and automatic wakeup are not implemented.

`ProcessedEventStore` is an optional StateStore extension for processed event id tracking:

- It defines `ProcessedEventRecord` with `started`, `completed`, and `failed` statuses.
- It defines methods for getting, saving, listing, and deleting processed event records.
- `supportsProcessedEvents(store)` detects the optional interface.
- It is currently implemented by MemoryStateStore and FileStateStore.
- FileStateStore stores processed event records under `processed-events` JSON files.
- ActionFlowRuntime exposes explicit processed event accessors.
- Runtime does not automatically write processed event records during matching or preview.
- Exactly-once and durable event recovery are not implemented.

## 13. Current Limitations

The following are not implemented:

- async action has ActionRun-level support and FlowEngine action-node support, but there is no event recovery system.
- FileStateStore exists for local ActionRun / FlowRun JSON persistence, but durable recovery, database stores, FlowDefinition persistence, and EventTrigger persistence are not implemented.
- FileStateStore pending manifests, staging record writes, committed markers, failed markers, and health checks exist, but rollback and atomic batch recovery are not implemented.
- WaitingIndexStore exists for MemoryStateStore, FileStateStore, Runtime tick integration, read-only `matchWaitingRuns`, read-only `previewEventRecovery`, match/preview-only `recoverWaitingRuns`, and explicit `tickRecoveredRuns`, but automatic wakeup, durable recovery, retry-failed / stale-started duplicate policies, exactly-once behavior, and event trigger execution are not implemented.
- ProcessedEventStore is implemented by MemoryStateStore and FileStateStore and exposed through explicit ActionFlowRuntime accessors. `recoverWaitingRuns` supports explicit `skip-completed` duplicate policy, but exactly-once behavior, automatic wakeup, event trigger execution, and durable event recovery are not implemented.
- Package Manifest support is limited to a description format, lightweight validator, and optional registry consistency check; it does not load external code, resolve dependencies, or execute permissions.
- There is no permission model.
- There is no sandbox.
- There is no worker action support.
- There is no variable template system.
- Event Trigger support is limited to a description format, lightweight validator, and in-memory registry; it does not automatically start flows or recover waiting async actions.
- There is no complete schema validation.

## 14. Event Trigger Definition

`EventTriggerDefinition` is a descriptive structure for future event-based flow starts and waiting-action recovery:

- `id`: stable trigger identifier.
- `event`: event name to match.
- `flow`: flow id associated with the trigger.
- `enabled`: optional boolean flag.
- `description`: optional description.
- `filter`: placeholder for future event matching metadata.
- `input`: placeholder for future flow input mapping.

Current support includes `EventTriggerDefinition`, `validateEventTrigger(trigger)`, and `EventTriggerRegistry`. The registry only manages trigger definitions in memory. It does not validate whether the target flow exists, automatically start flows, provide an event bus, or resume waiting async actions from events.

## 15. Compatibility Rules

Future development should preserve these rules:

- Flow definitions must be JSON-serializable.
- Sliceable action state should be serializable.
- Action side effects must be explicitly declared in `sideEffects`.
- Runtime code must not assume every action is sliceable.
- FlowEngine must not bypass the ActionRun lifecycle when executing action nodes.
