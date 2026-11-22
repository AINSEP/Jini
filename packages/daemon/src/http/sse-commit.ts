/**
 * @file The moment a streaming route stops being able to answer with a status. Some streams
 * cannot know whether they will be a stream until their source has spoken (a run's event source
 * reports "unknown run" itself, and delivers its replay before it says "subscribed"). Such a route
 * offers an answer at each point where one becomes known (the stream on the first event, a JSON
 * error on a refusal) and the first offer wins. The latch is that rule.
 */

/** Resolves once, with the first answer offered. */
export interface CommitLatch {
  /** The answer the route returns. */
  readonly response: Promise<Response>;
  /** Offers `response`. Returns true when it became the answer, false when an earlier offer already had. */
  commit(required: { readonly response: Response }, optional?: Record<string, never>): boolean;
  readonly committed: boolean;
}

export function createCommitLatch(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CommitLatch {
  let committed = false;
  let resolveResponse: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  return {
    response,
    commit: ({ response: offered }) => {
      if (committed) return false;
      committed = true;
      resolveResponse(offered);
      return true;
    },
    get committed() { return committed; },
  };
}
