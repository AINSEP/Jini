import { createRouting, type RoutingContentRecord } from '../index.js';

export interface FixturePost extends RoutingContentRecord { readonly id: string; readonly workspaceId: string }
/** Minimal DI content fake; reads are workspace-scoped just like the host repository. */
export class InMemoryPostRepo {
  constructor(private readonly posts: readonly FixturePost[]) {}
  async findById({ workspaceId, id }: { workspaceId: string; id: string }): Promise<FixturePost | null> {
    return this.posts.find(post => post.workspaceId === workspaceId && post.id === id) ?? null;
  }
}
/** Keep test records explicit, without importing product fixtures. */
export function buildPostRecord<T extends FixturePost>(post: T): T { return post; }
/** Fixed-clock visibility fake; production delegates to the host's existing rule. */
export function createTestRouting() {
  return createRouting({ ports: {
    isLive: ({ post }) => post.status === 'published' && post.deletedAt == null
      && !(typeof post.publishAt === 'string' && post.publishAt > '2026-10-09T00:00:00.000Z'),
    reportPhaseError: () => {},
  } });
}
