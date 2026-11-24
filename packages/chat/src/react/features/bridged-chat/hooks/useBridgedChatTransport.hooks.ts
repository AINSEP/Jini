/**
 * @file A chat pane's bridge-backed surfaces: the run transport built on the host bridge, plus the
 * runtime-access, working-directory, file-path and attachment surfaces `ChatPane` needs. All of them
 * come from one bridge lookup, so they live in one hook rather than one per concern.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ChatPaneRuntimeAccess, ChatPaneWorkingDirectoryAccess } from '../../chat-pane/types.js';
import { createStagedAttachmentUploader } from '../create-staged-attachment-uploader.js';
import type { BridgedChatTransport, ChatBridgePort, DisposableChatTransport } from '../types.js';

/**
 * @param getBridge the host's bridge lookup; called once per identity, never per render.
 * @param createTransport builds the host's run transport on the bridge. Its construction may
 *   install a listener; the hook disposes it when the bridge changes or the pane unmounts. Must
 *   be referentially stable.
 */
export function useBridgedChatTransport<B extends ChatBridgePort, TTransport extends DisposableChatTransport>(
  { getBridge, createTransport }: {
    getBridge: () => B | undefined;
    createTransport: (bridge: B) => TTransport;
  },
  _options: Record<string, never> = {},
): BridgedChatTransport<TTransport> {
  const bridge = useMemo(() => getBridge(), [getBridge]);

  const runtimeAccess = useMemo<ChatPaneRuntimeAccess | undefined>(() => {
    if (bridge === undefined) return undefined;

    return {
      listAgents: bridge.listAgents,
      rescanAgents: bridge.rescanAgents,
      daemonOnline: bridge.daemonOnline,
    };
  }, [bridge]);

  const workingDirectoryAccess = useMemo<ChatPaneWorkingDirectoryAccess | undefined>(() => {
    if (bridge === undefined) return undefined;

    return {
      normalizeWorkingDirectory: (directory) => bridge.normalizeWorkingDirectory({ directory }),
      pickWorkingDirectory: (currentDirectory) => bridge.pickWorkingDirectory({}, { currentDirectory }),
      recentDirectories: bridge.recentWorkingDirectories,
      directoryExists: (directory) => bridge.workingDirectoryExists({ directory }),
    };
  }, [bridge]);

  const [binding, setBinding] = useState<{ bridge: B; transport: TTransport }>();
  // Construction installs a listener, so setup and disposal must share an effect lifetime.
  // StrictMode can discard a render and replay setup/cleanup without rebuilding memoized values.
  // A new `createTransport` identity rebuilds the transport, so a host passes a module-level factory.
  useEffect(() => {
    if (bridge === undefined) { setBinding(undefined); return; }
    const transport = createTransport(bridge);
    setBinding({ bridge, transport });
    return () => transport.dispose();
  }, [bridge, createTransport]);
  const transport = binding?.bridge === bridge ? binding?.transport : undefined;

  // A bridge host has no HTTP server, so this is the staging uploader
  // (`create-staged-attachment-uploader.ts`), not the daemon-backed one — see that module's doc.
  const uploadAttachments = useMemo(
    () => (bridge === undefined ? undefined : createStagedAttachmentUploader({ bridge })),
    [bridge],
  );

  return {
    transport,
    runtimeAccess,
    workingDirectoryAccess,
    getPathForFile: bridge?.getPathForFile,
    uploadAttachments,
  };
}
