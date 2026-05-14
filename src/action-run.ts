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

export async function resumeActionRun(params: {
  run: ActionRunRecord;
  action: ActionDefinition;
  context: ActionContext;
}): Promise<ActionRunRecord> {
  const baseRun: ActionRunRecord = {
    ...params.run,
    actionId: params.action.id,
    actionVersion: params.action.version,
    status: "running"
  };

  if (params.action.mode !== "sliceable") {
    return {
      ...baseRun,
      status: "failed",
      error: new Error(`Unsupported action mode for resumeActionRun: ${params.action.mode}`)
    };
  }

  if (!params.action.start) {
    return {
      ...baseRun,
      status: "failed",
      error: new Error(`Sliceable action is missing start(): ${params.action.id}@${params.action.version}`)
    };
  }

  if (!params.action.resume) {
    return {
      ...baseRun,
      status: "failed",
      error: new Error(`Sliceable action is missing resume(): ${params.action.id}@${params.action.version}`)
    };
  }

  try {
    const state = baseRun.state ?? (await params.action.start(baseRun.input, params.context));
    const result = await params.action.resume(state, params.context);

    if (result.type === "yield") {
      return {
        ...baseRun,
        status: "ready",
        state: result.state,
        waitReason: undefined
      };
    }

    if (result.type === "done") {
      return {
        ...baseRun,
        status: "done",
        output: result.output,
        waitReason: undefined
      };
    }

    if (result.type === "waiting") {
      return {
        ...baseRun,
        status: "waiting",
        state: result.state,
        waitReason: result.reason
      };
    }

    return {
      ...baseRun,
      status: "failed",
      error: result.error
    };
  } catch (error) {
    return {
      ...baseRun,
      status: "failed",
      error
    };
  }
}
