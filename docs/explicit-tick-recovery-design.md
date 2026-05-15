# Explicit Tick Recovery Design

## 1. Problem

`recoverWaitingRuns(event)` currently performs match and restore preview work, and records observe-only processed event attempts when `ProcessedEventStore` is available.

It does not call `tick`, does not wake waiting actions, and does not execute triggers. Real recovery execution still requires FlowEngine ticking, but automatic ticking is risky: it can repeat execution, amplify side effects, or resume stale waiting index entries.

The host needs an explicit way to choose whether to tick, which FlowRun to tick, and which `flowId`, version, and tick options to use.

## 2. Goals

- Design an explicit tick recovery API.
- Keep the default behavior as no tick.
- Require tick behavior to be explicitly enabled or explicitly invoked.
- Keep FlowEngine semantics unchanged.
- Keep EventTriggerRegistry from executing automatically.
- Make each recovered run result visible.
- Leave room for future duplicate skip and exactly-once policy work.
- Support host control over `maxRuns`, `dryRun`, `flowId`, `flowVersion`, and `tickOptions`.

## 3. Non-Goals

- Background worker.
- External event bus.
- Automatic polling.
- Automatic trigger execution.
- Implicit action state mutation.
- Exactly-once guarantee.
- Durable recovery guarantee.
- Distributed locks.
- Production scheduler.

## 4. Current Behavior

- `matchWaitingRuns(event)`: read-only match.
- `previewEventRecovery(event)`: match plus restore preview.
- `recoverWaitingRuns(event)`: match plus restore preview plus observe-only processed event records.
- `recoverWaitingRuns(event)` does not tick.
- `recoverWaitingRuns(event)` does not skip duplicates.
- `recoverWaitingRuns(event)` does not wake waiting actions.
- `recoverWaitingRuns(event)` does not execute triggers.
- `tick` still requires registered flow and actions.

## 5. Candidate API Shape

Candidate types, not implemented:

```ts
interface EventRecoveryTickOptions {
  tick?: boolean;
  flowId?: string;
  flowVersion?: string;
  tickOptions?: FlowTickOptions;
  maxRuns?: number;
  dryRun?: boolean;
}

interface EventRecoveryRunResult {
  flowRunId: string;
  status: "previewed" | "ticked" | "skipped" | "failed";
  run?: FlowEngineRunRecord;
  reason?: string;
}

interface EventRecoveryTickResult extends EventRecoveryResult {
  runResults: readonly EventRecoveryRunResult[];
}

recoverWaitingRuns(event: RuntimeEvent, options?: EventRecoveryTickOptions): Promise<EventRecoveryTickResult>
```

If ticking is added directly to `recoverWaitingRuns`, the API may need to become async. That would be a breaking change for the current synchronous match/preview API.

Another option is to add `recoverWaitingRunsWithTick(event, options)` or `tickRecoveredRuns(result, options)` so current `recoverWaitingRuns(event): EventRecoveryResult` remains stable.

## 6. API Strategy Options

### Strategy A: Extend recoverWaitingRuns to async

Advantages:

- One method name.
- Single event recovery entry point.

Tradeoffs:

- Breaks the current synchronous API.
- Existing callers need `await`.
- Documentation and tests need broad updates.

### Strategy B: Add recoverWaitingRunsWithTick

Advantages:

- Keeps current `recoverWaitingRuns` stable.
- Makes tick behavior explicit.

Tradeoffs:

- Adds another API.
- Requires clear method boundaries.

### Strategy C: Add tickRecoveredRuns helper

Candidate:

- `recoverWaitingRuns(event)` remains preview-only.
- A new `tickRecoveredRuns(recoveryResult, options)` helper handles explicit ticks.

Advantages:

- Forces the host to see preview results before ticking.
- Safest first extension.

Tradeoffs:

- One extra host step.
- Requires a clear contract between `EventRecoveryResult` and the tick helper.

Recommended first path: Strategy C, or Strategy B if convenience is more important. Avoid changing `recoverWaitingRuns` to async unless an explicit breaking change is planned.

## 7. Recommended First Implementation

Keep:

```ts
recoverWaitingRuns(event): EventRecoveryResult
```

Add one explicit helper, not implemented yet:

```ts
tickRecoveredRuns(result: EventRecoveryResult, options?: TickRecoveredRunsOptions): Promise<EventRecoveryTickResult>
```

Alternative:

```ts
recoverWaitingRunsWithTick(
  event: RuntimeEvent,
  options: EventRecoveryTickOptions & { tick: true }
): Promise<EventRecoveryTickResult>
```

This project should prefer safety first, so `tickRecoveredRuns` is the recommended first implementation.

## 8. tickRecoveredRuns Policy

Candidate rules:

1. Input must come from `previewEventRecovery` or `recoverWaitingRuns`.
2. No automatic tick; the host must explicitly call the helper.
3. Process `result.recovered` FlowRuns one by one.
4. `maxRuns` defaults to `1`.
5. `flowId` defaults to `recoveredRun.flowId`.
6. `flowVersion` is optional.
7. `tickOptions` is optional.
8. `dryRun: true` returns `previewed` results without calling `tick`.
9. Each run produces an `EventRecoveryRunResult`.
10. Tick errors produce structured failed run results.

The first implementation must choose whether to stop on first error or continue. A `continueOnError` option may be needed, but can be deferred.

## 9. Safety Rules

- Do not tick automatically.
- Do not listen for external events automatically.
- Do not execute EventTriggerRegistry automatically.
- Do not inject event payload into action state.
- Do not claim exactly-once behavior.
- Do not skip duplicate events by default until a duplicate skip policy exists.
- Keep action side effects explicit.
- Require host-registered flow and action definitions before tick.
- Do not automatically delete stale waiting index entries.
- Treat processed event records as recovery attempt diagnostics, not business success.

## 10. Processed Event Record Policy

Current `recoverWaitingRuns` records observe-only `started`, `completed`, and `failed` attempts.

The explicit tick helper needs a separate policy. Options:

- A. Do not modify processed event records; only return `runResults`.
- B. Update `recoveredFlowRunIds` or status after ticking.
- C. Write a separate future `RecoveryAttemptRecord`.

Recommended first implementation: do not modify processed event records from the tick helper. Keeping preview recovery and execution recovery separate avoids overloading `ProcessedEventRecord`.

Duplicate skip and exactly-once behavior remain future designs.

## 11. Error Handling

Candidate behavior:

- Missing recovered runs: return empty `runResults`.
- Missing `flowId`: return skipped or failed run result.
- Unregistered flow: failed run result.
- Unregistered action: failed run result.
- Tick failure: failed run result.
- Store persistence failure during tick: surface clearly as failure or throw.
- Invalid options: throw.
- `maxRuns` exceeded: skipped run result.

Recommended:

- Option validation errors throw.
- Per-run execution errors return structured failed results.
- Persistence errors from tick must be visible.

## 12. Relationship With Waiting Index

`ActionFlowRuntime.tick` already updates the waiting index after persistence succeeds.

Explicit tick recovery should rely on normal tick behavior and should not manually remove waiting index entries. If a tick completes an action, Runtime tick should clear the corresponding waiting entry through the existing waiting index path.

Stale waiting index cleanup remains a separate health or repair API.

## 13. Relationship With EventTriggerRegistry

Explicit tick recovery does not execute triggers.

Future event handling may have two independent paths:

1. Event trigger starts a new flow.
2. Waiting recovery resumes an existing run.

Those paths must be configurable and should not be coupled by default. This design does not implement start-flow trigger execution.

## 14. Tests Needed If Implemented

- `tickRecoveredRuns` dry run does not tick.
- `tickRecoveredRuns` ticks one recovered run when explicitly called.
- `maxRuns` limits ticked runs.
- Missing `flowId` returns failed or skipped run result.
- Unregistered flow/action surfaces structured failure.
- Tick failure returns failed run result.
- Waiting index updates through normal tick after successful tick.
- EventTriggerRegistry is not executed.
- Processed event records are not modified by tick helper if that policy is chosen.
- `recoverWaitingRuns` remains no-tick.

## 15. Open Questions

- Should the API be `tickRecoveredRuns` or `recoverWaitingRunsWithTick`?
- Should `recoverWaitingRuns` ever become async?
- Should `maxRuns` default to `1`?
- Should tick failure stop later runs?
- Is `continueOnError` needed?
- Should tick helper write processed event records?
- Is a separate `RecoveryAttemptRecord` needed?
- Should duplicate skip policy come first?
- Should stale waiting index health checks come first?
- Should production store design come first?
