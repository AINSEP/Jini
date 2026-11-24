/**
 * @file The admin workspace wire DTO, shared by the admin workspace routes (which project a
 * workspace record onto it) and the admin client (which reads it back). One owner, so the server's
 * response and the client's expectation cannot drift apart. Types only.
 */

/** Admin-facing shape of a workspace. */
export interface AdminWorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  version: number;
}
