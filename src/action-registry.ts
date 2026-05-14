import type { RegisteredAction } from "./types.js";

export class ActionRegistry {
  private readonly actions = new Map<string, RegisteredAction>();

  register(action: RegisteredAction): void {
    this.actions.set(action.id, action);
  }

  get(actionId: string): RegisteredAction | undefined {
    return this.actions.get(actionId);
  }

  list(): readonly RegisteredAction[] {
    return [...this.actions.values()];
  }
}
