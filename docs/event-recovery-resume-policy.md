# Event Recovery Resume Policy

## 1. Problem

`matchWaitingRuns` can find waiting entries. `previewEventRecovery` can restore FlowRun records for preview. `recoverWaitingRuns` currently returns match/preview-only recovery results and records observe-only processed event attempts when supported.

Real recovery still needs policy decisions: whether to tick, when to tick, which runs to tick, and how to handle errors. If runtime automatically ticks after every event, it may repeat execution, run without registered actions or flows, or resume the wrong run for a loosely matched event.

That means resume/tick recovery needs an explicit policy. It should not be introduced as automatic wakeup.

## 2. Current Recovery Capabilities

Current implemented capabilities:

- Waiting index can find waiting ActionRuns by `waitReason`.
- `matchWaitingRuns(event)` returns matched entries only.
- `previewEventRecovery(event)` restores matching FlowRun records for preview.
- `recoverWaitingRuns(event)` follows preview-only behavior.
- `recoverWaitingRuns(event)` records processed event attempts when `ProcessedEventStore` is available.
- `previewEventRecovery` does not tick.
- `recoverWaitingRuns` does not tick.
- `previewEventRecovery` does not mutate waiting index.
- `recoverWaitingRuns` does not mutate waiting index.
- `previewEventRecovery` does not execute triggers.
- `recoverWaitingRuns` does not execute triggers.
- `restoreRun` requires saved FlowRun and matching ActionRuns.
- `tick` still requires registered flow and actions.

## 3. Goals

The policy should:

- Define the behavior boundary for explicit recovery APIs.
- Avoid runtime automatically listening to events.
- Avoid default automatic tick.
- Let the host explicitly choose which FlowRun to resume.
- Make errors visible.
- Keep FlowEngine semantics unchanged.
- Provide groundwork for future durable recovery.

## 4. Non-Goals

This policy does not implement:

- Background workers.
- External event buses.
- Automatic trigger execution.
- Exactly-once delivery.
- Distributed locks.
- Production scheduler behavior.
- Implicit action state mutation.
- Durable recovery guarantee.

## 5. Recovery Strategy Options

### Strategy A: Preview only

Current behavior:

- Match entries.
- Restore FlowRun preview.
- Record observe-only processed event attempts when supported.
- Do not tick.
- `recoverWaitingRuns(event)` follows this no-tick behavior today.
- Host decides the next action.

Advantages:

- Safest path.
- Does not repeat execution.
- Does not depend on flow/action registration.

Tradeoff:

- Host must explicitly continue.

### Strategy B: Explicit restore then host tick

Candidate behavior:

- API returns restored runs.
- Host calls `tick(restoredRun, flowId)` directly.
- Runtime does not automatically tick.

Advantages:

- Keeps control with the host.
- Easy to debug.

Tradeoff:

- Host must know the flow id, version, and registered actions.

### Strategy C: Runtime explicit recoverAndTick

Candidate API shape:

```ts
recoverWaitingRuns(event, { tick: true })
```

This option is not implemented. The current `recoverWaitingRuns(event)` API has no `tick` option and remains preview-only.

Possible flow:

- Match waiting entries.
- Restore FlowRun.
- Require flow/action definitions to already be registered.
- Call `tick`.
- Return recovered, ticked, and skipped records.

Advantages:

- Convenient for hosts.

Risks:

- Duplicate events may cause duplicate ticks.
- Stale waiting index entries may resume the wrong run.
- Action side effects are riskier.
- Idempotency must be designed first.

### Strategy D: Event injection contract

Candidate behavior:

- Inject event payload into action state or context.
- Require `ActionDefinition` to explicitly support a future `receiveEvent` or `wake` hook.

Advantages:

- More semantic wakeup model.

Tradeoffs:

- Current `ActionResult` and ActionRun lifecycle do not support this.
- This is a larger architecture change.

Recommendation:

- Do not implement automatic tick in the first recovery version.
- Prefer Strategy B as a documented host flow or explicit helper.
- Consider Strategy C only after processed event id and idempotency policy exist.
- Keep Strategy D as a future larger design.

## 6. Proposed Explicit Host Flow

Recommended host flow:

1. Host receives a `RuntimeEvent`.
2. Host calls `previewEventRecovery(event)`.
3. Host reviews `matched`, `recovered`, and `skipped`.
4. Host chooses one recovered FlowRun.
5. Host ensures matching flow and action definitions are registered.
6. Host calls `tick(restoredRun, flowId, options)` explicitly.
7. Runtime updates waiting index after persistence succeeds.
8. Host handles the result and errors.

This is not automatic wakeup. It does not guarantee exactly-once behavior. The host is responsible for deciding whether to continue.

## 7. Candidate Future API

Candidate API, not implemented:

```ts
interface EventRecoveryTickOptions {
  tick?: boolean;
  flowId?: string;
  flowVersion?: string;
  tickOptions?: FlowTickOptions;
  maxRuns?: number;
  dryRun?: boolean;
}

recoverWaitingRuns(event: RuntimeEvent, options?: EventRecoveryTickOptions): Promise<EventRecoveryResult>
```

Rules:

- `tick` defaults to `false`.
- `tick: true` must be explicit.
- `maxRuns` prevents one event from resuming too many runs.
- `dryRun` is equivalent to preview.
- `flowId` can default to `restoredRun.flowId`.
- `flowVersion` needs a separate policy.
- Processed event policy wiring is currently observe-only and does not skip duplicate events.

## 8. Safety Rules

Future recover/tick behavior must follow these rules:

- Default behavior must not tick.
- Tick must be explicitly enabled.
- Missing `flowRunId` must be skipped.
- `restoreRun` failure must be skipped or returned as an error; it must not pretend to succeed.
- Unregistered flow/action errors must be visible.
- Tick side effects are governed by action metadata and host policy.
- Stale waiting index entries must not be automatically deleted unless a repair API explicitly does that.
- `EventTriggerRegistry` must not automatically execute.
- Runtime must not claim exactly-once behavior.

## 9. Idempotency Requirements Before Auto Tick

Automatic tick needs at least:

- Processed event id index.
- Event id validation.
- Duplicate event policy.
- Per-waiting-run recovery state.
- Stale index detection.
- Failure retry policy.
- Side-effect policy.
- Persistence transaction strategy.

See [Processed Event ID Design](processed-event-id-design.md) for the processed event id model and current observe-only runtime wiring. Duplicate event skip policy, exactly-once behavior, explicit tick recovery, and durable recovery are not implemented.

Without these, automatic wakeup should not be implemented.

## 10. Error Handling Policy

Suggested behavior:

- Missing waiting index support: empty result.
- No match: empty `matched`.
- Missing `flowRunId`: skipped.
- Missing FlowRun: skipped.
- Unregistered flow/action: error or skipped; future API must decide.
- Tick failure: returned as skipped or failed recovery item.
- Partial recovery: result must expose per-run status.
- Corrupted waiting index: throw.

Recommendation:

- Preview phase should use `skipped` for missing FlowRun.
- Tick phase, if implemented, should preserve per-run failure details and not swallow errors.

## 11. Relationship With EventTriggerRegistry

Recovering waiting runs and starting new flows are different paths.

`EventTriggerRegistry` still does not execute automatically. A future `handleEvent(event)` could do two separate things:

1. Match waiting runs.
2. Evaluate start-flow triggers.

Those paths must be configurable. Runtime should not default to doing both.

## 12. StateStore Requirements

Strategy B needs:

- `WaitingIndexStore`.
- FlowRun persistence.
- ActionRun persistence.

Strategy C needs more reliable persistence. Production recovery is better suited to a database-backed store. FileStateStore is useful for local development and diagnostics, but not as an exactly-once recovery store.

## 13. Tests Needed If Implemented

Future tests should cover:

- Preview result can be manually ticked by host.
- `recoverWaitingRuns` with `tick: false` does not tick.
- `recoverWaitingRuns` with `tick: true` requires explicit option.
- Missing `flowRunId` is skipped.
- Missing FlowRun is skipped.
- Unregistered action surfaces error.
- Tick failure is reported per run.
- Duplicate event id behavior.
- `EventTriggerRegistry` is not executed unless explicitly requested.
- Waiting index is updated after explicit tick.

## 14. Open Questions

- Should `recoverWaitingRuns` default to `tick: false`?
- Is a separate `recoverAndTick` API needed?
- Should processed event id index be implemented first?
- Is a recovery attempt record needed?
- Should `maxRuns` have a default limit?
- Where should `flowVersion` come from?
- Can one event recover multiple flows?
- Should failures throw or return structured results?
- Should production store design come first?
