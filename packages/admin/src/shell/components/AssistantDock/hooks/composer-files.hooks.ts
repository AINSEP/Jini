import { partitionChatPackages } from "./chat-package-kind.js";
import { captureSkillDrop } from "../../../../screens/skills/skill-drop.js";
import { useCallback, useEffect, useMemo, type DragEvent } from "react";
import { useAdminKitChatRunValues, useAdminKitChatValues, type ChatPaneAgent, type ChatPaneWorkingDirectoryAccess, type KitUploadAttachments } from "../../../../react/kit.js";
import type { ChatAttachment, ChatAttachmentValidatorInput } from "../../../../react/kit-chat-types.js";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import type { orFallbackSync } from "@jini-ai/core/errors/idioms";

import { createBrowserWorkingDirectoryAccess } from "../../../lib/browser-working-directory-access.js";
import { useFolderDrop, type UseFolderDrop, type UseFolderDropDeps, type UseFolderDropInput } from "../../../../screens/fs-files/use-folder-drop.hooks.js";

/**
 * Builds the `uploadAttachments` callback the dock passes to `<ChatPane>`. Injectable per the
 * Components rule 3 (real I/O: every upload is a `fetch` to the daemon's own `/api/attachments`
 * route) — the host defaults it to this hook on its dock props.
 *
 * `''` baseUrl: the kit's `createDaemonAttachmentUploader` builds `${baseUrl}/api/attachments`, so an empty
 * string resolves to the same bare `/api/attachments` relative path the agents URL and the rescan route
 * already use — same-origin, proxied by the host's server to the agent
 * daemon, matching every other request this dock makes. Memoized for the same reason the transport
 * is: it owns internal per-uploader batch-quota state (`create-daemon-attachment-uploader.ts`'s
 * `batchUsage` map), so rebuilding it on every render would silently reset a turn's running quota
 * mid-upload.
 *
 * `fetch` is the host's: the uploader never reaches for a global, so a host can route uploads through
 * its own authenticated or proxied transport. `limits` mirror the host daemon's own per-file/per-turn caps so a rejection
 * surfaces before any bytes are sent, rather than only after the daemon's own enforcement rejects them.
 *
 * @returns The memoized uploader instance.
 * @example
 * const uploadAttachments = useAttachmentUploader({ fetch }, { maxAttachmentBytes, maxAttachmentBytesFor, maxBatchBytes });
 */
export function useAttachmentUploader(
  { fetch }: { fetch: typeof globalThis.fetch },
  { maxAttachmentBytes, maxAttachmentBytesFor, maxBatchBytes }: {
    maxAttachmentBytes?: number;
    /** Per-file cap chosen by the host (e.g. a larger limit for video); wins over `maxAttachmentBytes` for that file. */
    maxAttachmentBytesFor?: (file: { readonly name: string; readonly type: string }) => number;
    maxBatchBytes?: number;
  } = {},
): KitUploadAttachments {
  const { createDaemonAttachmentUploader } = useAdminKitChatRunValues();
  return useMemo(
    () => createDaemonAttachmentUploader({ baseUrl: "", fetch }, {
      ...(maxAttachmentBytes === undefined ? {} : { maxAttachmentBytes }),
      ...(maxAttachmentBytesFor === undefined ? {} : { maxAttachmentBytesFor }),
      ...(maxBatchBytes === undefined ? {} : { maxBatchBytes }),
    }),
    [createDaemonAttachmentUploader, fetch, maxAttachmentBytes, maxAttachmentBytesFor, maxBatchBytes],
  );
}

/**
 * Routes skill packages to the install proposal; ordinary files retain their uploader result.
 * @returns A stable callback, refreshed when either injected dependency changes.
 * @complexity O(files) selection time and O(1) routing space; upload costs belong to the adapters.
 */
export function useSkillAwareAttachmentUploader(
  { uploadAttachments, proposeFiles, legacyManifestNames }: {
    uploadAttachments: KitUploadAttachments;
    proposeFiles: (files: readonly File[]) => Promise<void>;
    legacyManifestNames: readonly string[];
  },
  _optional: Record<string, never> = {},
): KitUploadAttachments {
  // `legacyManifestNames` are the host's older plugin-manifest aliases, still recognised as skill packages.
  return useCallback(async (files, options) => {
    const { skills, attachments } = await partitionChatPackages({ files, legacyManifestNames });
    if (skills.length > 0) await proposeFiles(skills);
    if (attachments.length === 0) return [];
    // The composer owns the message batch and cancellation lifetime. Dropping these options
    // makes separate attach actions create different batches, which the daemon cannot claim.
    return options === undefined ? uploadAttachments(attachments) : uploadAttachments(attachments, options);
  }, [uploadAttachments, proposeFiles, legacyManifestNames]);
}

/**
 * Allows skill selection until the selected local runtime explicitly reports no tools.
 * @returns Whether the current runtime can receive skill guidance.
 * @complexity O(agents) time, O(1) space.
 */
export function resolveSkillsAvailable(
  { executionMode, selectedAgentId, agents }: {
    executionMode: ExecutionConfig["mode"];
    selectedAgentId: string;
    agents: readonly Pick<ChatPaneAgent, "id" | "supportsTools">[] | undefined;
  },
): boolean {
  return executionMode === "byok" || agents?.find(agent => agent.id === selectedAgentId)?.supportsTools !== false;
}

/**
 * Builds the `validateAttachments` callback the dock passes to `<ChatPane>` — the host
 * half of restoring a persisted composer draft's ATTACHMENTS. Injectable per the Components
 * rule 3 for the same reason {@link useAttachmentUploader} above is: every probe is a real `fetch`
 * to the host's read-back route, which a fake bypasses entirely. `input` is the host's route and
 * reference grammar (endpoint, supported-ref test, probe cap, `fetch`); the kit owns the bounded probing.
 *
 * Without this prop the chat library restores such a draft's TEXT only: it persists the attachment
 * references, but hands back none that no host has vouched for, because the staged bytes sit under
 * the daemon's one-hour `retentionMs` and a chip for a pruned file looks intact and dies at send.
 * A HEAD request answers whether the file is still staged.
 *
 * Memoized for the same reason the uploader is: `ChatPane` reads this on a draft restore at mount,
 * and a new identity each render would make that a moving dependency.
 *
 * @returns The memoized validator instance.
 * @example
 * const validateAttachments = useAttachmentValidator({ input });
 */
export function useAttachmentValidator(
  { input }: { input: ChatAttachmentValidatorInput },
  _optional: Record<string, never> = {},
): (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]> {
  const { createChatAttachmentValidator } = useAdminKitChatValues();
  return useMemo(() => createChatAttachmentValidator(input), [createChatAttachmentValidator, input]);
}

/**
 * Builds the composer's native working-directory access — see
 * `browser-working-directory-access`'s module doc for the File System Access API details
 * and its known folder-NAME-not-path limitation. Injectable per the Components rule 3
 * (this is a browser API, `window.showDirectoryPicker`) — the host defaults it to this hook on its dock props.
 * `recentDirectoryNamesStorageKey` is host-owned so lists already saved under it survive.
 *
 * Memoized for the same reason `useAttachmentUploader` above is: the returned object's identity
 * feeds `ChatPane`'s own `workingDirectoryAccess`-changed effect
 * (`useChatPaneWorkingDirectory.hooks.ts`), so a new object on every render would re-run that
 * effect's directory validation on every render too.
 *
 * @returns The memoized access object, or `undefined` on a browser with no native picker (Safari,
 * Firefox) — `ChatPane` falls back to its own text-input popover when this is `undefined`.
 * @example
 * const workingDirectoryAccess = useWorkingDirectoryAccess({ recentDirectoryNamesStorageKey, orFallbackSync });
 */
export function useWorkingDirectoryAccess(
  { recentDirectoryNamesStorageKey, orFallbackSync: guarded }: { recentDirectoryNamesStorageKey: string; orFallbackSync: typeof orFallbackSync },
  _optional: Record<string, never> = {},
): ChatPaneWorkingDirectoryAccess | undefined {
  return useMemo(() => createBrowserWorkingDirectoryAccess({ recentDirectoryNamesStorageKey, orFallbackSync: guarded }), [recentDirectoryNamesStorageKey, guarded]);
}

/**
 * Bridges `useFolderDrop`'s imperative `handleDropCapture` out of the dock to the wrapping
 * `<aside onDropCapture={...}>` the host renders — the dock component itself holds "props
 * interface + JSX, and nothing else", so the `useEffect` that publishes
 * the handler through a caller-supplied ref lives here, not there. Not a `use*Seam` wrapper like its
 * neighbors above: `useFolderDrop` is this feature's own hook, not an existing DOM/IO hook this
 * component previously called bare, so there is no "real hook to default to when no override is
 * given" to resolve.
 *
 * @param input.input - {@link UseFolderDropInput} — passed straight through to `useFolderDrop`.
 * @param input.onReady - the dock's `onFolderDropCaptureReady`. Invoked once per identity change
 *   of `handleDropCapture` (which itself only changes if `input.composerHandle` or `useFolderDrop`'s
 *   internal callbacks change — effectively once per mount). `undefined` when the caller (e.g. a
 *   test rendering the dock directly) does not care to receive it.
 * @param input.folderDropDeps - the host's file-system ports, passed straight through to `useFolderDrop`.
 * @returns {@link UseFolderDrop} — the dock renders `notice`/`dismiss`/`retry` from this
 *   directly; `handleDropCapture` is consumed only via `onReady` above, never by the dock
 *   itself (nothing there needs to call it directly).
 * @complexity Time/space: O(1) beyond what `useFolderDrop` itself costs.
 */
export function useFolderDropBridge(
  { input, onReady, folderDropDeps }: {
    input: UseFolderDropInput;
    onReady: ((handleDropCapture: (event: DragEvent<HTMLElement>) => void) => void) | undefined;
    folderDropDeps: UseFolderDropDeps;
  },
  { proposeSkillFiles, onSkillDropError, useFolder = useFolderDrop }: {
    useFolder?: typeof useFolderDrop;
    proposeSkillFiles?: (files: readonly File[], paths?: readonly string[]) => Promise<void>;
    onSkillDropError?: (message: string) => void;
  } = {},
): UseFolderDrop {
  const folderDrop = useFolder(input, folderDropDeps);
  const handleDropCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (proposeSkillFiles && captureSkillDrop({ event, proposeFiles: proposeSkillFiles, fallback: folderDrop.handleDropCapture }, onSkillDropError ? { onError: onSkillDropError } : {})) return;
    folderDrop.handleDropCapture(event);
  }, [proposeSkillFiles, folderDrop.handleDropCapture, onSkillDropError]);
  useEffect(() => { onReady?.(handleDropCapture); }, [onReady, handleDropCapture]);
  return { ...folderDrop, handleDropCapture };
}
