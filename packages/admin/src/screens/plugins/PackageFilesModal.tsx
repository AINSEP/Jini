import { CodeWithLines, CodeWrapToggle, RemixIcon, useCodeWrap } from "@jini-ai/ui";
import { PreviewModalShell } from "@jini-ai/ui/preview-modal-shell";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { useId, type ReactNode } from "react";


import { packageFileIconKind, type PackageFileIconKind } from "../../agent-plugins/index.js";
import { useAgentPluginFileTree } from "../../agent-plugins/react/index.js";
import { PACKAGE_FILE_TREE_LOCALE } from "./rules.js";
import type { PackageFilesStatus, PackageFileView } from "./rules.js";
import { CODE_PREVIEW_MODAL_ICONS } from "../../shell/components/CodeView/preview-modal-icons.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The read-only package-files browser BOTH plugin screens open — a VS Code-style file tree
 * (files first, chevrons, indent guides, file-type icons; since 2026-09-29) on the left, the
 * selected file's source on the right with a Wrap toggle, inside Jini's `PreviewModalShell` (which
 * supplies the expand and close controls). Extracted 2026-09-13 out of `AgentPluginDetailsModal.tsx`
 * so Agent Plugins and Plugins render through one component and cannot drift apart.
 *
 * Presentational only: it loads nothing and holds no data. Each caller owns its source and passes
 * files in — Agent Plugins and Plugins both read the installed package live from the server via
 * `AGENT_PLUGIN_FILES` / `PLUGIN_FILES` (see `hooks/use-agent-plugin-details-modal.hooks.ts` and
 * `hooks/use-plugin-package-files.hooks.ts`).
 *
 * Class names keep the `agent-plugin-source-*` prefix they had before the extraction, so
 * `styles.css` needed no change.
 */

export interface PackageFilesModalProps {
  readonly title: string;
  readonly headerExtras?: ReactNode;
  readonly subtitle?: string;
  readonly files: readonly PackageFileView[];
  readonly selectedFile: PackageFileView | null;
  readonly onSelectFile: (relativePath: string) => void;
  /** Shown in the content pane while no file is selected: loading, a load failure, or no files. */
  readonly status: PackageFilesStatus | null;
  /** One line above the file list, e.g. that the viewer's caps left some files out. */
  readonly listNotice?: string | null | undefined;
  /** Prefix for each file row's agent handle (`agent-plugin-file`, `plugin-file`). */
  readonly handlePrefix: string;
  readonly t: Translate;
  readonly onClose: () => void;
  readonly additionalViews?: readonly { id: string; label: string; custom: ReactNode }[];
  /** Forward the shared shell's selected-view notification so the host can update its header. */
  readonly onView?: (viewId: string) => void;
  /** The view to open on (an additional view's id); the package files otherwise. */
  readonly initialViewId?: string;
}

/** A package-relative path with a `<wbr>` after every `/` (visual QA, 2026-08-31). Used by the
 *  content pane's heading since the file list became a tree (2026-09-29). Paths run
 *  long (`skills/interface-design/references/commands/critique.md`) — without a preferred break point
 *  `overflow-wrap: anywhere` (styles.css) was free to split mid-filename, e.g. leaving a lone `d`
 *  orphaned on its own line after "critique.m". `<wbr>` only offers the browser a *preferred* spot
 *  to break, so `overflow-wrap: anywhere` still catches the rare segment too long for the pane on
 *  its own — this only makes the common case break at a path boundary instead of a word. */
function PackageFilePath({ path }: { path: string }) {
  const segments = path.split("/");
  return (
    <>
      {segments.map((segment, i) => (
        <span key={i}>
          {segment}
          {i < segments.length - 1 ? "/" : null}
          {i < segments.length - 1 ? <wbr /> : null}
        </span>
      ))}
    </>
  );
}

/** RemixIcon glyph per file family (Jini's {@link packageFileIconKind}). The
 *  `is-<kind>` class on the icon carries its tint (styles.css). */
const FILE_ICON_GLYPH: Readonly<Record<PackageFileIconKind, string>> = {
  json: "braces-line",
  markdown: "markdown-line",
  javascript: "javascript-line",
  typescript: "code-s-slash-line",
  config: "settings-3-line",
  html: "html5-line",
  css: "css3-line",
  image: "image-line",
  shell: "terminal-box-line",
  text: "file-text-line",
  file: "file-line",
};

/** Folder state and file type determine only the decorative tree glyphs. */
function PackageTreeIcon({ folder, expanded, name }: { folder: boolean; expanded: boolean; name: string }) {
  if (folder) return <>
    <RemixIcon name={expanded ? "arrow-down-s-line" : "arrow-right-s-line"} size={16} className="agent-plugin-source-tree-twistie" />
    <RemixIcon name={expanded ? "folder-open-line" : "folder-line"} className="agent-plugin-source-tree-icon is-folder" />
  </>;
  return <>
    <span className="agent-plugin-source-tree-twistie" aria-hidden />
    <RemixIcon name={FILE_ICON_GLYPH[packageFileIconKind({ fileName: name })]} className={`agent-plugin-source-tree-icon is-${packageFileIconKind({ fileName: name })}`} />
  </>;
}

/**
 * The file list as a WAI-ARIA tree, one flat row per visible node (`aria-level` carries the
 * nesting), so the selected row's highlight spans the pane's full width the way VS Code's does.
 * Expansion, focus and keys are Jini's `useAgentPluginFileTree`; a row's full path is its tooltip, since long
 * names truncate rather than wrap. File rows keep the `…-select` agent handles the flat list had.
 */
function PackageFileTree({
  files,
  selectedPath,
  onSelectFile,
  fileHandleByPath,
  handlePrefix,
  label,
  hooks = { useAgentPluginFileTree },
}: {
  files: readonly PackageFileView[];
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
  fileHandleByPath: ReadonlyMap<string, string | undefined>;
  handlePrefix: string;
  label: string;
  hooks?: { useAgentPluginFileTree: typeof useAgentPluginFileTree };
}) {
  const tree = hooks.useAgentPluginFileTree(
    { files: files.map((file) => ({ relativePath: file.relativePath, sizeBytes: 0, content: file.content, omitted: null })), selectedPath, onOpen: ({ path }) => onSelectFile(path) },
    { locale: PACKAGE_FILE_TREE_LOCALE },
  );
  // Jini's rows carry `expanded` only on folders, so it doubles as the folder test.
  const folderPaths = tree.rows.filter((row) => row.expanded !== undefined).map((row) => row.path);
  const folderHandles = buildAgentListHandles({ prefix: `${handlePrefix}-folder`, ids: folderPaths });
  const folderHandleByPath = new Map(folderPaths.map((path, index) => [path, folderHandles[index]]));

  return (
    <div role="tree" aria-label={label} className="agent-plugin-source-tree" onKeyDown={tree.onKeyDown}>
      {tree.rows.map((row) => {
        const folder = row.expanded !== undefined;
        const expanded = row.expanded === true;
        const handle = folder
          ? agentHandle({ handle: `${folderHandleByPath.get(row.path)}-toggle` }, { role: "button", label: `Expand or collapse the "${row.path}" folder` })
          : agentHandle({ handle: `${fileHandleByPath.get(row.path)}-select` }, { role: "button", label: `Select the "${row.path}" file` });
        return (
          <div
            key={row.key}
            role="treeitem"
            aria-label={row.name}
            aria-level={row.depth}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            aria-expanded={row.expanded}
            aria-selected={row.selected}
            tabIndex={row.tabIndex}
            title={row.path}
            data-tree-path={row.path}
            className="agent-plugin-source-tree-row"
            onClick={row.onClick}
            onFocus={row.onFocus}
            {...handle}
          >
            <span className="agent-plugin-source-tree-indent" style={{ width: `calc(${row.depth - 1} * var(--tree-indent))` }} aria-hidden />
            <PackageTreeIcon folder={folder} expanded={expanded} name={row.name} />
            <span className="agent-plugin-source-tree-label">{row.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Keyed by `file.relativePath` in the parent, so switching the selected file remounts this and
 * resets `wrap` to its default rather than carrying a manual toggle across files.
 *
 * Defaults to wrapped for every file. Previously unwrapped for `plugin.json`/`.ts` sources on the
 * theory that structure reads better with no wrap; in practice the most likely first click in this
 * modal (`plugin.json`) ran a long line off the pane indefinitely, and the owner had to scroll
 * horizontally just to read it (owner correction, 2026-09-10). The toggle keeps unwrapped one click
 * away for whoever genuinely wants raw structure.
 *
 * A file listed without content (binary, too large, a symlink) shows its reason instead, and has no
 * Wrap toggle — there is nothing to wrap.
 */
function PackageFileContent({
  file,
  headingId,
  agentHandleBase,
  t,
  hooks = { useCodeWrap },
}: {
  file: PackageFileView;
  headingId: string;
  agentHandleBase: string;
  t: Translate;
  hooks?: { useCodeWrap: typeof useCodeWrap };
}) {
  const { wrap, toggleWrap } = hooks.useCodeWrap();
  const hasContent = file.content !== null;

  return (
    <section className="agent-plugin-source-content" aria-labelledby={headingId}>
      <div className="agent-plugin-source-content-header">
        <h3 id={headingId}>
          <PackageFilePath path={file.relativePath} />
        </h3>
        {hasContent ? (
          <CodeWrapToggle wrap={wrap} onToggle={toggleWrap} t={t} agentHandleId={`${agentHandleBase}-wrap-toggle`} />
        ) : null}
      </div>
      <PackageFileBody file={file} wrap={wrap} />
    </section>
  );
}

function PackageFileBody({ file, wrap }: { file: PackageFileView; wrap: boolean }) {
  if (file.content === null) {
    return (
      <p className="notice" role="status">
        {file.unavailableReason}
      </p>
    );
  }
  return <CodeWithLines text={file.content} wrap={wrap} />;
}

interface PackageSourceBrowserProps extends Pick<PackageFilesModalProps, "files" | "selectedFile" | "onSelectFile" | "status" | "listNotice" | "handlePrefix" | "t"> {
  selectedHandle: string | undefined;
  fileHandleByPath: ReadonlyMap<string, string | undefined>;
  headingId: string;
}

/** The two-pane body of the modal's "Package files" view: the file tree beside the selected file. */
function PackageSourceBrowser({ files, selectedFile, selectedHandle, fileHandleByPath, onSelectFile, status, listNotice, handlePrefix, headingId, t }: PackageSourceBrowserProps) {
  return (
    <div className="agent-plugin-source-browser">
      <nav className="agent-plugin-source-files" aria-label={t("Package files")}>
        {listNotice ? (
          <p className="page-description" role="note">
            {listNotice}
          </p>
        ) : null}
        <PackageFileTree
          files={files}
          selectedPath={selectedFile?.relativePath ?? null}
          onSelectFile={onSelectFile}
          fileHandleByPath={fileHandleByPath}
          handlePrefix={handlePrefix}
          label={t("Package files")}
        />
      </nav>
      {selectedFile && selectedHandle !== undefined ? (
        <PackageFileContent
          file={selectedFile}
          headingId={headingId}
          key={selectedFile.relativePath}
          agentHandleBase={selectedHandle}
          t={t}
        />
      ) : null}
      {!selectedFile && status ? <p role={status.role}>{status.text}</p> : null}
    </div>
  );
}

export function PackageFilesModal({
  title,
  headerExtras,
  subtitle,
  files,
  selectedFile,
  onSelectFile,
  status,
  listNotice,
  handlePrefix,
  t,
  onClose,
  additionalViews = [],
  onView,
  initialViewId,
}: PackageFilesModalProps) {
  const selectedFileHeadingId = useId();
  // File paths are stable and unique within one package, same per-row-handle derivation every
  // other list on this workstream uses (`buildAgentListHandles`).
  const fileHandles = buildAgentListHandles({ prefix: handlePrefix, ids: files.map((file) => file.relativePath) }
  );
  const fileHandleByPath = new Map(files.map((file, index) => [file.relativePath, fileHandles[index]]));
  const selectedHandle = selectedFile ? fileHandleByPath.get(selectedFile.relativePath) : undefined;
  if (selectedFile && selectedHandle === undefined) throw new Error(`package file ${selectedFile.relativePath} has no handle`);

  return (
    <PreviewModalShell
      className="agent-plugin-source-modal"
      icons={CODE_PREVIEW_MODAL_ICONS}
      title={title}
      headerExtras={headerExtras}
      subtitle={subtitle}
      onView={onView}
      initialViewId={initialViewId}
      views={[
        {
          id: "package-source",
          label: t("Package files"),
          custom: (
            <PackageSourceBrowser
              files={files}
              selectedFile={selectedFile}
              selectedHandle={selectedHandle}
              fileHandleByPath={fileHandleByPath}
              onSelectFile={onSelectFile}
              status={status}
              listNotice={listNotice}
              handlePrefix={handlePrefix}
              headingId={selectedFileHeadingId}
              t={t}
            />
          ),
        },
        ...additionalViews,
      ]}
      onClose={onClose}
    />
  );
}
