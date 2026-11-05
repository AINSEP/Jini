# Orc-BASH Full Example: Reddit Posts Feature

Complete implementation of all 6 layers for a posts feature. The state-manager-specific implementation is intentionally split into a separate reference so the state adapter remains swappable.

## types/post.ts

```typescript
export interface Post {
  id: string;
  title: string;
  content: string;
  author: { name: string; avatar: string };
  likes: number;
  commentCount: number;
  createdAt: string;
  liked: boolean;
}
```

## api/postApi.ts

```typescript
import type { Post } from '../types/post';

export const fetchPost = async (
  { postId }: { postId: string },
  { signal }: { signal?: AbortSignal } = {},
): Promise<Post> => {
  const response = await fetch(`/api/posts/${postId}`, { signal });
  if (!response.ok) throw new Error('Failed to fetch post');
  return response.json();
};

export const likePost = async (
  { postId }: { postId: string },
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ likes: number }> => {
  const response = await fetch(`/api/posts/${postId}/like`, { method: 'POST', signal });
  if (!response.ok) throw new Error('Failed to like post');
  return response.json();
};
```

## logic/PostService.ts

```typescript
import { formatDistanceToNow } from 'date-fns';
import type { Post } from '../types/post';

export interface FormattedPost extends Post {
  formattedTimestamp: string;
  excerpt: string;
  engagementScore: number;
}

export class PostService {
  formatPost({ post }: { post: Post }): FormattedPost {
    return {
      ...post,
      formattedTimestamp: formatDistanceToNow(new Date(post.createdAt), { addSuffix: true }),
      excerpt: post.content.substring(0, 280) + (post.content.length > 280 ? '...' : ''),
      engagementScore: post.likes + (post.commentCount * 3),
    };
  }

  validateComment({ text }: { text: string }): { isValid: boolean; error?: string } {
    if (!text.trim()) return { isValid: false, error: 'Comment cannot be empty' };
    if (text.length > 1000) return { isValid: false, error: 'Comment too long' };
    return { isValid: true };
  }
}

export const postService = new PostService();
```

## state/PostStatePort.ts

The interface contract. Orchestrators and hooks depend on this, never on the concrete store.

```typescript
import type { Post } from '../types/post';

export interface PostStatePort {
  post: Post | null;
  feed: string[];
  savePost: (post: Post) => void;
  saveFeed: (posts: Post[]) => void;
  updatePostLikes: (postId: string, likes: number) => void;
}
```

## state/ConcreteStateManager + state/PostStateAdapter.ts

The port and adapter boundary stay fixed. The concrete state manager implementation is intentionally separated into library-specific references:

- `state/PostStatePort.ts` stays stable.
- `state/PostStateAdapter.ts` maps the chosen store to that port.
- The concrete store implementation lives behind that adapter.

See `state-manager-zustand.md` for a concrete Zustand implementation of both `postStore.ts` and `PostStateAdapter.ts`.

When swapping libraries, the invariant is:

- change the concrete store implementation
- update the adapter
- leave hooks, orchestrators, and views alone

## hooks/usePost.ts

```typescript
import { useState, useCallback, useMemo } from 'react';
import type { Post } from '../types/post';
import type { FormattedPost } from '../logic/PostService';

export interface UsePostDependencies {
  post: Post | null;
  fetchPost: ({ postId }: { postId: string }, optional?: { signal?: AbortSignal }) => Promise<Post>;
  likePost: ({ postId }: { postId: string }, optional?: { signal?: AbortSignal }) => Promise<{ likes: number }>;
  formatPost: ({ post }: { post: Post }) => FormattedPost;
  validateComment: ({ text }: { text: string }) => { isValid: boolean; error?: string };
  savePost: (post: Post) => void;
  updatePostLikes: ({ postId, likes }: { postId: string; likes: number }) => void;
}

// Business Logic Hook — React lifecycle wrapper for service computations
const usePostLogic = ({
  post,
  formatPost,
}: {
  post: Post | null;
  formatPost: ({ post }: { post: Post }) => FormattedPost;
}) => {
  const formattedPost = useMemo(
    () => (post ? formatPost({ post }) : null),
    [post, formatPost]
  );
  return { formattedPost };
};

// UI State Hook — ephemeral view state only
const usePostUiState = () => {
  const [uiState, setUiState] = useState({
    isLiking: false,
    showCommentModal: false,
    commentText: '',
    validationError: '',
  });

  const setLiking = useCallback((isLiking: boolean) => {
    setUiState(s => ({ ...s, isLiking }));
  }, []);

  const openCommentModal = useCallback(() => {
    setUiState(s => ({ ...s, showCommentModal: true, commentText: '', validationError: '' }));
  }, []);

  const closeCommentModal = useCallback(() => {
    setUiState(s => ({ ...s, showCommentModal: false }));
  }, []);

  const setCommentText = useCallback(({ text }: { text: string }) => {
    setUiState(s => ({ ...s, commentText: text, validationError: '' }));
  }, []);

  return { uiState, actions: { setLiking, openCommentModal, closeCommentModal, setCommentText } };
};

// Integration Hook — composes sub-hooks, coordinates async with injected dependencies
export const usePost = (
  { postId, deps }: { postId: string; deps: UsePostDependencies },
  {}: {} = {},
) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const ui = usePostUiState();
  const logic = usePostLogic({ post: deps.post, formatPost: deps.formatPost });

  const fetchPost = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await deps.fetchPost({ postId });
      deps.savePost(fetched);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [postId, deps]);

  const like = useCallback(async () => {
    ui.actions.setLiking(true);
    try {
      const { likes } = await deps.likePost({ postId });
      deps.updatePostLikes({ postId, likes });
    } catch (err) {
      setError(err as Error);
    } finally {
      ui.actions.setLiking(false);
    }
  }, [postId, deps, ui.actions]);

  return {
    post: logic.formattedPost,       // from Business Logic sub-hook
    isLoading,
    error,
    uiState: ui.uiState,             // from UI State sub-hook
    actions: {
      fetchPost,
      like,
      openCommentModal: ui.actions.openCommentModal,
      closeCommentModal: ui.actions.closeCommentModal,
      setCommentText: ui.actions.setCommentText,
    },
  };
};
```

## orchestrators/PostPageOrchestrator.ts

```typescript
import { useEffect } from 'react';
import * as postApi from '../api/postApi';
import { postService } from '../logic/PostService';
import { usePostStateAdapter } from '../state/PostStateAdapter';   // ← adapter, not store
import { usePost } from '../hooks/usePost';

export const usePostPageOrchestrator = ({ postId }: { postId: string }) => {
  const state = usePostStateAdapter({ postId });   // all state via adapter

  const hook = usePost({ postId, deps: {
    post: state.post,
    fetchPost: postApi.fetchPost,
    likePost: postApi.likePost,
    formatPost: postService.formatPost.bind(postService),
    validateComment: postService.validateComment.bind(postService),
    savePost: state.savePost,
    updatePostLikes: state.updatePostLikes,
  } });

  useEffect(() => {
    if (!state.post) hook.actions.fetchPost();
  }, [state.post]);

  return {
    post: hook.post,
    isLoading: hook.isLoading,
    error: hook.error,
    isLiking: hook.uiState.isLiking,
    onLike: hook.actions.like,
  };
};
```

## orchestrators/FeedPageOrchestrator.ts (reuses usePost)

Each post in the feed uses its own adapter instance, wired identically to PostPageOrchestrator.

```typescript
import * as postApi from '../api/postApi';
import { postService } from '../logic/PostService';
import { usePostStateAdapter } from '../state/PostStateAdapter';   // ← adapter, not store
import { usePost } from '../hooks/usePost';

// Per-post wiring hook — adapter provides all state for a single post
const usePostWiring = ({ postId }: { postId: string }) => {
  const state = usePostStateAdapter({ postId });

  return usePost({ postId, deps: {
    post: state.post,
    fetchPost: postApi.fetchPost,
    likePost: postApi.likePost,
    formatPost: postService.formatPost.bind(postService),
    validateComment: postService.validateComment.bind(postService),
    savePost: state.savePost,
    updatePostLikes: state.updatePostLikes,
  } });
};

export const useFeedPageOrchestrator = ({ postIds }: { postIds: string[] }) => {
  return postIds.map(id => usePostWiring({ postId: id }));
};
```

Feed IDs are typically read from a store slice in the page component, or passed as props from a parent that owns the feed query.

## views/PostPage.tsx

```typescript
import { usePostPageOrchestrator } from '../orchestrators/PostPageOrchestrator';

export const PostPage = ({
  postId,
  useOrchestrator = usePostPageOrchestrator,
}: {
  postId: string;
  useOrchestrator?: typeof usePostPageOrchestrator;
}) => {
  const { post, isLoading, error, isLiking, onLike } = useOrchestrator({ postId });

  if (error) return <ErrorView error={error} />;
  if (isLoading || !post) return <LoadingView />;

  return (
    <Card>
      <h2>{post.title}</h2>
      <p>{post.excerpt}</p>
      <small>{post.formattedTimestamp}</small>
      <button onClick={onLike} disabled={isLiking}>
        {post.likes} Likes
      </button>
    </Card>
  );
};
```

## Cross-Platform (Web + Mobile)

The orchestrator is shared. Only the UI layer differs:

```typescript
// views/web/PostPage.tsx
import { usePostPageOrchestrator } from '../../orchestrators/PostPageOrchestrator';
export const PostPage = ({ postId }) => {
  const { post, onLike } = usePostPageOrchestrator(postId);
  return <button onClick={onLike}>{post?.likes} Likes</button>;
};

// views/mobile/PostPage.tsx
import { usePostPageOrchestrator } from '../../orchestrators/PostPageOrchestrator';
export const PostPage = ({ postId }) => {
  const { post, onLike } = usePostPageOrchestrator(postId);
  return <TouchableOpacity onPress={onLike}><Text>{post?.likes} Likes</Text></TouchableOpacity>;
};
```

80% code reuse — only the UI layer changes between platforms.
