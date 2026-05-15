# Trigger Start-Flow Design

## 1. Problem

`EventTriggerRegistry` currently stores descriptive trigger definitions only. `EventTriggerDefinition` can map an event name to a flow id, but the runtime does not start a flow when an event arrives.

The current `recoverWaitingRuns` API belongs to the waiting-run recovery path. It matches existing waiting ActionRuns and can preview restored FlowRuns; it is not a start-flow trigger path.

A future `RuntimeEvent` may:

- Start a new FlowRun.
- Match existing waiting ActionRuns.
- Do both, if the host explicitly chooses both paths.

Without a clear trigger start-flow policy, event handling can accidentally start duplicate FlowRuns, trigger the wrong flow, or repeat side effects.

## 2. Goals

- Design a RuntimeEvent-to-FlowRun trigger start-flow flow.
- Keep `EventTriggerRegistry` descriptive until the host explicitly calls a trigger API.
- Keep trigger start-flow separate from waiting recovery.
- Support the trigger `enabled` flag.
- Support flow id lookup through `FlowRegistry`.
- Define deterministic runId strategy options.
- Leave room for processed event record policy.
- Decide whether the first API should only create a run or also tick.
- Avoid exactly-once claims.
- Avoid durable recovery claims.

## 3. Non-Goals

- Background event listeners.
- External event buses.
- Automatic polling.
- Automatic trigger execution by default.
- Automatic waiting action wakeup.
- Exactly-once guarantees.
- Durable recovery guarantees.
- Distributed locks.
- Production scheduler behavior.
- FlowDefinition persistence.
- EventTriggerDefinition persistence.

## 4. Current Building Blocks

Current available pieces:

- `RuntimeEvent { id, name, payload?, occurredAt?, source? }`
- `EventTriggerDefinition { id, event, flow, enabled?, description?, filter?, input? }`
- `EventTriggerRegistry`
- `FlowRegistry`
- `ActionFlowRuntime.createRun(flowId, runId, version?)`
- `ProcessedEventStore`
- `recoverWaitingRuns(event)`
- `tickRecoveredRuns(result, options)`
- PackageManifest descriptive rules and triggers

These are enough for the implemented explicit trigger start-flow API, `ActionFlowRuntime.startFlowsForEvent(event, options)`. Automatic event handling and broader trigger execution policy are still not implemented.

## 5. Trigger Matching Model

Candidate first-version matching rules:

- `event.name === trigger.event`
- `trigger.enabled === false` means the trigger does not match.
- `enabled === undefined` means enabled.
- `filter` is metadata only and is not executed.
- `input` is metadata only and is not mapped.
- `trigger.flow` must be a non-empty string.
- `trigger.id` must be stable.

The first version should use exact event-name matching only. Filter execution and input mapping need separate design.

Trigger event matching must stay separate from waiting recovery matching. `trigger.event` and waiting `waitReason` may use the same string, but they are different paths.

## 6. API Shape

Implemented types:

```ts
type TriggerRunIdStrategy = "event-trigger" | "event-trigger-counter";

interface TriggerStartFlowOptions {
  dryRun?: boolean;
  maxTriggers?: number;
  runIdStrategy?: TriggerRunIdStrategy;
  runIdPrefix?: string;
  flowVersion?: string;
}

interface TriggerStartFlowResult {
  eventId: string;
  matchedTriggers: readonly EventTriggerDefinition[];
  startedRuns: readonly FlowEngineRunRecord[];
  skipped: readonly TriggerStartFlowSkip[];
}

interface TriggerStartFlowSkip {
  triggerId: string;
  reason: string;
}

startFlowsForEvent(event: RuntimeEvent, options?: TriggerStartFlowOptions): TriggerStartFlowResult
```

`startFlowsForEvent` must be called explicitly by the host. It creates FlowRuns by default, supports `dryRun`, supports `maxTriggers`, and does not call `tick`.

## 7. Run ID Strategy

Implemented run id strategies:

- `event-trigger`: `${event.id}:${trigger.id}`
- `event-trigger-counter`: `${event.id}:${trigger.id}:${index}`

Run ids should be deterministic to make duplicate events diagnosable. Deterministic run ids are not exactly-once behavior.

Current first version:

- Use `event-trigger` deterministic run ids.
- If a FlowRun with the generated runId already exists, return a skipped result with reason `FlowRun already exists`.
- Do not overwrite existing FlowRuns.

## 8. Flow Lookup and Version Policy

`trigger.flow` is a flow id.

Current `EventTriggerDefinition` does not include `flowVersion`, so the first version should use the latest registered flow for that id, matching `ActionFlowRuntime.createRun(flowId, runId, version?)` default behavior.

If the flow is not registered, return a skipped result with reason `Flow not found`.

The runtime should not install packages or load code during trigger execution. The host must register the flow and actions.

## 9. Input Mapping Policy

`EventTriggerDefinition.input` is currently a placeholder.

Candidate policies:

- No input mapping in the first version; `createRun` uses the flow definition as-is.
- Static `trigger.input` becomes future flow input context.
- Event payload mapping uses a future template or expression system.

Recommended first version:

- Do not implement input mapping.
- Treat `input` as future metadata only.
- Do not introduce a variable or template system in trigger start-flow.

## 10. Processed Event Relationship

Processed event records currently support `recoverWaitingRuns` observe-by-default attempts and explicit `skip-completed` duplicate policy.

Trigger start-flow may eventually need processed event records too, but trigger path and waiting recovery path must stay distinguishable.

Possible models:

- Reuse `ProcessedEventRecord` and add trigger-specific fields such as `triggerStartedFlowRunIds`.
- Add a separate `TriggerEventRecord`.
- Keep processed event records event-level only and put trigger details in `TriggerStartFlowResult`.

Recommended first version:

- Do not write trigger path details into `ProcessedEventRecord`.
- Return trigger start results directly.
- Design trigger processed-event policy separately.

Exactly-once behavior remains unimplemented.

## 11. Relationship With Waiting Recovery

Waiting recovery path:

- `matchWaitingRuns`
- `previewEventRecovery`
- `recoverWaitingRuns`
- `tickRecoveredRuns`

Trigger start-flow path:

- Match triggers.
- Create new FlowRuns.
- Optionally tick in a future explicit API.

The two paths are independent. A future `handleEvent(event)` can orchestrate both, but it must be configurable. Runtime should not default to executing every possible path for an event.

## 12. Safety Rules

- No automatic trigger execution by default.
- Host must explicitly call a trigger start-flow API.
- No automatic tick unless an API explicitly says so.
- No waiting wakeup.
- `registerTrigger` must not start flows.
- No exactly-once claim.
- No durable recovery claim.
- Flow and action definitions must be registered by the host.
- Trigger filters and input mapping are metadata only until implemented.

## 13. Error Handling

Candidate behavior:

- Invalid `RuntimeEvent` throws.
- No matching triggers returns empty `matchedTriggers` and `startedRuns`.
- Disabled triggers are omitted from `matchedTriggers`.
- Missing flow returns a structured skipped result.
- `createRun` failure returns a structured skipped result or error; first version should prefer structured skipped.
- Run id conflict returns skipped.
- Invalid `maxTriggers` throws.
- Triggers beyond `maxTriggers` return skipped.
- Store persistence failure needs explicit policy; first version should surface it clearly.
- Missing trigger registry returns an empty result.

## 14. Tests

Implemented tests cover:

- `startFlowsForEvent` matches trigger by event name.
- Disabled trigger is ignored.
- No matching trigger returns empty result.
- Missing flow is skipped.
- `createRun` creates FlowRun for matched trigger.
- Deterministic runId is used.
- Duplicate runId is skipped, not overwritten.
- `maxTriggers` limits started runs.
- `dryRun` does not create FlowRun.
- `registerTrigger` alone does not start flow.
- Trigger start-flow does not wake waiting actions.
- Trigger start-flow does not call tick by default.
- Trigger start-flow does not execute waiting recovery unless explicitly configured.
- Processed event record is not written unless policy is implemented.
- Exactly-once is not claimed.

Future tests should cover:

- Trigger filter execution once designed.
- Trigger input mapping once designed.
- Trigger processed-event policy once designed.
- Automatic `handleEvent` policy once designed.

## 15. Open Questions

- Should there be `startAndTickFlowsForEvent`?
- Should `EventTriggerDefinition` include `flowVersion`?
- Should `EventTriggerDefinition.input` be static data or a mapping template?
- Should trigger filters be functions, JSON expressions, or schemas?
- Should processed event records cover the trigger path?
- How should duplicate event id interact with deterministic runId?
- Should `handleEvent(event)` orchestrate trigger path and waiting recovery path?
- Should production store design come before trigger execution?
