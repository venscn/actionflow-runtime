# ActionFlow Runtime

ActionFlow Runtime is a general-purpose action-level sliced flow runtime.

It runs serializable flows made of semantic actions. An action can complete immediately, fail, wait, or yield state so the runtime can resume it later within a time budget.

## What It Is

ActionFlow Runtime is a small TypeScript runtime for:

- registering versioned action definitions
- running instant actions once
- resuming sliceable actions across multiple slices
- scheduling multiple sliceable action runs within a frame budget
- executing simple flow definitions with action, sequence, and parallel nodes

The current implementation is intentionally small and in-memory.

## What It Is Not

ActionFlow Runtime is not an AI agent framework.

It does not depend on LLMs, AI APIs, prompt templates, model tools, or agent orchestration. Actions are regular TypeScript definitions. If a future action calls an external service, that side effect should be explicit in action metadata.

## Core Concepts

- **Action**: a versioned semantic operation definition.
- **ActionRun**: one execution instance of an action.
- **Slice**: one resumable execution step of a sliceable ActionRun.
- **Flow**: a JSON-serializable workflow definition made from nodes.
- **FlowRun**: one execution instance of a flow.
- **Runtime**: the combination of registry, flow engine, slice scheduler, and state store.

## Why "ActionFlow Runtime"

The runtime is organized around actions, not functions, jobs, or agents.

An Action is the semantic unit users compose into a Flow. The runtime then decides how to execute each action run: all at once for instant work, or across multiple slices for resumable work. "ActionFlow" names that relationship: semantic actions connected into executable flows.

## Relationship Model

```text
FlowDefinition
└─ FlowNode
   ├─ action node -> ActionDefinition
   │  └─ ActionRun
   │     └─ Slice, Slice, Slice...
   ├─ sequence node
   │  └─ ordered FlowNode steps
   └─ parallel node
      └─ concurrent FlowNode branches

FlowRun
├─ nodeRuns
└─ actionRuns
```

A Flow describes what should run. A FlowRun records one execution of that Flow. Each action node creates or resumes an ActionRun. Sliceable ActionRuns can yield state and continue on a later tick.

## Execution Modes

- **instant**: runs once with `run(input, context)` and returns `done` or `failed`.
- **async**: reserved in the type system, but not implemented yet.
- **sliceable**: starts with `start(input, context)` to create state, then advances with `resume(state, context)` until it yields, waits, fails, or completes.

## Quickstart

```sh
npm install
npm test
npm run example:basic
```

## Documentation

- [Architecture](docs/architecture.md)
- [Specification](docs/spec.md)

## Basic Parallel Example

Run:

```sh
npm run example:basic
```

The example registers three sliceable actions:

- `count.a`, counting from `0` to `2`
- `count.b`, counting from `0` to `3`
- `count.c`, counting from `0` to `4`

It builds a parallel flow with three branches and advances it with:

```ts
await engine.tick(flowRun, flow, { frameBudgetMs: 2, maxSliceMs: 1 });
```

Each tick advances a limited number of slices. The final outputs are:

```text
branch-a: 2
branch-b: 3
branch-c: 4
```

## Current Limits

Implemented:

- versioned `ActionRegistry`
- instant ActionRun execution
- sliceable ActionRun resume
- in-memory SliceScheduler
- FlowEngine support for action, sequence, and parallel nodes
- in-memory run records

Not implemented yet:

- async action behavior
- persistent state store integration
- variable or template binding between flow nodes
- durable event wakeup for waiting actions
- worker process execution
- permission enforcement
- package manifest format

## Roadmap

- Add async action execution and external wakeup support.
- Add persistent state storage for FlowRun and ActionRun records.
- Define package manifests for distributing action bundles.
- Add worker action execution for isolated or long-running work.
- Add event triggers that can start or resume flows.
- Add a permission model for explicit side effects and external access.
