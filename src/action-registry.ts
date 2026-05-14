import { compareVersions } from "./version.js";
import type { RegisteredAction } from "./types.js";

export class ActionRegistry {
  private readonly actions = new Map<string, Map<string, RegisteredAction>>();

  register(action: RegisteredAction): void {
    const versions = this.actions.get(action.id) ?? new Map<string, RegisteredAction>();

    if (versions.has(action.version)) {
      throw new Error(`Action already registered: ${action.id}@${action.version}`);
    }

    versions.set(action.version, action);
    this.actions.set(action.id, versions);
  }

  get(actionId: string, version?: string): RegisteredAction | undefined {
    const versions = this.actions.get(actionId);

    if (!versions) {
      return undefined;
    }

    if (version !== undefined) {
      return versions.get(version);
    }

    return [...versions.values()].sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  has(actionId: string, version?: string): boolean {
    return this.get(actionId, version) !== undefined;
  }

  list(): readonly RegisteredAction[] {
    return [...this.actions.values()].flatMap((versions) => [...versions.values()]);
  }
}
