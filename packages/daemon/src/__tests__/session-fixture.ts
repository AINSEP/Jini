import * as implementation from '../session-coordination.js';
import { scheduler } from './surface-fixture.js';
import { AGENT_DEFS } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';

// Host wording supplied by the fixture, never a production default.
export const CONCURRENT_RUN_REFUSAL_MESSAGE = 'The assistant could not start: another answer in this chat is still running. Wait for it to finish, or stop it, then send again.';
export function createLiveRunTracker() {
  const tracker = implementation.createLiveRunTracker({});
  return {
    objectTracker: tracker,
    register: (conversationId: string, runId: string) => tracker.register({ conversationId, runId }),
    unregister: (conversationId: string, runId: string) => tracker.unregister({ conversationId, runId }),
    hasConcurrentLiveRun: (conversationId: string, runId: string) => tracker.hasConcurrentLiveRun({ conversationId, runId }),
    concurrentLiveRunIds: (conversationId: string, runId: string) => tracker.concurrentLiveRunIds({ conversationId, runId }),
    conversationIdForRun: (runId: string) => tracker.conversationIdForRun({ runId }),
  };
}
export function createConversationStartLock() {
  const lock = implementation.createConversationStartLock({});
  return { run: <T>(conversationId: string | undefined, critical: () => Promise<T>) => lock.run({ conversationId, critical }), trackedConversationCount: lock.trackedConversationCount };
}
export function waitForStoppingRuns(args: { tracker: ReturnType<typeof createLiveRunTracker>; lifecycle: implementation.StoppingRunLifecycle; conversationId: string; runId: string; timeoutMs: number }) {
  return implementation.waitForStoppingRuns({ ...args, tracker: args.tracker.objectTracker, scheduler }, { timeoutMs: args.timeoutMs });
}
export const failRunBeforeStart = (lifecycle: implementation.FailingRunLifecycle, runId: string, message: string) => implementation.failRunBeforeStart({ lifecycle, runId, message });
const agents: implementation.AgentCapabilityResolver = { lookup: ({ agentId }) => AGENT_DEFS.find(def => def.id === agentId) };
export const agentCarriesOwnMemory = (agentId: string) => implementation.agentCarriesOwnMemory({ agentId, agents });
export const agentAcceptsHostMintedSessionId = (agentId: string) => implementation.agentAcceptsHostMintedSessionId({ agentId, agents });
export const resolveHostMintedSessionId = implementation.resolveHostMintedSessionId;
export const resolveNewSessionField = (hostMintedSessionId: string | null) => implementation.resolveNewSessionField({ hostMintedSessionId });
export const resolveResumeSessionField = (storedSessionId: string | null) => implementation.resolveResumeSessionField({ storedSessionId });
export const extractSessionRefFromEndEvent = (event: RunProtocolEvent) => implementation.extractSessionRefFromEndEvent({ event });
export const shouldClearSessionOnFailedResume = (event: RunProtocolEvent, attemptedResumeSessionId: string | null) => implementation.shouldClearSessionOnFailedResume({ event, attemptedResumeSessionId });
export const wouldForcedColdStartLoseConversationContext = implementation.wouldForcedColdStartLoseConversationContext;
