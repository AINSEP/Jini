import cartSource from '../../sample-projects/bug-hunt/src/cart.js?raw';
import cartTest from '../../sample-projects/bug-hunt/test/cart.test.js?raw';

interface ProjectPreviewProps {
  projectId: 'starter-site' | 'bug-hunt';
}

export function ProjectPreview({ projectId }: ProjectPreviewProps) {
  if (projectId === 'starter-site') {
    return (
      <div className="browser-preview">
        <div className="browser-chrome">
          <span className="traffic-lights" aria-hidden="true"><i /><i /><i /></span>
          <div className="address-bar">
            <span>⌕</span>
            <code>sample.local/starter-site</code>
          </div>
          <span className="preview-live"><i /> Live</span>
        </div>
        <iframe
          title="Starter Site live preview"
          src="/sample-preview/starter-site/index.html"
          sandbox="allow-scripts"
        />
      </div>
    );
  }

  return (
    <div className="code-preview">
      <div className="code-tabs">
        <span className="active">src/cart.js</span>
        <span>test/cart.test.js</span>
        <b>Intentional failing test</b>
      </div>
      <div className="code-columns">
        <pre><code>{cartSource}</code></pre>
        <pre><code>{cartTest}</code></pre>
      </div>
    </div>
  );
}
