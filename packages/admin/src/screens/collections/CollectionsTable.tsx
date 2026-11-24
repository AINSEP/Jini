import { agentHandle, type buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { DataTable } from "../../react/components/DataTable.js";
import { RowMenu } from "../../react/components/RowMenu/RowMenu.js";
import type { AdminContentType } from "./api/collections-api.types.js";
import type { CollectionsListParts } from "./collections-screen-parts.js";
import type { CollectionsController } from "./hooks/use-collections.hooks.js";

/**
 * @file The content-type table of the Collections list screen — its columns, empty state and the
 * three per-row cells that carry agent handles (entries link, embed-copy button, actions menu).
 * Split out of `Collections.tsx` so each stays under the function-size ceiling; same markup, same
 * handles, same row keys.
 */

type RowHandles = ReturnType<typeof buildAgentListHandles>;
type RowController = Pick<CollectionsController, "t" | "copyEmbedCode" | "copiedKey" | "copyFallback" | "setEditingFieldsFor"
  | "setPendingLifecycle" | "runLifecycle" | "locale">;

export type CollectionsTableProps = RowController
  & Pick<CollectionsListParts, "StatusLabel" | "contentTypeMenuItems">
  & { types: AdminContentType[]; rowHandles: RowHandles };

export function renderCollectionsTable(props: CollectionsTableProps) {
  const { types, t, rowHandles, copyEmbedCode, copiedKey, copyFallback, StatusLabel } = props;
  return (
    <DataTable
      rows={types}
      rowKey={(ct) => ct.key}
      empty={renderCollectionsEmpty({ t })}
      columns={[
        // The label opens the entries too (mobile catalog CO-1, 2026-10-06): "Manage entries" sits
        // in the seventh column, off-screen in a phone's sideways scroller, so the row's own name
        // is the obvious way in.
        { key: "label", header: t({ key: "Label" }), cell: (ct) => <a href={`/admin/collections/${ct.key}`}>{ct.label}</a> },
        { key: "key", header: t({ key: "Key" }), cell: (ct) => <code>{ct.key}</code> },
        { key: "fields", header: t({ key: "Fields" }), cell: (ct) => ct.fields.length },
        {
          key: "queryable-fields",
          header: t({ key: "Queryable fields" }),
          cell: (ct) => ct.fields.filter((f) => f.queryable).length,
        },
        {
          key: "status",
          header: t({ key: "Status" }),
          cell: (ct) => <span className={`jini-status jini-status-${ct.status}`}><StatusLabel value={ct.status} /></span>,
        },
        {
          key: "entries",
          header: t({ key: "Entries" }),
          cell: (ct, index) => renderCollectionEntriesLink({ ct, rowHandles, index, t }),
        },
        {
          key: "embed",
          header: t({ key: "Embed" }),
          cell: (ct, index) => renderCollectionEmbed({ copyEmbedCode, ct, rowHandles, index, copiedKey, t, copyFallback }),
        },
        {
          key: "actions",
          header: t({ key: "More" }),
          cell: (ct, index) => renderCollectionMenu({ ...props, ct, index }),
        },
      ]}
    />
  );
}

function renderCollectionsEmpty({ t }: Pick<CollectionsTableProps, "t">) {
  return (
    <div className="jini-card">
      <div className="jini-empty-state">
        <p>{t({ key: "No Collections yet." })}</p>
        <p className="jini-page-description">{t({ key: "Create your first content type to start adding entries." })}</p>
      </div>
    </div>
  );
}

function renderCollectionEntriesLink(
  { ct, rowHandles, index, t }: Pick<CollectionsTableProps, "rowHandles" | "t"> & { ct: AdminContentType; index: number },
) {
  return (
    <a
      href={`/admin/collections/${ct.key}`}
      {...agentHandle({ handle: `${rowHandles[index]}-entries` }, {
        role: "link",
        label: "Open this content type's list of entries",
      })}
    >
      {t({ key: "Manage entries" })}
    </a>
  );
}

function renderCollectionEmbed(
  { copyEmbedCode, ct, rowHandles, index, copiedKey, t, copyFallback }:
    Pick<CollectionsTableProps, "copyEmbedCode" | "copiedKey" | "t" | "copyFallback" | "rowHandles"> &
    { ct: AdminContentType; index: number },
) {
  return (
    <>
      <button
        type="button"
        onClick={() => void copyEmbedCode(ct)}
        {...agentHandle({ handle: `${rowHandles[index]}-copy-embed` }, {
          role: "button",
          label: `Copy the embed code for content type "${ct.label}"`,
        })}
      >
        {/* aria-live so the swap to "Copied" is announced, as StaticSiteTab's copy button does. */}
        <span aria-live="polite">{copiedKey === ct.key ? t({ key: "Copied" }) : t({ key: "Copy embed code" })}</span>
      </button>
      {copyFallback?.key === ct.key && <code translate="no">{copyFallback.snippet}</code>}
    </>
  );
}

function renderCollectionMenu(
  { t, ct, rowHandles, index, setEditingFieldsFor, setPendingLifecycle, runLifecycle, locale, contentTypeMenuItems }:
    Pick<CollectionsTableProps, "t" | "setEditingFieldsFor" | "setPendingLifecycle" | "runLifecycle" | "locale"
    | "rowHandles" | "contentTypeMenuItems"> & { ct: AdminContentType; index: number },
) {
  return (
    <RowMenu
      triggerLabel={t({ key: 'Actions for content type "{label}"' }).replace("{label}", () => ct.label)}
      agentHandle={`${rowHandles[index]}-menu`}
      items={contentTypeMenuItems(
        { contentType: ct, handlers: {
          onEditFields: setEditingFieldsFor,
          onDeprecate: ({ contentType }, _optional = {}) => setPendingLifecycle({ op: "deprecate", contentType }),
          onReactivate: ({ contentType }, _optional = {}) => void runLifecycle(contentType, "reactivate"),
          onTombstone: ({ contentType }, _optional = {}) => setPendingLifecycle({ op: "tombstone", contentType }),
        }, locale },
      )}
    />
  );
}
