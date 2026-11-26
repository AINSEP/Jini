import type { VendorCredentialSetRepoPort } from './store.js';

/** The store holding vendor row `id`: this site's, else the project's when one is attached (ids are
 *  unique across both). Never opens a row. @complexity At most one lookup. */
export async function ownerOf<R extends Pick<VendorCredentialSetRepoPort, "findById" | "project">>(repo: R, input: { workspaceId: string; id: string }): Promise<{ repo: R | VendorCredentialSetRepoPort; workspaceId: string }> {
  const project = repo.project;
  if (!project || await repo.findById(input)) return { repo, workspaceId: input.workspaceId };
  return { repo: project.repo, workspaceId: project.workspaceId };
}

