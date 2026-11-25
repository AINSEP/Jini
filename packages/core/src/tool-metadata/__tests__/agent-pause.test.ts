import { expect, it } from "vitest";
import { createResumeAgentWorkMetadata } from "../agent-pause.js";

it("resume metadata is edit-class and direct under the supplied ID", () => {
  const search = { keywords: "resume", queries: ["Resume work"] };
  expect(createResumeAgentWorkMetadata({ toolId: "resume_custom", search })).toEqual({
    resume_custom: { search, approval: { class: "edit", confirmation: "direct" } },
  });
});
