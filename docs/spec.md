# ActionFlow Runtime Specification

## 1. Scope

This specification describes the core behavior currently implemented in ActionFlow Runtime:

- versioned action registration
- instant ActionRun execution
- minimal async ActionRun execution
- sliceable ActionRun start/resume/yield/done/waiting/failed handling
- frame-budgeted slice scheduling
- FlowEngine execution for action, sequence, and parallel nodes
- in-memory run records used by the current runtime
- package manifest shape and lightweight validation
- event trigger shape and lightweight validation

This specification does not cover a complete distributed workflow system, persistent recovery protocol, plugin marketplace, dynamic code loading, permission enforcement system, or AI agent framework.

ActionFlow Runtime is not an AI Agent framework. It does not define prompts, LLM tool calls, model selection, agent planning, or AI API integration.

ActionFlow Runtime is not a plugin market. It has a minimal package manifest description and validator, but no publishing protocol, dependency resolution, registry service, dynamic code loading, sandbox, or permission execution.

ActionFlow Runtime is not a distributed workflow system. The current implementation is local and in-memory.

## 2. Core Terms

- **Action**: a versioned semantic operation definition registered in `ActionRegistry`.
- **ActionRun**: one execution instance of an Action, with input, status, optional state, output, and error.
- **Slice**: one resumable execution step of a sliceable ActionRun.
- **Flow**: a JSON-serializable workflow definition with a root `FlowNode`.
- **FlowRun**: one execution instance of a Flow, including node run records and action run records.
- **FlowNode**: a node inside a Flow. Current node kinds are `action`, `sequence`, and `parallel`.
- **SliceScheduler**: the component that advances ready sliceable ActionRuns within frame and slice budgets.
- **FlowEngine**: the component that applies Flow semantics and delegates action execution to ActionRun helpers and SliceScheduler.
- **StateStore**: the storage abstraction for run records. Current implementation is an in-memory skeleton, not a durable recovery system.
- **Package Manifest**: a descriptive package metadata object for actions, flows, rules, config schema, and permission labels. Current support is validation only.
- **Event Trigger**: a descriptive rule that maps an event name to a flow id. Current support is validation only.

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

## 8. Parallel Semantics

A parallel node has `branches`.

- Branches enter ready execution together.
- Each action branch has an independent ActionRun.
- Sliceable action branches are advanced through `SliceScheduler`.
- Parallel becomes `done` only when all branches are `done`.
- If any branch becomes `failed`, parallel becomes `failed`.
- If active branches remain, parallel stays `running`.
- If only waiting branches remain, parallel becomes `waiting`.
- With small `frameBudgetMs`, branches may complete across multiple ticks and are advanced in a rotating order rather than fully completing one branch before starting the next.

## 9. SliceScheduler Semantics

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

## 10. Current Limitations

The following are not implemented:

- async action has ActionRun-level support and FlowEngine action-node support, but there is no event recovery system.
- StateStore is currently an in-memory skeleton/basic record store, not a persistence or recovery system.
- Package Manifest support is only a description format and lightweight validator; it does not load external code.
- There is no permission model.
- There is no sandbox.
- There is no worker action support.
- There is no variable template system.
- Event Trigger support is only a description format and lightweight validator; it does not automatically start flows or recover waiting async actions.
- There is no complete schema validation.

## 11. Event Trigger Definition

`EventTriggerDefinition` is a descriptive structure for future event-based flow starts and waiting-action recovery:

- `id`: stable trigger identifier.
- `event`: event name to match.
- `flow`: flow id associated with the trigger.
- `enabled`: optional boolean flag.
- `description`: optional description.
- `filter`: placeholder for future event matching metadata.
- `input`: placeholder for future flow input mapping.

Current support is limited to `validateEventTrigger(trigger)`. The runtime does not automatically start flows from triggers and does not resume waiting async actions from events.

## 12. Compatibility Rules

Future development should preserve these rules:

- Flow definitions must be JSON-serializable.
- Sliceable action state should be serializable.
- Action side effects must be explicitly declared in `sideEffects`.
- Runtime code must not assume every action is sliceable.
- FlowEngine must not bypass the ActionRun lifecycle when executing action nodes.
