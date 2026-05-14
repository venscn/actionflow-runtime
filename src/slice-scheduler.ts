import type { ActionRunRecord } from "./types.js";

export class SliceScheduler {
  enqueue(actionRun: ActionRunRecord): ActionRunRecord {
    return actionRun;
  }
}
