# State Persistence Design

This document designs future persistence and recovery support for ActionFlow Runtime. It describes a path beyond the current `MemoryStateStore`; it does not describe behavior that is already implemented.

## 1. Goals

The persistence system should eventually support:

- Saving `FlowRun` records.
- Saving `ActionRun` records.
- Saving `nodeRuns` for flow node execution state.
- Saving action `state`, `output`, `error`, and `waitReason`.
- Restoring runnable flow state after process restart.
- Resuming waiting actions after a later signal or event.
- Supporting future event recovery.

The design should preserve the current runtime model: `FlowEngine` owns flow semantics, `ActionRun` helpers own action lifecycle transitions, and `SliceScheduler` owns frame-budgeted slice scheduling.

## 2. Non-Goals

This design does not attempt to define:

- Distributed queues.
- Multi-node scheduling.
- Highly available database architecture.
- Complex transaction systems.
- Plugin markets.
- Remote execution.
- A complete event bus.

The first persistence implementation should be small and local.

## 3. Persisted Records

Records that may need persistence:

- `FlowRunRecord`
- `FlowEngineRunRecord`
- `FlowNodeRunRecord`
- `ActionRunRecord`
- `EventTriggerDefinition`
- `FlowDefinition`
- Action definition metadata only, not executable function bodies

JSON-serializable data:

- `FlowDefinition`
- `FlowNode`
- flow node `input`, if restricted to JSON-compatible values
- `ActionRunRecord.state`, when produced by a sliceable action that follows the serializable state rule
- `ActionRunRecord.output`, when the action output is JSON-compatible
- `waitReason`
- trigger and package manifest definitions

Not directly persistable:

- Action function bodies: `start`, `run`, and `resume`
- Closures captured by action implementations
- Native `Error` objects without serialization
- Non-JSON values such as functions, symbols, class instances, streams, sockets, or file handles

Action executable code should be registered again by the host process before recovery.

## 4. StateStore Interface Evolution

The current `StateStore` interface includes:

- `saveActionRun`
- `getActionRun`
- `listActionRuns`
- `saveFlowRun`
- `getFlowRun`
- `listFlowRuns`
- `deleteActionRun`
- `deleteFlowRun`
- `clear`

Future interface additions may include:

- `saveFlowDefinition`
- `getFlowDefinition`
- `saveEventTrigger`
- `listWaitingRuns`
- `listRunnableRuns`
- transaction-like batch save

Batch save matters because a single tick can update both a `FlowRun` and multiple `ActionRun` records. Early implementations can write sequentially and fail explicitly. A later durable store can add atomic batch behavior.

## 5. Recovery Model

A future recovery flow could work as follows:

1. Load a persisted `FlowRun`.
2. Load associated `ActionRun` records.
3. Reconstruct a `FlowEngineRunRecord`.
4. Resolve `flowId` through `FlowRegistry` to find the `FlowDefinition`.
5. Call `tick` to continue execution.
6. Leave `waiting` runs paused until an external event wakes them.

Recovery should not recreate action functions from persisted data. The runtime process must register compatible action definitions before resuming.

## 6. Waiting Recovery

Waiting actions need a separate recovery path.

- A waiting action does not enter the ready queue.
- `waitReason` explains why it is waiting, but it is not a complete wakeup protocol.
- Future event recovery needs event correlation.
- `EventTriggerRegistry` currently only describes event-to-flow relationships.
- A future `WaitingIndex` may be needed to map events to waiting `ActionRun` or `FlowRun` records.

The runtime should keep waiting recovery explicit. An event should not silently resume arbitrary runs without a clear correlation rule.

## 7. Serialization Rules

Persistence-compatible data should follow these rules:

- `FlowDefinition` must be JSON-serializable.
- `FlowNode.input` must be JSON-compatible.
- Sliceable action state should be JSON-compatible.
- Output serialization needs an explicit strategy.
- Error serialization needs a safe strategy, such as `{ name, message, stack?, cause? }`.
- Function bodies are not persisted.
- `ActionDefinition` code is provided by runtime registration on startup.

If a value cannot be serialized safely, the store should fail explicitly rather than writing partial or misleading data.

## 8. Store Implementations

Possible store layers:

- `MemoryStateStore`: current in-memory implementation for tests and simple runtime use.
- `FileStateStore`: future local development implementation using JSON files.
- `SQLiteStateStore`: future single-machine reliable implementation.
- `PostgresStateStore`: future service-side implementation.

Suggested implementation priority:

1. `FileStateStore`
2. `SQLiteStateStore`
3. `PostgresStateStore`

`FileStateStore` is the best next step because it can validate serialization boundaries without forcing database design too early.

## 9. Versioning And Migration

Persisted recovery depends on version compatibility:

- action version
- flow version
- package version
- persisted record schema version

Recovery should initially require exact or clearly compatible versions. If an action or flow version is missing or incompatible, the runtime should fail explicitly with a useful error.

Automatic migration is not part of the first persistence phase. Migration can be added later once record schemas and package manifests stabilize.

## 10. Failure Handling

Failure cases should be explicit:

- Save failure: return or throw a store-level error; do not pretend the run was persisted.
- Recovery failure: fail before ticking the recovered run.
- Missing action: fail with the missing action id and version.
- Missing flow: fail with the missing flow id and version.
- Version mismatch: fail explicitly; do not pick a different version silently.
- State schema mismatch: fail explicitly once schema validation exists.
- Corrupted persisted data: reject the record and report which record failed.

Partial writes should be avoided in durable implementations. Until batch save exists, the runtime should document which operations are best-effort.

## 11. Minimal Implementation Plan

Phase 1: Clarify StateStore Types

- Keep execution semantics unchanged.
- Define persisted record shapes more explicitly.
- Add tests around serialization-safe records.

Phase 2: FileStateStore

- Store records as JSON.
- Use one directory per runtime store.
- Add load/save/list/delete/clear behavior.
- Fail on non-serializable data.

Phase 3: Runtime restoreFlowRun API

- Add an explicit API to reconstruct `FlowEngineRunRecord`.
- Require registered actions and flows before restore.
- Do not auto-run restored flows.

Phase 4: Waiting Runs Query

- Add `listWaitingRuns`.
- Add indexes by `waitReason`, action id, or future correlation keys.

Phase 5: Event Recovery

- Define event correlation.
- Connect event handling to waiting run lookup.
- Resume matching runs explicitly.

## 12. Open Questions

- What is the exact persisted schema for `FlowEngineRunRecord`?
- Should `nodeRuns` and `actionRuns` be embedded in the FlowRun record or stored separately?
- How should errors be serialized without leaking sensitive details?
- Should outputs be required to be JSON-compatible, or should stores support codecs?
- How should state schema validation be represented?
- What compatibility rules should apply across action, flow, and package versions?
- Should `waitReason` become structured data instead of a string?
- What event correlation model is sufficient for the first recovery implementation?
- What batch save guarantees are required before using a durable store in production?
