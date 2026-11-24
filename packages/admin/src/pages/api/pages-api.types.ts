/** Safe readiness for markers already on a page, without templates, paths or credentials. */
export interface AdminPagePluginEmbed {
  plugin: string;
  displayName?: string;
  component: string;
  availability: string;
}
