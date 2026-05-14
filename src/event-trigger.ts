export interface EventTriggerDefinition {
  id: string;
  event: string;
  flow: string;
  enabled?: boolean;
  description?: string;
  filter?: unknown;
  input?: unknown;
}

export type EventTriggerValidationResult =
  | {
      valid: true;
      trigger: EventTriggerDefinition;
    }
  | {
      valid: false;
      errors: string[];
    };

export function validateEventTrigger(trigger: unknown): EventTriggerValidationResult {
  const errors: string[] = [];

  if (!isRecord(trigger)) {
    return {
      valid: false,
      errors: ["trigger must be an object"]
    };
  }

  requireNonEmptyString(trigger, "id", errors);
  requireNonEmptyString(trigger, "event", errors);
  requireNonEmptyString(trigger, "flow", errors);

  if (trigger.enabled !== undefined && typeof trigger.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }

  if (trigger.description !== undefined && typeof trigger.description !== "string") {
    errors.push("description must be a string");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return {
    valid: true,
    trigger: trigger as unknown as EventTriggerDefinition
  };
}

export class EventTriggerRegistry {
  private readonly triggers = new Map<string, EventTriggerDefinition>();

  register(trigger: EventTriggerDefinition): void {
    const result = validateEventTrigger(trigger);

    if (!result.valid) {
      throw new Error(`Invalid event trigger: ${result.errors.join("; ")}`);
    }

    if (this.triggers.has(result.trigger.id)) {
      throw new Error(`Event trigger already registered: ${result.trigger.id}`);
    }

    this.triggers.set(result.trigger.id, result.trigger);
  }

  get(id: string): EventTriggerDefinition | undefined {
    return this.triggers.get(id);
  }

  has(id: string): boolean {
    return this.triggers.has(id);
  }

  list(): readonly EventTriggerDefinition[] {
    return [...this.triggers.values()];
  }

  listEnabled(): readonly EventTriggerDefinition[] {
    return this.list().filter((trigger) => trigger.enabled !== false);
  }

  findByEvent(event: string): readonly EventTriggerDefinition[] {
    return this.list().filter((trigger) => trigger.event === event);
  }

  delete(id: string): boolean {
    return this.triggers.delete(id);
  }

  clear(): void {
    this.triggers.clear();
  }
}

function requireNonEmptyString(target: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof target[field] !== "string" || target[field].trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
