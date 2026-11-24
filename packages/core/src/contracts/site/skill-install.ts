/**
 * @file The skill-install request body an admin screen prepares and the host's install route reads:
 * a GitHub URL, one ZIP archive, or a folder's files, each file's bytes base64-encoded under its
 * folder-relative path. Type-only, so both the admin package's upload encoder and the host's
 * transport read one declaration.
 */
export type SkillInstallPayload = { githubUrl: string } | { archiveBase64: string } | { files: { path: string; contentBase64: string }[] };
