/** Wire shape of one installed skill, as the host's skills list route returns it. */
export interface InstalledSkill { toolId: string; name: string; description: string; enabled: boolean; source: "uploaded" | { githubUrl: string; commit: string } }
/** Body of an install request: a GitHub URL, a ZIP archive, or folder-relative files, all base64-encoded. */
export type SkillInstallPayload = { githubUrl: string } | { archiveBase64: string } | { files: { path: string; contentBase64: string }[] };
