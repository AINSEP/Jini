import type { AgentPluginMemoryController } from "./hooks/use-agent-plugin-memory.hooks.js";

/** All state and requests live in the hook; this pane only renders its controller. */
export function AgentPluginMemoryPanel({ controller: c }: { controller: AgentPluginMemoryController }) {
  return <div className="card field-group">
    <p className="field-hint">{c.t("Notes load automatically when this plugin is used.")}</p>
    <div className="field">
      <label className="field-label" htmlFor={c.pathInputId}>{c.t("Note file")}</label>
      <input id={c.pathInputId} value={c.entryPath} onChange={event => c.renamePath({ entryPath: event.target.value })} disabled={c.editorDisabled} />
    </div>
    <div className="field">
      <label className="field-label" htmlFor={c.notesInputId}>{c.t("Project notes")}</label>
      <textarea id={c.notesInputId} rows={12} value={c.text} onChange={event => c.setText({ text: event.target.value })} disabled={c.editorDisabled} />
    </div>
    <div>
      <button className="btn-primary" type="button" onClick={c.save} disabled={c.editorDisabled}>{c.t("Save note")}</button>
    </div>
    {c.status ? <p className="field-hint" role="status">{c.status}</p> : null}
    <section className="field-group" aria-labelledby={c.noteFilesHeadingId}>
      <h3 className="card-title" id={c.noteFilesHeadingId}>{c.t("Note files")}</h3>
      {c.notesEmptyMessage ? <p className="field-hint">{c.notesEmptyMessage}</p> : null}
      {c.listing?.notes.map(file => <div key={file.relativePath}><button className="btn-secondary" type="button" onClick={() => c.openNote({ entryPath: file.relativePath })} disabled={c.saving}>{file.relativePath}</button></div>)}
    </section>
    <section className="field-group" aria-labelledby={c.learnedHeadingId}>
      <h3 className="card-title" id={c.learnedHeadingId}>{c.t("Learned knowledge")}</h3>
      {c.learnedEmptyMessage ? <p className="field-hint">{c.learnedEmptyMessage}</p> : null}
      {c.listing?.learned.map(file => <details key={file.relativePath}><summary>{file.relativePath}</summary><pre>{file.text}</pre></details>)}
    </section>
  </div>;
}
