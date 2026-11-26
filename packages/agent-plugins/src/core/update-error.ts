export class AgentPluginUpdateError extends Error {
  readonly code: string;
  constructor(required: { code: string; message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional); this.code = required.code; this.name = 'AgentPluginUpdateError';
  }
}

