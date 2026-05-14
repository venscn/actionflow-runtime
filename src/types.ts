/**
 * JSON-compatible primitive values used for serializable runtime data.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON-compatible values accepted by flow definitions, inputs, outputs, and saved state.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

/**
 * JSON-compatible object shape.
 */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Declares how an action is expected to execute.
 */
export type ActionExecutionMode = "instant" | "async" | "sliceable";

/**
 * Lifecycle status for one action execution.
 */
export type ActionStatus = "ready" | "running" | "waiting" | "done" | "failed";

/**
 * Runtime services exposed to action implementations.
 */
export interface ActionContext {
  /**
   * Returns the current runtime monotonic time in milliseconds.
   */
  now(): number;

  /**
   * Returns the current slice or action deadline in runtime monotonic milliseconds.
   */
  deadline(): number;

  /**
   * Returns the remaining execution budget in milliseconds.
   */
  remainingMs(): number;

  /**
   * Indicates whether the current action should yield before doing more work.
   */
  shouldYield(): boolean;

  /**
   * Emits a runtime-scoped log message.
   */
  log(message: string): void;
}

/**
 * Result returned by an action start, run, or resume function.
 */
export type ActionResult<O, S> =
  | {
      /** The action paused and can resume later from the provided state. */
      type: "yield";
      state: S;
    }
  | {
      /** The action completed successfully with an output value. */
      type: "done";
      output: O;
    }
  | {
      /** The action is waiting on an external event or asynchronous condition. */
      type: "waiting";
      state: S;
      reason: string;
    }
  | {
      /** The action failed with an implementation or runtime error. */
      type: "failed";
      error: unknown;
    };

/**
 * Defines one reusable action and the optional entry points supported by its execution mode.
 */
export interface ActionDefinition<I = unknown, O = unknown, S = unknown> {
  /** Stable action identifier used by flow nodes. */
  id: string;

  /** Action definition version for compatibility and migration decisions. */
  version: string;

  /** Execution mode used by the runtime scheduler. */
  mode: ActionExecutionMode;

  /** Placeholder for input validation metadata. */
  inputSchema: unknown;

  /** Placeholder for output validation metadata. */
  outputSchema: unknown;

  /** Placeholder for serializable state validation metadata. */
  stateSchema: unknown;

  /** Explicit side effect labels declared by the action author. */
  sideEffects: string[];

  /** Starts a sliceable action and returns its initial serializable state. */
  start?(input: I, context: ActionContext): S | Promise<S>;

  /** Runs an instant or async action. */
  run?(input: I, context: ActionContext): ActionResult<O, S> | Promise<ActionResult<O, S>>;

  /** Resumes a sliceable or waiting action from serialized state. */
  resume?(state: S, context: ActionContext): ActionResult<O, S> | Promise<ActionResult<O, S>>;
}

/**
 * Public action type stored in the registry.
 *
 */
export type RegisteredAction = ActionDefinition;

/**
 * A flow node that invokes one registered action.
 */
export interface ActionFlowNode {
  type: "action";
  id: string;
  action: string;
  input?: JsonValue;
}

/**
 * A flow node that runs child nodes in order.
 */
export interface SequenceFlowNode {
  type: "sequence";
  id: string;
  steps: FlowNode[];
}

/**
 * A flow node that allows child nodes to run concurrently.
 */
export interface ParallelFlowNode {
  type: "parallel";
  id: string;
  branches: FlowNode[];
}

/**
 * Minimal flow node union reserved for action, sequence, and parallel execution.
 */
export type FlowNode = ActionFlowNode | SequenceFlowNode | ParallelFlowNode;

/**
 * Serializable workflow definition.
 */
export interface FlowDefinition {
  id: string;
  version: string;
  root: FlowNode;
}

/**
 * Lifecycle status for one flow execution.
 */
export type FlowRunStatus = "ready" | "running" | "waiting" | "done" | "failed";

/**
 * Persisted record for one action execution instance.
 */
export interface ActionRunRecord {
  /** Backward-compatible record identifier. */
  id: string;
  /** Stable execution identifier for this action run. */
  runId: string;
  actionId: string;
  actionVersion?: string;
  status: ActionStatus;
  input?: unknown;
  output?: unknown;
  state?: unknown;
  waitReason?: string;
  error?: unknown;
}

/**
 * Persisted record for one flow execution instance.
 */
export interface FlowRunRecord {
  id: string;
  flowId: string;
  status: FlowRunStatus;
  currentNodeId?: string;
}
