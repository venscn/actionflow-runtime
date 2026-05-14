import { resumeActionRun } from "./action-run.js";
import type { ActionContext, ActionDefinition, ActionRunRecord } from "./types.js";

export interface FrameReport {
  startedAt: number;
  endedAt: number;
  budgetMs: number;
  consumedMs: number;
  slicesRun: number;
  completedRuns: string[];
  yieldedRuns: string[];
  failedRuns: string[];
  waitingRuns: string[];
}

interface ScheduledRun {
  run: ActionRunRecord;
  action: ActionDefinition;
}

export class SliceScheduler {
  private readonly runs = new Map<string, ScheduledRun>();
  private readonly readyQueue: string[] = [];

  add(run: ActionRunRecord, action: ActionDefinition): void {
    this.runs.set(run.runId, { run, action });

    if (run.status === "ready") {
      this.readyQueue.push(run.runId);
    }
  }

  getRun(runId: string): ActionRunRecord | undefined {
    return this.runs.get(runId)?.run;
  }

  listRuns(): readonly ActionRunRecord[] {
    return [...this.runs.values()].map((scheduled) => scheduled.run);
  }

  async runFrame(params: { frameBudgetMs: number; maxSliceMs: number }): Promise<FrameReport> {
    const startedAt = performance.now();
    const frameDeadline = startedAt + params.frameBudgetMs;
    const report: FrameReport = {
      startedAt,
      endedAt: startedAt,
      budgetMs: params.frameBudgetMs,
      consumedMs: 0,
      slicesRun: 0,
      completedRuns: [],
      yieldedRuns: [],
      failedRuns: [],
      waitingRuns: []
    };

    let reservedMs = 0;

    while (this.readyQueue.length > 0) {
      const now = performance.now();
      const remainingFrameMs = frameDeadline - now;
      const remainingBudgetMs = params.frameBudgetMs - reservedMs;
      const sliceBudgetMs = Math.min(params.maxSliceMs, remainingBudgetMs);

      if (remainingFrameMs <= 0 || sliceBudgetMs <= 0) {
        break;
      }

      const runId = this.readyQueue.shift();

      if (!runId) {
        break;
      }

      const scheduled = this.runs.get(runId);

      if (!scheduled || scheduled.run.status !== "ready") {
        continue;
      }

      const context = createFrameContext(now, Math.min(now + sliceBudgetMs, frameDeadline));
      const nextRun = await resumeActionRun({
        run: scheduled.run,
        action: scheduled.action,
        context
      });

      this.runs.set(runId, { ...scheduled, run: nextRun });
      report.slicesRun += 1;
      reservedMs += sliceBudgetMs;

      if (nextRun.status === "ready") {
        report.yieldedRuns.push(nextRun.runId);
        this.readyQueue.push(nextRun.runId);
      } else if (nextRun.status === "done") {
        report.completedRuns.push(nextRun.runId);
      } else if (nextRun.status === "failed") {
        report.failedRuns.push(nextRun.runId);
      } else if (nextRun.status === "waiting") {
        report.waitingRuns.push(nextRun.runId);
      }
    }

    report.endedAt = performance.now();
    report.consumedMs = Math.min(params.frameBudgetMs, Math.max(report.endedAt - report.startedAt, reservedMs));

    return report;
  }
}

function createFrameContext(startedAt: number, deadline: number): ActionContext {
  return {
    now: () => performance.now(),
    deadline: () => deadline,
    remainingMs: () => Math.max(0, deadline - performance.now()),
    shouldYield: () => performance.now() >= deadline,
    log: () => undefined
  };
}
