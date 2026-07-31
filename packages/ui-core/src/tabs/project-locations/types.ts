/**
 * Origin: `ProjectLocationsSection.tsx` (239 lines) and the `ProjectLocation`
 * contract it renders (`packages/contracts/src/api/projects.ts:349`).
 *
 * GENERIC despite looking desktop-specific. Jini is a reusable engine, so any
 * host that lets an operator nominate a set of roots — local folders in a
 * desktop app, mounted volumes, remote workspace paths — needs these rules.
 * Nothing here touches a filesystem or a folder-picker dialog; those stay in
 * the host, behind its own port. What is ported is the bookkeeping around the
 * list, which is where the origin's actual bugs would live.
 */

/** One configured root. */
export interface ProjectLocation {
  id: string;
  name: string;
  path: string;
  /**
   * Ships with the host and cannot be removed or edited. Built-ins are
   * filtered out of every editable projection — the operator manages only
   * what they added.
   */
  builtIn?: boolean;
}

/**
 * A row in the editor, which may not exist server-side yet.
 *
 * `id` is absent for a location the operator just added — that is what tells
 * the host to create rather than update.
 */
export interface ProjectLocationDraft {
  id?: string;
  path: string;
}

/** The persisted (non-built-in) shape a host stores in its own config. */
export interface StoredProjectLocation {
  id: string;
  name: string;
  path: string;
}
