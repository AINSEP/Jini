/** `deployment_preview_static_publish`'s input — the same target-discriminated shape
 *  `publish-site.ts`'s trigger route body uses, with optional `projectName` for authenticated provider inspection. A preview never runs a real
 *  publish. Reused (spread) by
 *  {@link EXECUTE_STATIC_PUBLISH_SCHEMA} below, which adds the one field a real publish needs. */
const PREVIEW_STATIC_PUBLISH_SCHEMA = {
  type: "object",
  // Each host's own config fields (its `configFields` in deployment_get_static_publish_capabilities),
  // as top-level strings. The handler refuses any key the chosen host does not declare.
  additionalProperties: { type: "string" },
  required: ["target"],
  properties: {
    projectName: { type: "string", title: "Project name", description: "Use the same project label at preview and execute. Required for authenticated provider resource/domain inspection." },
    credentialId: { type: "string", title: "Saved connection", description: "Optional saved connection chosen by the person; preview and execute use this exact connection." },
    target: {
      type: "string",
      title: "Hosting provider",
      description:
        "Which host to publish to: one of the providerId values deployment_get_static_publish_capabilities lists. Pass that host's configFields as top-level string fields next to target (for example { target, <fieldName>: '<value>' }); a field the host does not declare is refused. The base path is computed from the host and the config, never passed in.",
    },
  },
} as const;

/** `deployment_execute_static_publish`'s input — {@link PREVIEW_STATIC_PUBLISH_SCHEMA}'s fields plus
 *  `projectName`, the one field a real publish needs that a preview does not. Carries only an optional saved connection ID, never a
 *  token or usable credential — see this file's header for why that is structural, not just
 *  undocumented. */
export const EXECUTE_STATIC_PUBLISH_SCHEMA = {
  type: "object",
  additionalProperties: PREVIEW_STATIC_PUBLISH_SCHEMA.additionalProperties,
  required: ["target", "projectName"],
  properties: {
    ...PREVIEW_STATIC_PUBLISH_SCHEMA.properties,
    projectName: {
      type: "string",
      title: "Project name",
      description: "Human-facing label for this publish run: the host uses it as the commit message or the project-name seed. 1-200 characters.",
    },
  },
} as const;

