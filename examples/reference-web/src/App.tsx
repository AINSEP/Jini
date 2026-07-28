import { useState } from 'react';
import type { ChatMessage } from '@jini-ai/chat-core';
import { ChatPane } from '@jini-ai/chat-react';
import { uploadChatAttachments } from './attachments.js';
import { createDaemonChatTransport } from './daemon-transport.js';
import { getDesktopBridge } from './desktop-bridge.js';
import { ProjectPreview } from './ProjectPreview.js';
import { PLAYGROUND_RUNTIME_ACCESS } from './runtime-access.js';

interface SampleProject {
  id: 'starter-site' | 'bug-hunt';
  name: string;
  eyebrow: string;
  description: string;
  accent: string;
  files: string[];
  prompts: string[];
}

const PROJECTS: SampleProject[] = [
  {
    id: 'starter-site',
    name: 'Starter Site',
    eyebrow: 'Browser project',
    description: 'A small, zero-dependency task board ready for visual changes.',
    accent: '#e86f51',
    files: ['index.html', 'styles.css', 'app.js', 'README.md'],
    prompts: [
      'Inspect this project and suggest one useful improvement.',
      'Add a filter for completed items while preserving the visual style.',
    ],
  },
  {
    id: 'bug-hunt',
    name: 'Bug Hunt',
    eyebrow: 'Test project',
    description: 'A focused JavaScript defect with a failing Node test.',
    accent: '#7b61c9',
    files: ['src/cart.js', 'test/cart.test.js', 'README.md'],
    prompts: [
      'Run the tests, explain the failure, and fix only the bug.',
      'Review the cart calculation for edge cases without changing its API.',
    ],
  },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      'I’m connected to this sample workspace through the **real Jini daemon**. The agent picker below is populated by the daemon’s live CLI probe; choose an available agent and ask it to inspect or change the project.',
    runStatus: 'succeeded',
    createdAt: Date.now(),
  },
];

const PLAYGROUND_CHAT_TRANSPORT = createDaemonChatTransport();

function shellName(): string {
  return new URLSearchParams(window.location.search).get('shell') === 'desktop' ? 'Desktop' : 'Chrome';
}

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<SampleProject['id']>('starter-site');
  const shell = shellName();
  const desktopBridge = getDesktopBridge();
  const selectedProject = PROJECTS.find((project) => project.id === selectedProjectId) ?? PROJECTS[0]!;

  return (
    <main className={`playground-shell${shell === 'Desktop' ? ' desktop-shell' : ''}`}>
      {shell === 'Desktop' ? <div className="desktop-drag-region" aria-hidden="true" /> : null}
      <aside className="project-rail">
        <div className="brand-lockup">
          <div className="brand-glyph" aria-hidden="true">J</div>
          <div>
            <strong>Jini</strong>
            <span>Agent control plane</span>
          </div>
        </div>

        <div className="rail-label">Sample workspaces</div>
        <nav className="project-list" aria-label="Sample workspaces">
          {PROJECTS.map((project) => (
            <button
              className={project.id === selectedProject.id ? 'project-card active' : 'project-card'}
              type="button"
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
            >
              <span className="project-dot" style={{ background: project.accent }} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.eyebrow}</small>
              </span>
              <span className="project-arrow">›</span>
            </button>
          ))}
        </nav>

        <div className="rail-note">
          <span>LOCAL WORKSPACE</span>
          <code>examples/sample-projects/</code>
        </div>
      </aside>

      <section className="workspace-pane">
        <header className="topbar">
          <div className="crumbs">
            <span>Playground</span>
            <b>/</b>
            <strong>{selectedProject.name}</strong>
          </div>
          <div className="topbar-status">
            <span className="surface-chip">{shell}</span>
          </div>
        </header>

        <div className="workspace-body">
          <div className="workspace-heading">
            <div>
              <span className="section-kicker">{selectedProject.eyebrow}</span>
              <h2>{selectedProject.name}</h2>
              <p>{selectedProject.description}</p>
            </div>
            <div className="workspace-badges">
              <span>Editable sample</span>
              <span>Isolated workspace</span>
            </div>
          </div>

          <ProjectPreview projectId={selectedProject.id} />

          <div className="workspace-meta">
            <div className="file-strip">
              <span>Files</span>
              {selectedProject.files.map((file) => <code key={file}>{file}</code>)}
            </div>
            <div className="parity-strip">
              <span><b>✓</b> Chrome</span>
              <span><b>✓</b> Desktop</span>
              <span><b>✓</b> HTTP + SSE</span>
              <span><b>✓</b> Local CLI agents</span>
            </div>
          </div>
        </div>
      </section>

      <aside className="chat-pane">
        <ChatPane
          key={selectedProject.id}
          title={selectedProject.name}
          transport={PLAYGROUND_CHAT_TRANSPORT}
          runtimeAccess={PLAYGROUND_RUNTIME_ACCESS}
          initialMessages={INITIAL_MESSAGES}
          initialSelection={{
            agentId: 'codex',
            model: 'gpt-5.6-terra',
            reasoning: 'medium',
          }}
          suggestions={selectedProject.prompts}
          placeholder={`Ask Jini about ${selectedProject.name}…`}
          uploadAttachments={uploadChatAttachments}
          initialWorkingDirectory={`examples/sample-projects/${selectedProject.id}`}
          {...(desktopBridge === undefined ? {} : { workingDirectoryAccess: desktopBridge })}
          projectFileNames={new Set(selectedProject.files)}
          runContext={({ selection, workingDirectory }) => ({
            project: selectedProject.id,
            workingDirectory,
            ...(selection.model === undefined ? {} : { model: selection.model }),
            ...(selection.reasoning === undefined ? {} : { reasoning: selection.reasoning }),
          })}
        />
      </aside>
    </main>
  );
}
