/**
 * @file The places a site moves in or out that live on another screen, listed on the Import &
 * Export panel's Other tab. Each card links to the screen that owns the flow — this panel never
 * re-implements one (static export lives on Deployment). Export and Import were cards linking to
 * Sites until the owner moved them onto this page as tabs (2026-10-25): the desktop app and a hosted
 * install have no Sites section, so those links bounced to the dashboard. `title`/`lead` are
 * English keys for `import-export-i18n.ts`.
 */
export interface ImportExportLink {
  id: "static";
  title: string;
  lead: string;
  href: string;
}

export const IMPORT_EXPORT_LINKS: readonly ImportExportLink[] = [
  { id: "static", title: "Static Site", lead: "Read-only HTML of the published pages, for any static host.", href: "/admin/deployment?tab=static-site" },
];
