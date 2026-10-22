import type { Ref } from 'react';
import { mediaRowHandles } from '../../rules.js';
import type { MediaCardProps } from './MediaCard.hooks.js';
export interface MediaGridProps {
  readonly gridRef?: Ref<HTMLDivElement>;
  readonly actions: readonly Omit<MediaCardProps, 'api'>[];
  readonly api: MediaCardProps['api'];
  readonly busy?: boolean;
  readonly emptyLabel?: string;
}
export function useMediaGrid(props: MediaGridProps, _optional: Record<string, never> = {}) {
  const handles = mediaRowHandles({ media: props.actions.map(action => action.item) });
  return { className: props.actions.length ? 'jini-media-grid' : 'jini-media-grid-empty', ...props, actions: props.actions.map((action, index) => ({ ...action, handleBase: handles[index]! })) };
}
