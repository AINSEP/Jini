# folder-path-drop

Recovering a dropped folder's real path: `captureFolderPathDrop` / `useFolderPathDropCapture` insert
it as text into a composer, and `useClassifiedPathDrop` turns a whole page into a drop target that
routes each drop to a folder, archive or refusal handler. Public entries: `@jini-ai/ui` (hooks and
rules) and `@jini-ai/ui/core` (framework-free rules and types). Architecture:
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

- **Needs injected:** `FolderPathDropPort` (`getPathForFile`, the host's real-path lookup) for the
  capture rules. `useClassifiedPathDrop` takes the host's `classifyDrop({ dataTransfer })` and
  `classifyFiles({ files })` classifiers (each returning a `ClassifiedPathDrop`; refusal copy is the
  host's), `busy`, and the `onFolder` / `onArchive` / `onRefused` callbacks.
- **Provides:** `{ dragging, dropProps, onPicked }`: spread `dropProps` on the page root (the drop
  is taken in the capture phase and stopped there), feed `onPicked` the files a drop zone's own
  picker returned. The highlight resets on every drop, refused ones included.
- **Hooks reach Jini components as required props:** a host page component may call the hook
  directly; a Jini component takes it as a required hook prop.
- **Must never import:** host bridges/IPC, host classification or copy, `console`.

```tsx
import { useClassifiedPathDrop } from '@jini-ai/ui';

const getPathForFile = (file: File) => hostBridge.getPathForFile(file) ?? '';
function ImportPage({ busy, onFolder, onArchive, onRefused }) {
  const { dragging, dropProps } = useClassifiedPathDrop({ busy, onFolder, onArchive, onRefused,
    classifyDrop: ({ dataTransfer }) => hostClassifyDrop({ dataTransfer, getPathForFile }),
    classifyFiles: ({ files }) => hostClassifyFiles({ files, getPathForFile }) });
  return <section {...dropProps} data-dragging={dragging}>…</section>;
}
```
