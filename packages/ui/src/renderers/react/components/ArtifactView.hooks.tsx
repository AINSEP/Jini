import { useMemo, type ReactNode } from 'react';
import { AnnotationCanvas } from '../../annotation-canvas/index.js';
import type { ArtifactViewProps } from './ArtifactView.js';

/** Resolve the artifact once per input change and apply an optional annotation overlay. */
export function useArtifactView({ file, registry, hints, annotation }: Pick<ArtifactViewProps, 'file' | 'registry' | 'hints' | 'annotation'>, _options = {}) {
  const match = useMemo(() => registry.resolve({ file }, { hints }), [registry, file, hints]);
  const wrap = (node: ReactNode): ReactNode => (annotation ? <AnnotationCanvas {...annotation}>{node}</AnnotationCanvas> : node);
  return { match, wrap };
}
