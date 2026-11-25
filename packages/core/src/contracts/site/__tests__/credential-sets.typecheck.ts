import type { SourceControlCredentialSummary } from "../source-control-credentials.js";
import type { CredentialProjectHalf } from "../credential-project-half.js";
import type { VendorCredentialSetRepoPort } from "../vendor-credentials.js";

export const summariesCannotExposeSealed: Extract<keyof SourceControlCredentialSummary, "sealed"> extends never ? true : never = true;

export const projectReadHalf = (required: {
  repo: VendorCredentialSetRepoPort;
  sealer: CredentialProjectHalf<VendorCredentialSetRepoPort>["sealer"];
  keyring: CredentialProjectHalf<VendorCredentialSetRepoPort>["keyring"];
}): CredentialProjectHalf<VendorCredentialSetRepoPort> => ({ workspaceId: "owner", ...required });
