import type { ActionContext, ActionDefinition, ActionRunRecord, ActionStatus, JsonValue } from "./types.js";

export function createActionRun(params: {
  id: string;
  actionId: string;
  actionVersion?: string;
  input?: JsonValue;
  status?: ActionStatus;
}): ActionRunRecord {
  return {
    id: params.id,
    runId: params.id,
    actionId: params.actionId,
    actionVersion: params.actionVersion,
    input: params.input,
    status: params.status ?? "ready"
  };
}

export async function runActionOnce(params: {
  runId: string;
  action: ActionDefinition;
  input?: unknown;
  context: ActionContext;
}): Promise<ActionRunRecord> {
  const baseRun: ActionRunRecord = {
    id: params.runId,
    runId: params.runId,
    actionId: params.action.id,
    actionVersion: params.action.version,
    input: params.input,
    status: "running"
  };

  if (params.action.mode !== "instant") {
    return {
      ...baseRun,
      status: "failed",
      error: new Error(`Unsupported action mode for runActionOnce: ${params.action.mode}`)
    };
  }

  if (!params.action.run) {
    return {
      ...baseRun,
      status: "failed",
      error: new Error(`Instant action is missing run(): ${params.action.id}@${params.action.version}`)
    };
  }

  try {
    const result = await params.action.run(params.input, params.context);

    if (result.type === "done") {
      return {
        ...baseRun,
        status: "done",
        output: result.output
      };
    }

    if (result.type === "failed") {
      return {
        ...baseRun,
        status: "failed",
        error: result.error
      };
    }

    return {
      ...baseRun,
      status: "failed",
      state: "state" in result ? result.state : undefined,
      error: new Error(`Unsupported result type for instant action: ${result.type}`)
    };
  } catch (error) {
    return {
      ...baseRun,
      status: "failed",
      error
    };
  }
}
