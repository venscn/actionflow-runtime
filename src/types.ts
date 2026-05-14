export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ActionMode = "instant" | "async" | "sliceable";
export type SideEffectKind = "none" | "read" | "write" | "external";

export interface ActionMetadata {
  readonly id: string;
  readonly mode: ActionMode;
  readonly sideEffects: readonly SideEffectKind[];
  readonly description?: string;
}

export interface ActionContext<TState extends JsonValue = JsonValue> {
  readonly actionRunId: string;
  readonly state?: TState;
}

export interface ActionResult<TOutput extends JsonValue = JsonValue> {
  readonly status: "completed";
  readonly output?: TOutput;
}

export interface SliceYield<TState extends JsonValue = JsonValue> {
  readonly status: "yielded";
  readonly state: TState;
}

export type SliceResult<
  TOutput extends JsonValue = JsonValue,
  TState extends JsonValue = JsonValue
> = ActionResult<TOutput> | SliceYield<TState>;

export interface Action<TInput extends JsonValue = JsonValue, TOutput extends JsonValue = JsonValue> {
  readonly metadata: ActionMetadata;
  run(input: TInput, context: ActionContext): ActionResult<TOutput> | Promise<ActionResult<TOutput>>;
}

export interface SliceableAction<
  TInput extends JsonValue = JsonValue,
  TOutput extends JsonValue = JsonValue,
  TState extends JsonValue = JsonValue
> {
  readonly metadata: ActionMetadata & { readonly mode: "sliceable" };
  start(input: TInput, context: ActionContext): SliceResult<TOutput, TState> | Promise<SliceResult<TOutput, TState>>;
  resume(state: TState, context: ActionContext<TState>): SliceResult<TOutput, TState> | Promise<SliceResult<TOutput, TState>>;
}

export type RegisteredAction = Action | SliceableAction;

export interface ActionNode {
  readonly id: string;
  readonly actionId: string;
  readonly input?: JsonValue;
}

export interface Flow {
  readonly id: string;
  readonly nodes: readonly ActionNode[];
}

export type ActionRunStatus = "pending" | "running" | "yielded" | "completed" | "failed";
export type FlowRunStatus = "pending" | "running" | "completed" | "failed";

export interface ActionRunRecord {
  readonly id: string;
  readonly actionId: string;
  readonly status: ActionRunStatus;
  readonly input?: JsonValue;
  readonly output?: JsonValue;
  readonly state?: JsonValue;
  readonly error?: string;
}

export interface FlowRunRecord {
  readonly id: string;
  readonly flowId: string;
  readonly status: FlowRunStatus;
  readonly currentNodeId?: string;
}
