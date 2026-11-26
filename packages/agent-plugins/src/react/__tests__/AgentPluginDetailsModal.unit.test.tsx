// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { AgentPluginDetailsModal, type AgentPluginDetailsModalProps } from "../AgentPluginDetailsModal.js";

it("selects package files without opening a listed Admin surface", () => {
  const opened = vi.fn();
  const selectFile = vi.fn();
  function PackageFilesModal(props: ComponentProps<AgentPluginDetailsModalProps["kit"]["PackageFilesModal"]>) {
    const [view, setView] = useState(props.initialViewId ?? "files");
    return <div>
      <button onClick={() => setView("files")}>Package files</button>
      {props.additionalViews.map(item => <button key={item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
      {view === "files" ? props.files.map(file => <button key={file.relativePath} onClick={() => props.onSelectFile(file.relativePath)}>{file.relativePath}</button>)
        : props.additionalViews.find(item => item.id === view)?.custom}
    </div>;
  }
  render(<AgentPluginDetailsModal
    plugin={{ id: "writer", displayName: "Writer" }} t={key => key} onClose={vi.fn()}
    useDetails={() => ({ files: [{ relativePath: "plugin.json", content: "{}" }], selectedFile: null, selectFile })}
    useAgentPluginMemoryHook={() => ({ t: key => key, listing: null, entryPath: "project.md", text: "",
      renamePath: vi.fn(), openNote: vi.fn(), setText: vi.fn(), save: vi.fn(), saving: false, status: null,
      editorDisabled: false, pathInputId: "path", notesInputId: "notes", noteFilesHeadingId: "files",
      learnedHeadingId: "learned", notesEmptyMessage: null, learnedEmptyMessage: null })}
    useAgentPluginDetailsViewHook={() => ({ title: "Writer package files", onView: vi.fn() })}
    useAgentPluginSurfacesHook={() => [{ id: "settings", title: "Settings", src: "/settings", actions: [] }]}
    useHostAdminSurfaceFrame={() => { throw new Error("A file selection must not open a surface"); }}
    surfacesPort={{ list: vi.fn(), bootstrap: vi.fn(), action: vi.fn() }}
    kit={{ PackageFilesModal, AgentPluginMaturity: () => null, AgentPluginMemoryPanel: () => null,
      AgentPluginSurfaceFrame: () => { opened(); return <div>Admin surface</div>; } }}
  />);
  fireEvent.click(screen.getByRole("button", { name: "Package files" }));
  fireEvent.click(screen.getByRole("button", { name: "plugin.json" }));
  expect(selectFile).toHaveBeenCalledExactlyOnceWith("plugin.json");
  expect(opened).not.toHaveBeenCalled();
});
