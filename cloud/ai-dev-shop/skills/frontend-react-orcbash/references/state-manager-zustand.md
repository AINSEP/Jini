# Orc-BASH State Manager Reference: Zustand

Use this only when the selected client state manager is Zustand. This is a concrete implementation example, not a requirement that Orc-BASH use Zustand.

## Stable Boundary

These rules stay the same regardless of the state library:

- Orchestrators import the state adapter, never the concrete store.
- Hooks and orchestrators depend on the port interface, not the store implementation.
- Swapping state libraries should change the concrete store and adapter only.

## state/postStore.ts

The concrete Zustand implementation. Keep it isolated inside `state/`.

```typescript
import { create } from 'zustand';
import type { Post } from '../types/post';

interface PostState {
  posts: Record<string, Post>;
  feed: string[];
  savePost: (post: Post) => void;
  saveFeed: (posts: Post[]) => void;
  updatePostLikes: (postId: string, likes: number) => void;
}

export const usePostStore = create<PostState>((set) => ({
  posts: {},
  feed: [],

  savePost: (post) => set((state) => ({
    posts: { ...state.posts, [post.id]: post }
  })),

  saveFeed: (posts) => set({
    posts: posts.reduce((acc, post) => ({ ...acc, [post.id]: post }), {} as Record<string, Post>),
    feed: posts.map((post) => post.id),
  }),

  updatePostLikes: (postId, likes) => set((state) => ({
    posts: {
      ...state.posts,
      [postId]: { ...state.posts[postId], likes, liked: true },
    }
  })),
}));
```

## state/PostStateAdapter.ts

Inside a hook-shaped adapter, use selector subscriptions for UI-driving reads. This keeps React subscribed to store changes.

```typescript
import { usePostStore } from './postStore';
import type { PostStatePort } from './PostStatePort';

export const usePostStateAdapter = ({ postId }: { postId: string }): PostStatePort => {
  const post = usePostStore((state) => state.posts[postId] ?? null);
  const feed = usePostStore((state) => state.feed);
  const savePost = usePostStore((state) => state.savePost);
  const saveFeed = usePostStore((state) => state.saveFeed);
  const updatePostLikes = usePostStore((state) => state.updatePostLikes);

  return { post, feed, savePost, saveFeed, updatePostLikes };
};
```

## Hook Shape Rule

Keep selector calls at the top level of the adapter hook.

Good:

```typescript
const post = usePostStore((state) => state.posts[postId] ?? null);
```

Avoid returning helper functions that call store hooks later:

```typescript
const post = (id: string) => usePostStore((state) => state.posts[id] ?? null);
```

That shape turns the selector into a nested hook call pattern and makes the adapter harder to reason about.

## Stale State Rule

`usePostStore.getState()` returns a snapshot. It does not subscribe React to updates.

That means:

- Do not read UI-driving state through `getState()` inside components, hooks, or adapters that are expected to re-render.
- Use selector hooks for values that should stay reactive in the UI.

Example of a stale-read pitfall:

```typescript
const post = usePostStore.getState().posts[postId] ?? null;
```

That line reads the current value once, but React will not re-render just because the store changes later.

Preferred reactive read:

```typescript
const post = usePostStore((state) => state.posts[postId] ?? null);
```

## Writes and Actions

For action functions, both patterns can work:

- selector access inside hook-based adapters:

```typescript
const savePost = usePostStore((state) => state.savePost);
```

- imperative access outside reactive code:

```typescript
usePostStore.getState().savePost(post);
```

Why this is different from reads:

- Actions do not drive rendering by themselves.
- The stale-state problem comes from reading UI-driving values through `getState()`, not from imperatively invoking a write action.
- Reactive UI updates still come from selector-based reads elsewhere in the component tree.

Default Orc-BASH guidance:

- For UI-driving reads in hooks, components, and hook-based adapters, always use selectors.
- For actions, selector access and `getState()` invocation are both valid.
- In hook-based state adapters, prefer selector access when you want the adapter body to stay fully hook-shaped and declarative.
- Use `getState()` for imperative helper code, tests, or non-reactive integration points where you want to trigger a write without subscribing to store values.

## Swap Guidance

If you replace Zustand with Jotai, Redux, or another client state library:

1. Keep the port interface unchanged if the contract still fits.
2. Replace the concrete store implementation.
3. Update the state adapter to map the new store to the same port.
4. Leave hooks, orchestrators, and views unchanged.
