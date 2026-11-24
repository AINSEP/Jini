import type { ComponentType, ReactNode } from "react";
import type { QueryKey, FetchQueryAdapter } from "@jini-ai/core/fetch";

/**
 * What the remote-image import dialog needs from the host's media API. The host owns the request
 * (route, auth, workspace) and the cache identity of its media list; this package owns only the
 * dialog behaviour, so neither the wire client nor a list query key is imported here.
 */
export interface MediaImportPort {
  /** Asks the host's server to fetch the image at `url`; resolves with whatever record it created. */
  importFromUrl(required: { url: string }, optional?: { alt?: string | undefined }): Promise<{ readonly media: unknown }>;
  /** Cache identity of the host's media list: invalidated after a successful import so the grid refreshes. */
  readonly listKey: QueryKey;
}

/** The host's operator-facing error text: its own fallback chain for an unknown thrown value. */
export type DescribeError = (required: { e: unknown; fallback: string }) => string;

/** The host's tooltip wrapper for the icon trigger: shows `label` beside the wrapped button. */
export type HeaderTipComponent = ComponentType<{ label: string; children: ReactNode }>;

type Attrs = Readonly<Record<string, string | boolean | undefined>>;
type NoArgs = (required: Record<string, never>, optional?: Record<string, never>) => void;

/**
 * The three kit components the dialog renders with, stated as only the props this dialog passes
 * (cms imports no UI library; owner rule: a domain package may import only core/protocol). The host
 * supplies its UI kit's components and proves compatibility with `satisfies ImportDialogKit`.
 */
export interface ImportDialogKit {
  Button: ComponentType<{
    variant?: "primary" | "secondary"; type?: "button" | "submit"; className?: string; disabled?: boolean;
    onPress?: NoArgs; attrs?: Attrs; children?: ReactNode;
  }>;
  Dialog: ComponentType<{ open: boolean; title: string; pending?: boolean; onClose: NoArgs; className?: string; children?: ReactNode }>;
  TextField: ComponentType<{
    label: string; value: string; type?: "url"; placeholder?: string; disabled?: boolean;
    onValueChange: (required: { value: string }, optional?: Record<string, never>) => void; attrs?: Attrs;
  }>;
}

/** Everything the host injects: custom hooks and components arrive as required fields, never defaults. */
export interface RemoteImageImportCollaborators {
  t: (key: string) => string;
  port: MediaImportPort;
  describeError: DescribeError;
  useFetchMutation: FetchQueryAdapter["useFetchMutation"];
}
