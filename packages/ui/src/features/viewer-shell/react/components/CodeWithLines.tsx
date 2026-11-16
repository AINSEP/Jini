import { Fragment } from 'react';

export interface CodeWithLinesProps {
  text: string;
  /** Wrap long lines. Default false: two `white-space: pre` blocks (gutter + code). */
  wrap?: boolean;
}

/**
 * Wrap-safe layout, used only while wrapping is on. The default layout renders the gutter and the
 * code as two independent `white-space: pre` blocks that stay aligned only because neither one
 * wraps — the instant a code line wraps to more than one visual row, every later gutter number
 * drifts out of sync with its line. This lays out one CSS grid row per source line instead
 * (`.jini-code-viewer--wrap`, styled by the host): a wrapped line's row simply grows taller, and
 * its own gutter number grows with it, so nothing downstream can ever desync.
 */
function WrappedCode({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="code-viewer jini-code-viewer--wrap">
      {lines.map((line, i) => (
        <Fragment key={i}>
          <span className="jini-code-viewer__line-number" aria-hidden>
            {i + 1}
          </span>
          <span className="jini-code-viewer__line-content">{line}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** Plain text rendered with a line-number gutter; `wrap` switches to one grid row per line. */
export function CodeWithLines({ text, wrap = false }: CodeWithLinesProps) {
  if (wrap) return <WrappedCode text={text} />;
  const lines = text.split('\n');
  // Trailing newline produces a phantom empty line — keep gutter aligned.
  const gutter = lines.map((_, i) => `${i + 1}`).join('\n');
  return (
    <pre className="code-viewer">
      <code className="gutter" aria-hidden>
        {gutter}
      </code>
      <code className="lines">{text}</code>
    </pre>
  );
}
