/**
 * @file One installed skill as the host's skills list route returns it and the admin Skills screen
 * renders it: its tool id, display copy, enabled state and where it came from. Type-only, so the
 * admin package's screen and the host's transport read one declaration.
 */
export interface InstalledSkill { toolId: string; name: string; description: string; enabled: boolean; source: "uploaded" | { githubUrl: string; commit: string } }
