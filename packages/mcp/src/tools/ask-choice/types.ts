/** Product-neutral question content; rendering and copy belong to the host. */
export interface AskChoiceSelect {
  readonly label: string;
  readonly hint?: string;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
}

export interface AskChoiceQuestion {
  readonly title: string;
  readonly description?: string;
  readonly submitLabel?: string;
  readonly singleSelect?: AskChoiceSelect;
  readonly multiSelect?: AskChoiceSelect;
}

export interface AskChoiceMessages {
  readonly pending: string;
  readonly forgedAnswer: string;
  readonly submitted: string;
  readonly typed: string;
  readonly noAnswer: string;
  readonly cancelled: string;
  readonly expired: string;
  readonly abandoned: string;
}

export type AskChoiceMessage =
  | { status: 'received'; params: Record<string, unknown> }
  | { status: 'expired' | 'abandoned' };

export interface AskChoiceEmission {
  channel: 'mcp-ui';
  payload: { resource: unknown };
}

export type AskChoiceEmitter = (args: { emission: AskChoiceEmission }) => Promise<void>;

/** The host owns correlation, principal binding, buffering, and expiry of live exchanges. */
export interface AskChoiceExchange {
  readonly id: string;
  send(args: { emission: AskChoiceEmission }): Promise<void>;
  receive(args: Record<string, never>): Promise<AskChoiceMessage>;
  close(args: Record<string, never>): void;
}

export interface AskChoiceExchangeStore {
  open(args: { toolId: string; principalId: string; emit: AskChoiceEmitter }): AskChoiceExchange;
}

/** Redeem consumes before checking binding, time, and offered options; rejection is fail-closed. */
export interface AskChoicePendingStore {
  mint(args: { principalId: string; question: AskChoiceQuestion }): string;
  redeem(args: { ticket: string | undefined; principalId: string; params: Record<string, unknown> }): boolean;
}

export interface AskChoiceCall {
  principalId: string;
  input: unknown;
  signal: AbortSignal;
  emitSurface?: AskChoiceEmitter;
}

/** Authorization is invoked before either displaying a question or redeeming its answer. */
export interface AskChoicePolicy {
  authorize(args: { ctx: AskChoiceCall; toolId: string }): void | Promise<void>;
  inputError(args: { message: string }): Error;
  shapeError(args: { message: string; toolId: string; inputSchema: Readonly<Record<string, unknown>> }): Error;
}

export interface AskChoiceForm {
  toolName: string;
  principalId: string;
  question: AskChoiceQuestion;
  baseParams: Record<string, unknown>;
  cancelParams?: Record<string, unknown>;
}

/** The host supplies resource identity, labels, field presentation, app metadata, and result encoding. */
export interface AskChoicePresentation {
  render(args: Omit<AskChoiceForm, 'cancelParams'>, options?: Pick<AskChoiceForm, 'cancelParams'>): unknown;
  buildResult(args: { modelText: string; ui: unknown }): Record<string, unknown>;
}
