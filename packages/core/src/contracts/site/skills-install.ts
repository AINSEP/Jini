/**
 * @file Skill-install request shapes. Types only; this module owns the declarations that
 * `@jini-ai/agentic/skills/install` (`install-service.ts`, `validation.ts`) used to declare. That
 * package imports them from here and keeps its runtime values.
 */

export interface SkillUploadFile { readonly path: string; readonly contentBase64: string }
export type SkillInstallInput = { readonly workspaceId: string } & (
  { readonly url: string } |
  { /** @deprecated Use url with an injected source provider. */ readonly githubUrl: string } |
  { readonly files: readonly SkillUploadFile[] } | { readonly archiveBase64: string }
);
