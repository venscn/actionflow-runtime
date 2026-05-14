# Architecture

This document describes the current ActionFlow Runtime architecture and the intended extension points. It does not describe features that are not implemented yet as production-ready behavior.

## Component Tree

```text
ActionFlow Runtime
├─ ActionFlowRuntime
│  ├─ facade wiring registries, store, and FlowEngine
│  └─ package manifest validation and registry consistency convenience
├─ ActionRegistry
│  └─ versioned ActionDefinition lookup
├─ ActionRun
│  ├─ runActionOnce for instant actions
│  ├─ runAsyncActionOnce for minimal async actions
│  └─ resumeActionRun for sliceable actions
├─ SliceScheduler
│  └─ frame-budgeted scheduling for ready sliceable ActionRuns
├─ FlowEngine
│  ├─ action node execution
│  ├─ sequence node execution
│  └─ parallel node execution
├─ FlowRegistry
│  └─ in-memory versioned FlowDefinition lookup
├─ PackageManifest
│  ├─ descriptive package metadata validation
│  └─ optional action/flow registry consistency check
├─ EventTrigger
│  ├─ descriptive event-to-flow metadata validation
│  └─ in-memory EventTriggerRegistry
└─ StateStore
   └─ current in-memory store skeleton
```

## ActionFlowRuntime Facade

`ActionFlowRuntime` is a lightweight composition layer over the current runtime components.

By default it creates:

- `ActionRegistry`
- `FlowRegistry`
- `EventTriggerRegistry`
- `MemoryStateStore`
- `FlowEngine`

It provides convenience methods:

- `registerAction`
- `registerFlow`
- `registerTrigger`
- `createRun`
- `tick`
- `checkPackageManifest`

`createRun` and `tick` use `FlowRegistry` to resolve `FlowDefinition` records. `tick` saves the updated FlowRun and contained ActionRuns to the configured `StateStore`.

`checkPackageManifest` only performs manifest structure validation and action/flow registry consistency checks.

The facade does not add execution semantics. It does not automatically execute `EventTrigger` definitions, load package code, or provide persistent recovery.

## Action-Level Time Slicing

Sliceable actions split execution into resumable steps.

The runtime stores state on the ActionRun. A sliceable action starts by producing initial state, then each `resume(state, context)` call performs one step and returns one of:

- `yield`: save state and make the run ready again
- `done`: save output and complete the run
- `waiting`: save state and wait reason
- `failed`: save error and stop the run

`SliceScheduler` applies a frame budget and a per-slice budget. It advances ready runs and requeues only runs that yield back to `ready`.

Scheduling time uses runtime monotonic milliseconds, not wall-clock time. The values exposed through `ActionContext.now()`, `deadline()`, and `remainingMs()` are for frame and slice budget decisions.

Async action support currently lives in ActionRun and FlowEngine action-node execution. `runAsyncActionOnce` can await `action.run()` and record `done`, `waiting`, or `failed`; FlowEngine can turn async waiting results into waiting nodes or flows. Event triggers do not yet provide async waiting recovery.

## FlowEngine vs SliceScheduler

`FlowEngine` owns flow semantics:

- which node is current
- sequence order
- parallel branch status
- when a FlowRun is done, failed, waiting, or still running
- mapping flow nodes to ActionRuns

`SliceScheduler` owns time-sliced ActionRun scheduling:

- ready queue management
- frame budget accounting
- max slice budget assignment
- requeueing yielded runs
- excluding done, failed, and waiting runs from the ready queue

The scheduler does not know flow topology. The flow engine does not directly implement slice scheduling for parallel branches; it delegates ready sliceable ActionRuns to the scheduler.

## Sequence And Parallel Execution

Sequence execution is ordered:

```text
step 1 -> step 2 -> step 3
```

A sequence starts the next step only after the previous step is done. If a step fails, the sequence fails and later steps do not run. If a sliceable step yields, the flow remains running and the next tick resumes that same step.

Parallel execution advances branches together:

```text
parallel
├─ branch A
├─ branch B
└─ branch C
```

For sliceable branches, `FlowEngine` uses `SliceScheduler` so branches can advance under `frameBudgetMs` and `maxSliceMs`. Parallel completes only when all branches are done. Any failed branch fails the parallel node. Current waiting strategy: if active branches remain, parallel stays running; when only waiting branches remain, parallel becomes waiting.

## Semantic Atomicity And Sliced Execution

An Action is semantically atomic: it represents one meaningful operation in a flow, such as "count to N", "send message", or "process record".

Execution does not have to be atomic. A sliceable action can perform that semantic operation across multiple slices while preserving serializable state. This keeps the flow definition stable while allowing long-running or cooperative work to fit inside runtime time budgets.

## Side Effects

Side effects must be explicit in action metadata.

Current action definitions include `sideEffects: string[]`. The runtime does not enforce permissions yet, but action authors should declare reads, writes, external calls, console output, or other effects there. Future permission and package systems should use this metadata instead of inferring behavior from implementation details.

## Extension Directions

- **async action**: add external event recovery for waiting async actions.
- **state persistence**: persist FlowRun, ActionRun, node state, outputs, and errors outside memory.
- **package manifest**: define metadata for action bundles, versions, side effects, and compatibility.
- **worker action**: run actions in isolated workers or external processes.
- **event trigger**: currently a descriptive structure, validator, and in-memory registry only; future work can connect it to an event bus and waiting-action recovery.
- **flow lookup**: future EventTriggerRegistry integration can use FlowRegistry to resolve flow ids before starting or resuming flows.
- **permission model**: enforce declared side effects and external access policies.
