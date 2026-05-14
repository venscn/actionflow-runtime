# ActionFlow Runtime

ActionFlow Runtime is a general-purpose action-level sliced flow runtime.

It runs serializable flows made of semantic actions. An action can complete immediately, fail, wait, or yield state so the runtime can resume it later within a time budget.

## What It Is

ActionFlow Runtime is a small TypeScript runtime for:

- registering versioned action definitions with `ActionRegistry`
- registering versioned flow definitions with `FlowRegistry`
- managing event trigger definitions with `EventTriggerRegistry`
- validating package manifests and optionally checking referenced actions/flows against registries
- running instant actions once
- running minimal async actions through ActionRun and FlowEngine action nodes
- resuming sliceable actions across multiple slices
- scheduling multiple sliceable action runs within a frame budget
- executing simple flow definitions with action, sequence, and parallel nodes
- composing the core pieces through `ActionFlowRuntime`

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
- **FlowRegistry**: an in-memory registry for versioned Flow definitions.
- **EventTrigger**: a descriptive event-to-flow rule; currently stored and validated, not executed.
- **PackageManifest**: package metadata for actions, flows, rules, config, and permission labels; currently validated and optionally checked against registries.
- **ActionFlowRuntime**: a facade that wires registries, store, and FlowEngine together.
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

- **instant**: implemented through `run(input, context)`.
- **async**: supported through `runAsyncActionOnce` and FlowEngine action nodes; waiting can move flows to `waiting`, but there is no event recovery system yet.
- **sliceable**: implemented through `start` / `resume` / `yield` / `done` / `waiting` / `failed`.

## Quickstart

```sh
npm install
npm test
npm run example:basic
```

## Documentation

- [Architecture](docs/architecture.md)
- [Specification](docs/spec.md)
- [State Persistence Design](docs/state-persistence-design.md)
- [FileStateStore MVP Plan](docs/file-state-store-plan.md)

## Facade Example

```ts
import { ActionFlowRuntime } from "actionflow-runtime";

const runtime = new ActionFlowRuntime();

runtime.registerAction(action);
runtime.registerFlow(flow);

let run = runtime.createRun("flow.basic", "flow-run-1");
run = await runtime.tick(run, "flow.basic");

const packageCheck = runtime.checkPackageManifest(manifest);
```

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
- minimal async action execution
- sliceable ActionRun resume
- in-memory SliceScheduler
- FlowEngine support for action, sequence, and parallel nodes
- FlowEngine support for async action nodes
- FlowRegistry
- EventTriggerDefinition / EventTriggerRegistry
- PackageManifest validation
- runtime package manifest checks
- ActionFlowRuntime facade
- shared simple version comparison
- in-memory run records

Not implemented yet:

- persistent state store integration
- variable/template binding between flow nodes
- durable event wakeup for waiting actions
- worker process execution
- permission enforcement
- event bus / automatic trigger execution
- full schema validation
- package loading / installation

## Roadmap

- Event recovery for waiting async actions.
- Persistent state storage for FlowRun and ActionRun records.
- Package loading / compatibility / permissions.
- Worker action execution.
- Event bus.
- Permission model.
