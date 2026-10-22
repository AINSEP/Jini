import type { ChatPaneProps } from '../types.js';

/**
 * Embed is a visitor surface with a fixed backend. Workspace composer extensions and filesystem
 * controls stay outside its render tree, even if a host accidentally supplies them.
 * @complexity O(1) time and space.
 */
export function useChatPaneSurface({ variant, composerSlots, workingDirectoryControlPlacement, uploadAttachments }: Pick<ChatPaneProps,
  'variant'> & {
    composerSlots: ChatPaneProps['composerSlots'];
    workingDirectoryControlPlacement: ChatPaneProps['workingDirectoryControlPlacement'];
    uploadAttachments: ChatPaneProps['uploadAttachments'];
  }, _options = {}) {
  const embed = variant === 'embed';
  return {
    embed,
    composerSlots: embed ? undefined : composerSlots,
    workingDirectoryControlPlacement: embed ? 'none' as const : workingDirectoryControlPlacement ?? 'below',
    uploadAttachments: embed ? undefined : uploadAttachments,
  };
}
