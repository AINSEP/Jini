/** Source-control commit input, shared by registration and approval consumers. */
export const executeCommitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "owner", "repo", "commitMessage"],
  properties: {
    provider: {
      type: "string",
      title: "Host",
      description:
        "Which source control host to commit to: a providerId source_control_get_capabilities lists with commitSupported: true. Call that first; a host listed with commitSupported: false is refused.",
    },
    owner: { type: "string", description: "Owner or organization login that owns the target repository on the host." },
    repo: { type: "string", title: "Repository", description: "Repository name to commit to." },
    folder: {
      type: "string", title: "Target folder",
      description: "Optional folder inside the repository, for example static_sites. Omit or use an empty string for repository root. Re-commits replace generated files here and remove unchanged stale files previously managed here; unrelated files and files outside this folder are preserved.",
    },
    branch: {
      type: "string",
      description:
        "Branch to commit to. Optional; when omitted, the repository's own default branch is used. If the named branch does not exist yet, it is created from this commit. If it exists, this commit is added on top of its current history. NEVER force-pushed: if the branch has moved since this call read its head (someone else pushed to it), the commit is refused rather than overwriting that history, and the result is {committed:false, code:'DIVERGED_BRANCH'}.",
    },
    commitMessage: { type: "string", description: "The git commit message. 1-500 characters." },
    dryRun: {
      type: "boolean",
      description:
        "Pass dryRun: true first to see how many files the export would commit, without contacting the host. Optional; defaults to false.",
    },
  },
} as const;
