import type { ActionRunRecord, ActionRunStatus, JsonValue } from "./types.js";

export function createActionRun(params: {
  id: string;
  actionId: string;
  input?: JsonValue;
  status?: ActionRunStatus;
}): ActionRunRecord {
  return {
    id: params.id,
    actionId: params.actionId,
    input: params.input,
    status: params.status ?? "pending"
  };
}
