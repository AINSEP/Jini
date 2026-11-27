import { expect, it, vi } from "vitest";
import { validateCommitTarget } from "../commit-target.js";

const valid = { owner: "studio", repo: "website", commitMessage: "Publish autumn issue" };

it("uses host target policy before the generic target, folder and branch rules", () => {
  const validateTarget = vi.fn(() => "This host requires an organization owner.");
  expect(validateCommitTarget({ ...valid, owner: "", folder: "../elsewhere" }, { validateTarget }))
    .toBe("This host requires an organization owner.");
  expect(validateTarget).toHaveBeenCalledExactlyOnceWith({ owner: "", repo: "website" });
  expect(validateCommitTarget({ ...valid, repo: "" })).toBe("invalid repo ''");
});

it("normalizes valid folders and refuses invalid folders before considering branch or message", () => {
  expect(validateCommitTarget({ ...valid, folder: "dist\\site//", branch: "release/site-2.0" })).toBeNull();
  expect(validateCommitTarget({ ...valid, folder: "dist/../other", branch: "", commitMessage: "" }))
    .toBe("Target folder cannot contain . or .. segments.");
});

it("rejects malformed branch names without echoing an arbitrarily long name", () => {
  expect(validateCommitTarget(valid)).toBeNull();
  expect(validateCommitTarget({ ...valid, branch: "a" })).toBeNull();
  expect(validateCommitTarget({ ...valid, branch: "a".repeat(250) })).toBeNull();
  for (const branch of ["", "release candidate", "release\n2026", "r..c", "/release", "release/", "releases//nightly", "release/.hidden", "release/snapshot.lock"]) {
    expect(validateCommitTarget({ ...valid, branch })).toBe(`invalid branch name '${branch}'`);
  }
  expect(validateCommitTarget({ ...valid, branch: "a".repeat(251) })).toBe(`invalid branch name '${"a".repeat(60)}'`);
});

it("accepts a meaningful message up to 500 characters and refuses blank or oversized ones", () => {
  expect(validateCommitTarget({ ...valid, commitMessage: "x" })).toBeNull();
  expect(validateCommitTarget({ ...valid, commitMessage: "x".repeat(500) })).toBeNull();
  for (const commitMessage of [" \n ", "x".repeat(501)]) {
    expect(validateCommitTarget({ ...valid, commitMessage })).toBe("commitMessage must be 1-500 characters");
  }
});
