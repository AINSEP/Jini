/**
 * @module useArtifactStream
 *
 * Streaming artifact buffer + resolved renderer + partial-vs-complete state,
 * built purely over a message's text content via `@jini-ai/chat/core`'s
 * `parseArtifacts` (completed `<artifact>` blocks) and `splitStreamingArtifact`
 * (the currently in-flight one, if any) plus an injected `RendererRegistry`.
 * Per `foundry/docs/jini-port/recon/r4b-webui-design.md` §4.
 *
 * `ArtifactFile`/`ArtifactRenderer`/`RendererRegistry` are the local
 * placeholder shapes from `../../artifact-types.js` — see that file's
 * TODO(renderers-react) header for the follow-up to re-point this hook at
 * `@jini-ai/renderers-react`'s real exports.
 */
import { useMemo } from 'react';
import { parseArtifacts, splitStreamingArtifact } from '@jini-ai/chat/core';
import type { ArtifactFile, ArtifactRenderMatch, RendererRegistry } from '../artifact-types.js';

export interface ArtifactStreamItem {
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
  status: 'streaming' | 'complete';
  file: ArtifactFile;
  match: ArtifactRenderMatch | null;
}

export interface UseArtifactStreamResult {
  /** Every artifact found in `content`, oldest first. */
  items: ArtifactStreamItem[];
  /** The last item — the one most likely to be "the artifact this turn produced". */
  current: ArtifactStreamItem | null;
}

function toFile(item: Omit<ArtifactStreamItem, 'file' | 'match'>): ArtifactFile {
  return { name: item.identifier || item.title || 'artifact', kind: item.artifactType, content: item.content };
}

export function useArtifactStream(content: string, registry?: RendererRegistry): UseArtifactStreamResult {
  return useMemo(() => {
    const items: ArtifactStreamItem[] = [];

    // `splitStreamingArtifact` is the authority on "is there a trailing,
    // still-open artifact": split first so `parseArtifacts` (a one-shot
    // feed+flush that synthesizes an `artifact:end` for whatever is still
    // open when it's called — correct for a genuinely complete message, but
    // wrong here) only ever sees the CLOSED-artifact-only `head` portion.
    // Running it on the raw `content` would double-count a live artifact:
    // once (wrongly) as "complete" via the synthetic flush, and again (correctly)
    // as "streaming" below.
    const { head, live } = splitStreamingArtifact(content);

    let current: { identifier: string; artifactType: string; title: string; content: string } | null = null;
    for (const ev of parseArtifacts(head)) {
      if (ev.type === 'artifact:start') {
        current = { identifier: ev.identifier, artifactType: ev.artifactType, title: ev.title, content: '' };
      } else if (ev.type === 'artifact:chunk' && current && current.identifier === ev.identifier) {
        current.content += ev.delta;
      } else if (ev.type === 'artifact:end' && current && current.identifier === ev.identifier) {
        const finished = { ...current, content: ev.fullContent, status: 'complete' as const };
        items.push({ ...finished, file: toFile(finished), match: registry?.resolve({ file: toFile(finished) }) ?? null });
        current = null;
      }
    }

    // A trailing artifact whose close tag hasn't streamed in yet — surfaced
    // separately so a live preview can render mid-generation.
    if (live) {
      const streaming = { identifier: live.identifier, artifactType: live.artifactType, title: live.title, content: live.content, status: 'streaming' as const };
      items.push({ ...streaming, file: toFile(streaming), match: registry?.resolve({ file: toFile(streaming) }) ?? null });
    }

    return { items, current: items.length > 0 ? items[items.length - 1]! : null };
  }, [content, registry]);
}
