import type { RunNotices } from '../entry.js';
export const notices: RunNotices = {
  toolStepLimit: { kind: 'status', label: 'Step limit', detail: 'Ask it to continue.' },
  interrupted: { kind: 'status', label: 'Restarted', detail: 'Retry your message.' },
  neverStarted: { kind: 'status', label: 'Never started', detail: 'Nothing ran.' },
  canceledLabel: 'Run canceled',
  failedLabel: 'Run failed',
  terminalDetail: ({ outcome }) => `exit code ${outcome.code}, signal ${outcome.signal}, resumable ${outcome.resumable}`,
};
