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

it.each([false, true])("opens the Manage view and uses fresh surface metadata if listed (%s)", fresh => {
  const known = { id: "settings", title: "Cached settings", src: "/cached", actions: [] };
  const latest = { ...known, title: "Current settings", src: "/current" };
  const surfacesPort = { list: vi.fn(), bootstrap: vi.fn(), action: vi.fn() };
  const selectFile = vi.fn();
  const viewed = vi.fn();
  const close = vi.fn();
  const PackageFilesModal: AgentPluginDetailsModalProps["kit"]["PackageFilesModal"] = props => {
    const [selected, setSelected] = useState(props.initialViewId);
    return <section aria-label={props.title}>
      {props.headerExtras}
      {props.status ? <p role={props.status.role}>{props.status.text}</p> : null}
      <p>{props.listNotice}</p>
      {props.additionalViews.map(view => <button key={view.id} onClick={() => { setSelected(view.id); props.onView(view.id); }}>{view.label}</button>)}
      {props.additionalViews.find(view => view.id === selected)?.custom}
      <button onClick={props.onClose}>Close inspector</button>
    </section>;
  };
  const useHostAdminSurfaceFrame: AgentPluginDetailsModalProps["useHostAdminSurfaceFrame"] = ({ pluginId, surface, port }) => {
    if (pluginId !== "writer" || port !== surfacesPort) throw new Error("wrong frame owner");
    return { attributes: { src: surface.src, title: surface.title, sandbox: "allow-scripts", referrerPolicy: "no-referrer" },
      frameRef: { current: null }, status: "open", onLoad: () => {}, height: null, signIns: [], onSignInOpened: () => {} };
  };
  render(<AgentPluginDetailsModal
    plugin={{ id: "writer", displayName: "Writer", maturity: "untested", surfaces: [known] }} t={key => key} onClose={close}
    useDetails={() => ({ files: [], selectedFile: null, selectFile, status: { text: "Package read failed", role: "alert" }, listNotice: "Read-only listing" })}
    useAgentPluginMemoryHook={() => ({ t: key => "Memory:" + key, listing: null, entryPath: "project.md", text: "note draft",
      renamePath: vi.fn(), openNote: vi.fn(), setText: vi.fn(), save: vi.fn(), saving: false, status: null,
      editorDisabled: false, pathInputId: "path", notesInputId: "notes", noteFilesHeadingId: "files",
      learnedHeadingId: "learned", notesEmptyMessage: null, learnedEmptyMessage: null })}
    useAgentPluginDetailsViewHook={() => ({ title: "Writer inspector", onView: viewed })}
    useAgentPluginSurfacesHook={() => fresh ? [latest] : []}
    useHostAdminSurfaceFrame={useHostAdminSurfaceFrame} surfacesPort={surfacesPort}
    kit={{
      PackageFilesModal, AgentPluginMaturity: ({ maturity }) => <p>{maturity}</p>,
      AgentPluginMemoryPanel: ({ controller }) => <output>{controller.text}</output>,
      AgentPluginSurfaceFrame: ({ pluginId, surface, port, useAdminSurfaceFrame }) => {
        const { attributes } = useAdminSurfaceFrame({ pluginId, surface, port });
        return <iframe {...attributes} />;
      },
    }}
  />);
  const shown = fresh ? latest : known;
  const frame = screen.getByTitle(shown.title);
  expect(frame.getAttribute("src")).toBe(shown.src);
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(screen.getByRole("alert").textContent).toBe("Package read failed");
  expect(screen.getByText("Read-only listing").textContent).toBe("Read-only listing");
  expect(screen.getByText("untested").textContent).toBe("untested");
  fireEvent.click(screen.getByRole("button", { name: "Memory:Memory" }));
  expect(screen.queryByTitle(shown.title)).toBeNull();
  expect(screen.getByText("note draft").tagName).toBe("OUTPUT");
  expect(viewed.mock.calls).toEqual([["plugin-memory"]]);
  fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
  expect(close).toHaveBeenCalledTimes(1);
});
