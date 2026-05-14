# AGENTS.md

## Project

This repository implements ActionFlow Runtime.

ActionFlow Runtime is a general-purpose action-level sliced flow runtime.
It is not an AI-agent framework and should not depend on AI APIs.

## Core Concepts

- Action: a semantic atomic operation.
- ActionRun: one execution instance of an Action.
- Slice: one resumable execution step of an ActionRun.
- Flow: a serializable workflow definition made from Action nodes.
- FlowRun: one execution instance of a Flow.
- Runtime: registry + flow engine + slice scheduler + state store.

## Execution Modes

Actions may be:

- instant: short synchronous operation, completes immediately.
- async: asynchronous operation, waits for a promise or external event.
- sliceable: resumable operation with start/resume/yield/done.

## Architecture Rules

- Prefer small modules with explicit interfaces.
- Do not use inheritance unless there is a strong reason.
- State for sliceable actions must be serializable.
- Side effects must be explicit in action metadata.
- Flow definitions must be JSON-serializable.
- The scheduler must not assume every action is sliceable.
- Implement tests for every core behavior.

## Commands

- Install dependencies: npm install
- Type check: npm run typecheck
- Test: npm test
- Build: npm run build

## Validation

After modifying runtime behavior, run:

npm run typecheck
npm test
npm run build
