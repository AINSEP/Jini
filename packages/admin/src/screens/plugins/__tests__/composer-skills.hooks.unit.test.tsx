// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatPaneComposerHandle, ComposerDiscoveryGroup } from "../../../react/kit.js";
import { useComposerDiscoveryDraft, useSelectedSkills, useSkillOnlySend } from "../composer-skills.hooks.js";

afterEach(cleanup);
const first = { toolId: "skill-search", name: "Search", guidance: "# Search instructions" };
const second = { toolId: "skill-audit", name: "Audit", guidance: "# Audit instructions" };

it("replaces the same skill id, preserves other chips and removes only the requested selection", () => {
  const { result } = renderHook(useSelectedSkills);
  expect(result.current.chips).toEqual([]);
  expect(result.current.skillOnlyPrompt).toBe("");
  act(() => {
    result.current.addSkill(first);
    result.current.addSkill(second);
    result.current.addSkill({ ...first, name: "Search v2", guidance: "Revised instructions" });
  });
  expect(result.current.selectedSkills).toEqual([second, { ...first, name: "Search v2", guidance: "Revised instructions" }]);
  expect(result.current.chips).toEqual([{ pluginRefId: "skill-audit", label: "Audit · Skill" }, { pluginRefId: "skill-search", label: "Search v2 · Skill" }]);
  expect(result.current.skillOnlyPrompt).toBe("Audit, Search v2");
  act(() => result.current.removeSkill("skill-audit"));
  expect(result.current.selectedSkills.map(({ toolId }) => toolId)).toEqual(["skill-search"]);
  expect(result.current.skillOnlyPrompt).toBe("Search v2");
});

const catalog: ComposerDiscoveryGroup[] = [
  { id: "first", label: "Tools", items: [{ id: "prefix", label: "search-logs" }] },
  { id: "second", label: "Skills", items: [{ id: "exact", label: "Search" }] },
];

it("ranks against the leading slash query only and ignores edits outside the composer", async () => {
  function Editor() {
    const draft = useComposerDiscoveryDraft(catalog);
    return <div ref={draft.rootRef} onInputCapture={draft.captureDraft}>
      <label>Other editor<textarea /></label>
      <div className="jini-composer"><label>Draft<textarea /></label></div>
      <output aria-label="Draft status">{draft.draftBlank ? "blank" : "typed"}</output>
      <ul aria-label="Discovery order">{draft.groups.flatMap((group) => group.items.map((item) => <li key={item.id}>{item.label}</li>))}</ul>
    </div>;
  }
  const user = userEvent.setup();
  render(<Editor />);
  const status = screen.getByLabelText("Draft status");
  const choices = () => within(screen.getByRole("list", { name: "Discovery order" })).getAllByRole("listitem").map((li) => li.textContent);
  expect(choices()).toEqual(["search-logs", "Search"]);
  await user.type(screen.getByRole("textbox", { name: "Other editor" }), "/search");
  expect(status).toHaveTextContent("blank");
  expect(choices()).toEqual(["search-logs", "Search"]);
  const draft = screen.getByRole("textbox", { name: "Draft" });
  await user.type(draft, "/search");
  expect(status).toHaveTextContent("typed");
  expect(choices()).toEqual(["Search", "search-logs"]);
  await user.type(draft, " yesterday");
  expect(choices()).toEqual(["Search", "search-logs"]);
  await user.clear(draft);
  await user.type(draft, "hello /search");
  expect(choices()).toEqual(["search-logs", "Search"]);
});

type Phase = "ready" | "disabled" | "stopping" | "no-handle" | "no-frame";
function SendHarness({ prompt = "Search, Audit", onSubmit, onSeed, phase = "ready" }: { prompt?: string; onSubmit: (value: string) => void; onSeed?: (value: string) => void; phase?: Phase }) {
  const [text, setText] = useState("");
  const discovery = useComposerDiscoveryDraft(catalog);
  const composerHandle = useRef<ChatPaneComposerHandle | null>(null);
  composerHandle.current = phase === "no-handle" ? null : { insertText: (value) => { setText(value); onSeed?.(value); }, addFolders: () => {} };
  const send = useSkillOnlySend({ prompt, composerHandle, discovery });
  return <>
    <output aria-label="Can send skills">{send.canSendSkills ? "ready" : "not ready"}</output>
    <button type="button" onClick={send.sendSkills}>Send skills</button>
    <button type="button" onClick={() => setText("Restored draft")}>Restore without input event</button>
    {phase !== "no-frame" ? <div ref={discovery.rootRef} onInputCapture={discovery.captureDraft}>
      <div className="jini-composer">
        <textarea aria-label="Prompt" value={text} onChange={(event) => setText(event.target.value)} disabled={phase === "disabled"} />
        <button type="button" className={phase === "stopping" ? "jini-composer-send jini-composer-send--stop" : "jini-composer-send"}
          disabled={text === "" && phase !== "stopping"} onClick={() => onSubmit(text)}>Composer action</button>
      </div>
    </div> : null}
  </>;
}

it("commits the skill-only text before invoking the enabled composer Send action", async () => {
  const submit = vi.fn();
  render(<SendHarness onSubmit={submit} />);
  const user = userEvent.setup();
  expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Composer action" })).toBeDisabled();
  expect(screen.getByLabelText("Can send skills")).toHaveTextContent(/^ready$/);
  await user.click(screen.getByRole("button", { name: "Send skills" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith("Search, Audit");
  expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Search, Audit");
});

it("does not overwrite programmatic draft restores, and re-reads the draft when the selection changes", async () => {
  const submit = vi.fn();
  const user = userEvent.setup();
  const view = render(<SendHarness onSubmit={submit} />);
  await user.click(screen.getByRole("button", { name: "Restore without input event" }));
  expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Restored draft");
  expect(screen.getByLabelText("Can send skills")).toHaveTextContent(/^ready$/);
  await user.click(screen.getByRole("button", { name: "Send skills" }));
  expect(submit).not.toHaveBeenCalled();
  view.rerender(<SendHarness onSubmit={submit} prompt="Audit only" />);
  expect(screen.getByLabelText("Can send skills")).toHaveTextContent(/^not ready$/);
  expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Restored draft");
});

it.each(["disabled", "stopping", "no-handle", "no-frame"] as const)("does not seed or submit while the composer is %s", async (phase) => {
  const submit = vi.fn();
  const onSeed = vi.fn();
  render(<SendHarness phase={phase} onSubmit={submit} onSeed={onSeed} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Send skills" }));
  expect(submit).not.toHaveBeenCalled();
  expect(onSeed).not.toHaveBeenCalled();
  if (phase === "no-frame") expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
  else expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
});

it("keeps sending unavailable when no skill contributes a prompt", async () => {
  const submit = vi.fn();
  render(<SendHarness prompt="" onSubmit={submit} />);
  expect(screen.getByLabelText("Can send skills")).toHaveTextContent(/^not ready$/);
  await userEvent.setup().click(screen.getByRole("button", { name: "Send skills" }));
  expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
  expect(submit).not.toHaveBeenCalled();
});
