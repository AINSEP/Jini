/**
 * @module useArtifactStream
 *
 * Streaming artifact buffer + resolved renderer + partial-vs-complete state,
 * built purely over a message's text content via `@jini-ai/chat/core`'s
 * `parseArtifacts` (completed `<artifact>` blocks) and `splitStreamingArtifact`
 * (the currently in-flight one, if any) plus an injected `RendererRegistry`.
 * Per `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4.
 *
 * `ArtifactFile`/`ArtifactRenderer`/`RendererRegistry` are the local
 * placeholder shapes from `../../artifact-types.js` — see that file's
 * TODO(renderers-react) header for the follow-up to re-point this hook at
 * `@jini-ai/renderers-react`'s real exports.
 */
import { useMemo } from 'react';
import { parseArtifacts, splitStreamingArtifact } from '../../core/index.js';
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

type ArtifactStreamBase = Omit<ArtifactStreamItem, 'file' | 'match'>;
type ArtifactMeta = Pick<ArtifactStreamItem, 'identifier' | 'artifactType' | 'title'>;

function toItem(base: ArtifactStreamBase, { registry }: { registry?: RendererRegistry | undefined }): ArtifactStreamItem {
  const file: ArtifactFile = { name: base.identifier || base.title || 'artifact', kind: base.artifactType, content: base.content };
  return { ...base, file, match: registry?.resolve({ file }) ?? null };
}

/**
 * Completed artifacts in `head`, oldest first. Only `artifact:start` (for the
 * metadata) and `artifact:end` (whose `fullContent` is the whole body) are
 * needed — `artifact:chunk` deltas are already folded into `fullContent`.
 * `createArtifactParser` never nests and always emits an `artifact:end` with
 * the same identifier right after its `artifact:start`'s chunks, so `meta` is
 * always set when an end arrives.
 */
function collectCompleted(head: string, { registry }: { registry?: RendererRegistry | undefined }): ArtifactStreamItem[] {
  const items: ArtifactStreamItem[] = [];
  let meta: ArtifactMeta | null = null;
  for (const ev of parseArtifacts({ content: head })) {
    if (ev.type === 'artifact:start') {
      meta = { identifier: ev.identifier, artifactType: ev.artifactType, title: ev.title };
      continue;
    }
    if (ev.type === 'artifact:end') {
      items.push(toItem({ ...meta!, content: ev.fullContent, status: 'complete' }, { registry }));
    }
  }
  return items;
}

export function useArtifactStream({ content }: { content: string }, { registry }: { registry?: (RendererRegistry) | undefined } = {}): UseArtifactStreamResult {
  return useMemo(() => {
    // `splitStreamingArtifact` is the authority on "is there a trailing,
    // still-open artifact": split first so `parseArtifacts` (a one-shot
    // feed+flush that synthesizes an `artifact:end` for whatever is still
    // open when it's called — correct for a genuinely complete message, but
    // wrong here) only ever sees the CLOSED-artifact-only `head` portion.
    // Running it on the raw `content` would double-count a live artifact:
    // once (wrongly) as "complete" via the synthetic flush, and again (correctly)
    // as "streaming" below.
    const { head, live } = splitStreamingArtifact({ content: content });
    const items = collectCompleted(head, { registry });

    // A trailing artifact whose close tag hasn't streamed in yet — surfaced
    // separately so a live preview can render mid-generation.
    if (live) items.push(toItem({ ...live, status: 'streaming' }, { registry }));

    return { items, current: items.at(-1) ?? null };
  }, [content, registry]);
}
