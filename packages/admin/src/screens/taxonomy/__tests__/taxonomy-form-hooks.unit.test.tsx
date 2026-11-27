// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GatedConfirmResult, GatedPlanResult } from "@jini-ai/core/contracts/site/gated-results";

import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";
import type { AdminTaxonomy, AdminTaxonomyWithTerms, AdminTerm, MergeTermPlanDetails } from "../api/taxonomy-api.types.js";
import { taxonomyHtmlEmbed } from "../html-rules.js";
import type { MergeTermSectionPort } from "../hooks/merge-term-section-port.hooks.js";
import type { TaxonomyPort } from "../hooks/taxonomy-port.hooks.js";
import { useMergeTermSection } from "../hooks/use-merge-term-section.hooks.js";
import { useNewTaxonomyForm } from "../hooks/use-new-taxonomy-form.hooks.js";
import { useNewTermForm } from "../hooks/use-new-term-form.hooks.js";
import { useTaxonomyHtmlEmbed } from "../hooks/use-taxonomy-html-embed.hooks.js";
import { useTermDetailPanel } from "../hooks/use-term-detail-panel.hooks.js";
import type { TaxonomyFailureReporter, TaxonomyHostKit } from "../taxonomy-host-kit.js";

/** A host kit whose translator and describer mark their output, so each assertion proves which copy path ran. */
function kit(failures: TaxonomyFailureReporter = { getGeneration: () => 0, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() }): TaxonomyHostKit {
  return {
    isApiError: (_e: unknown): _e is never => false,
    describeApiError: ({ e, fallback }) => `${(e as Error).message} / ${fallback}`,
    translate: ({ locale, key }) => `${locale}:${key}`,
    failures,
    useContentRefreshSubscription: () => {},
    useTaxonomyHtmlEmbed,
    useFetchQuery, useFetchMutation, useInvalidate,
  };
}

function submitEvent() {
  const preventDefault = vi.fn();
  return { event: { preventDefault } as unknown as FormEvent, preventDefault };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const taxonomy = (over: Partial<AdminTaxonomy> = {}): AdminTaxonomy => ({ id: "tx1", name: "Topics", hierarchical: false, status: "active", updatedAt: "2026-11-01", version: 1, ...over });
const term = (over: Partial<AdminTerm> = {}): AdminTerm => ({ id: "t1", taxonomyId: "tx1", parentId: null, name: "News", status: "active", updatedAt: "2026-11-01", version: 1, ...over });

describe("useNewTaxonomyForm", () => {
  it("rejects a blank name with the translated message and never calls the port", async () => {
    const createTaxonomy = vi.fn();
    const { result } = renderHook(() => useNewTaxonomyForm({ options: { onCreated: vi.fn() }, port: { createTaxonomy }, locale: "de", kit: kit() }));
    act(() => result.current.setName("   "));
    const { event, preventDefault } = submitEvent();
    await act(async () => { await result.current.submit(event); });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("de:Name is required.");
    expect(createTaxonomy).not.toHaveBeenCalled();
  });

  it("creates with the trimmed name and flag, resets the form and reports onCreated", async () => {
    const createTaxonomy = vi.fn(async () => ({ taxonomy: taxonomy() }));
    const onCreated = vi.fn();
    const { result } = renderHook(() => useNewTaxonomyForm({ options: { onCreated }, port: { createTaxonomy }, locale: "de", kit: kit() }));
    act(() => { result.current.setName("  Tags "); result.current.setHierarchical(true); });
    expect(result.current.hierarchical).toBe(true);
    await act(async () => { await result.current.submit(submitEvent().event); });
    expect(createTaxonomy).toHaveBeenCalledWith({ name: "Tags", hierarchical: true });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(result.current.name).toBe("");
    expect(result.current.hierarchical).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("is saving while the create is pending, and describes a failure with the translated fallback", async () => {
    const gate = deferred<{ taxonomy: AdminTaxonomy }>();
    const onCreated = vi.fn();
    const { result } = renderHook(() => useNewTaxonomyForm({ options: { onCreated }, port: { createTaxonomy: () => gate.promise }, locale: "de", kit: kit() }));
    act(() => result.current.setName("Tags"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.submit(submitEvent().event); });
    await waitFor(() => expect(result.current.saving).toBe(true));
    await act(async () => { gate.reject(new Error("conflict")); await pending; });
    expect(result.current.error).toBe("conflict / de:Failed to create taxonomy");
    expect(result.current.name).toBe("Tags");
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("useNewTermForm", () => {
  const flat: AdminTaxonomyWithTerms = { taxonomy: taxonomy(), terms: [] };
  const tree: AdminTaxonomyWithTerms = { taxonomy: taxonomy({ id: "tx2", hierarchical: true }), terms: [term({ id: "p1", taxonomyId: "tx2" })] };

  it("rejects a blank name with the translated message", async () => {
    const createTerm = vi.fn();
    const { result } = renderHook(() => useNewTermForm({ options: { taxonomy: flat, onCreated: vi.fn() }, port: { createTerm }, locale: "en", kit: kit() }));
    await act(async () => { await result.current.submit(submitEvent().event); });
    expect(result.current.error).toBe("en:Name is required.");
    expect(createTerm).not.toHaveBeenCalled();
  });

  it("sends the chosen parent only for a hierarchical taxonomy, then closes and resets", async () => {
    const createTerm = vi.fn(async () => ({ term: term() }));
    const onCreated = vi.fn();
    const { result } = renderHook(() => useNewTermForm({ options: { taxonomy: tree, onCreated }, port: { createTerm }, locale: "en", kit: kit() }));
    act(() => { result.current.setOpen(true); result.current.setName(" Child "); result.current.setParentId("p1"); });
    expect(result.current.open).toBe(true);
    await act(async () => { await result.current.submit(submitEvent().event); });
    expect(createTerm).toHaveBeenCalledWith({ taxonomyId: "tx2", name: "Child" }, { parentId: "p1" });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(result.current.open).toBe(false);
    expect(result.current.name).toBe("");
    expect(result.current.parentId).toBe("");
  });

  it("drops a stale parent on a flat taxonomy and sends null when no parent is chosen", async () => {
    const createTerm = vi.fn(async () => ({ term: term() }));
    const flatHook = renderHook(() => useNewTermForm({ options: { taxonomy: flat, onCreated: vi.fn() }, port: { createTerm }, locale: "en", kit: kit() }));
    act(() => { flatHook.result.current.setName("A"); flatHook.result.current.setParentId("p1"); });
    await act(async () => { await flatHook.result.current.submit(submitEvent().event); });
    const treeHook = renderHook(() => useNewTermForm({ options: { taxonomy: tree, onCreated: vi.fn() }, port: { createTerm }, locale: "en", kit: kit() }));
    act(() => treeHook.result.current.setName("B"));
    await act(async () => { await treeHook.result.current.submit(submitEvent().event); });
    expect(createTerm.mock.calls).toEqual([
      [{ taxonomyId: "tx1", name: "A" }, { parentId: null }],
      [{ taxonomyId: "tx2", name: "B" }, { parentId: null }],
    ]);
  });

  it("describes a failed create with the translated fallback and keeps the form open", async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useNewTermForm({ options: { taxonomy: flat, onCreated }, port: { createTerm: async () => { throw new Error("dup"); } }, locale: "en", kit: kit() }));
    act(() => { result.current.setOpen(true); result.current.setName("A"); });
    await act(async () => { await result.current.submit(submitEvent().event); });
    expect(result.current.error).toBe("dup / en:Failed to create term");
    expect(result.current.open).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });
});

function taxonomyPort(renameTerm: TaxonomyPort["renameTerm"]): TaxonomyPort {
  const unused = async (): Promise<never> => { throw new Error("not used by this hook"); };
  return { listTaxonomies: unused, trashTerm: unused, trashTaxonomy: unused, renameTerm };
}

describe("useTermDetailPanel", () => {
  it("does not call the port for a blank or unchanged name", async () => {
    const renameTerm = vi.fn();
    const { result } = renderHook(() => useTermDetailPanel({ options: { term: term(), onRenamed: vi.fn() }, port: taxonomyPort(renameTerm), locale: "en", kit: kit() }));
    expect(result.current.newName).toBe("News");
    await act(async () => { await result.current.rename(submitEvent().event); });
    act(() => result.current.setNewName("  "));
    await act(async () => { await result.current.rename(submitEvent().event); });
    act(() => result.current.setNewName(" News "));
    await act(async () => { await result.current.rename(submitEvent().event); });
    expect(renameTerm).not.toHaveBeenCalled();
  });

  it("renames with the trimmed name, then says so and reports onRenamed", async () => {
    const renameTerm = vi.fn(async () => ({ term: term({ name: "Updates" }) }));
    const onRenamed = vi.fn();
    const { result } = renderHook(() => useTermDetailPanel({ options: { term: term(), onRenamed }, port: taxonomyPort(renameTerm), locale: "en", kit: kit() }));
    act(() => result.current.setNewName(" Updates "));
    await act(async () => { await result.current.rename(submitEvent().event); });
    expect(renameTerm).toHaveBeenCalledWith({ termId: "t1", newName: "Updates" });
    expect(result.current.message).toBe("en:Renamed.");
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
    expect(onRenamed).toHaveBeenCalledOnce();
  });

  it("describes a failed rename with the translated fallback", async () => {
    const onRenamed = vi.fn();
    const { result } = renderHook(() => useTermDetailPanel({ options: { term: term(), onRenamed }, port: taxonomyPort(async () => { throw new Error("taken"); }), locale: "en", kit: kit() }));
    act(() => result.current.setNewName("Other"));
    await act(async () => { await result.current.rename(submitEvent().event); });
    expect(result.current.error).toBe("taken / en:Failed to rename term");
    expect(result.current.message).toBeNull();
    expect(result.current.saving).toBe(false);
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it("resets to the new term on a switch and drops a rename that settles for the old one", async () => {
    const success = deferred<{ term: AdminTerm }>();
    const failure = deferred<{ term: AdminTerm }>();
    const gates = [success, failure];
    const onRenamed = vi.fn();
    const { result, rerender } = renderHook(({ current }: { current: AdminTerm }) =>
      useTermDetailPanel({ options: { term: current, onRenamed }, port: taxonomyPort(() => gates.shift()!.promise), locale: "en", kit: kit() }), { initialProps: { current: term() } });

    act(() => result.current.setNewName("Renamed"));
    let first!: Promise<void>;
    act(() => { first = result.current.rename(submitEvent().event); });
    expect(result.current.saving).toBe(true);
    rerender({ current: term({ id: "t2", name: "Sports" }) });
    expect(result.current.newName).toBe("Sports");
    expect(result.current.saving).toBe(false);
    await act(async () => { success.resolve({ term: term({ name: "Renamed" }) }); await first; });
    expect(result.current.message).toBeNull();
    expect(onRenamed).not.toHaveBeenCalled();

    act(() => result.current.setNewName("Games"));
    let second!: Promise<void>;
    act(() => { second = result.current.rename(submitEvent().event); });
    rerender({ current: term({ id: "t3", name: "Arts" }) });
    await act(async () => { failure.reject(new Error("late")); await second; });
    expect(result.current.error).toBeNull();
    expect(result.current.newName).toBe("Arts");
  });
});

function mergePort(over: Partial<MergeTermSectionPort> = {}) {
  const port: MergeTermSectionPort = {
    planMergeTerm: vi.fn(async (): Promise<GatedPlanResult<MergeTermPlanDetails>> => ({
      planId: "plan-1", planHash: "hash-1",
      details: { fromTermId: "t1", intoTermId: "t9", overlapLossDisclosed: true, overlappingContentCount: 4 },
    })),
    confirmMergeTerm: vi.fn(async (): Promise<GatedConfirmResult> => ({ confirmationToken: "ct-1" })),
    executeMergeTerm: vi.fn(async () => ({ mergedCount: 4 })),
    ...over,
  };
  return port;
}

describe("useMergeTermSection", () => {
  it("does nothing until a target, a plan and a token exist", async () => {
    const port = mergePort();
    const { result } = renderHook(() => useMergeTermSection({ options: { term: term(), onMerged: vi.fn() }, port, locale: "en", kit: kit() }));
    await act(async () => { await result.current.startPlan(); await result.current.doConfirm(); await result.current.doExecute(); });
    expect(port.planMergeTerm).not.toHaveBeenCalled();
    expect(port.confirmMergeTerm).not.toHaveBeenCalled();
    expect(port.executeMergeTerm).not.toHaveBeenCalled();
    expect(result.current.step).toBe("idle");
  });

  it("walks plan -> confirm -> execute with the exact ceremony arguments", async () => {
    const port = mergePort();
    const onMerged = vi.fn();
    const { result } = renderHook(() => useMergeTermSection({ options: { term: term(), onMerged }, port, locale: "en", kit: kit() }));
    act(() => result.current.setIntoTermId("t9"));

    await act(async () => { await result.current.startPlan(); });
    expect(port.planMergeTerm).toHaveBeenCalledWith({ fromTermId: "t1", intoTermId: "t9" });
    expect(result.current.step).toBe("planned");
    expect(result.current.plan).toEqual({ planId: "plan-1", planHash: "hash-1", overlappingContentCount: 4 });
    expect(result.current.busy).toBe(false);

    await act(async () => { await result.current.doConfirm(); });
    expect(port.confirmMergeTerm).toHaveBeenCalledWith({ fromTermId: "t1", planId: "plan-1", planHash: "hash-1" });
    expect(result.current.step).toBe("confirmed");
    expect(result.current.confirmationToken).toBe("ct-1");

    await act(async () => { await result.current.doExecute(); });
    expect(port.executeMergeTerm).toHaveBeenCalledWith({ fromTermId: "t1", intoTermId: "t9", confirmationToken: "ct-1" });
    expect(onMerged).toHaveBeenCalledOnce();
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("describes a failure at each step with that step's translated fallback", async () => {
    const plan = mergePort({ planMergeTerm: async () => { throw new Error("p"); } });
    const a = renderHook(() => useMergeTermSection({ options: { term: term(), onMerged: vi.fn() }, port: plan, locale: "en", kit: kit() }));
    act(() => a.result.current.setIntoTermId("t9"));
    await act(async () => { await a.result.current.startPlan(); });
    expect(a.result.current.error).toBe("p / en:Failed to plan the merge");
    expect(a.result.current.step).toBe("idle");

    const confirm = mergePort({ confirmMergeTerm: async () => { throw new Error("c"); } });
    const b = renderHook(() => useMergeTermSection({ options: { term: term(), onMerged: vi.fn() }, port: confirm, locale: "en", kit: kit() }));
    act(() => b.result.current.setIntoTermId("t9"));
    await act(async () => { await b.result.current.startPlan(); });
    await act(async () => { await b.result.current.doConfirm(); });
    expect(b.result.current.error).toBe("c / en:Failed to confirm the merge");
    expect(b.result.current.step).toBe("planned");

    const onMerged = vi.fn();
    const execute = mergePort({ executeMergeTerm: async () => { throw new Error("x"); } });
    const c = renderHook(() => useMergeTermSection({ options: { term: term(), onMerged }, port: execute, locale: "en", kit: kit() }));
    act(() => c.result.current.setIntoTermId("t9"));
    await act(async () => { await c.result.current.startPlan(); });
    await act(async () => { await c.result.current.doConfirm(); });
    await act(async () => { await c.result.current.doExecute(); });
    expect(c.result.current.error).toBe("x / en:Failed to execute the merge");
    expect(c.result.current.busy).toBe(false);
    expect(onMerged).not.toHaveBeenCalled();
  });

  it("resets on a term switch and ignores plan/confirm/execute answers for the old term", async () => {
    const planGate = deferred<GatedPlanResult<MergeTermPlanDetails>>();
    const port = mergePort({ planMergeTerm: () => planGate.promise });
    const onMerged = vi.fn();
    const { result, rerender } = renderHook(({ current }: { current: AdminTerm }) =>
      useMergeTermSection({ options: { term: current, onMerged }, port, locale: "en", kit: kit() }), { initialProps: { current: term() } });

    act(() => result.current.setIntoTermId("t9"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.startPlan(); });
    expect(result.current.busy).toBe(true);
    rerender({ current: term({ id: "t2" }) });
    expect(result.current.intoTermId).toBe("");
    expect(result.current.busy).toBe(false);
    await act(async () => { planGate.resolve({ planId: "old", planHash: "h", details: { fromTermId: "t1", intoTermId: "t9", overlapLossDisclosed: false, overlappingContentCount: 0 } }); await pending; });
    expect(result.current.plan).toBeNull();
    expect(result.current.step).toBe("idle");
  });

  it("drops stale confirm and execute outcomes (success and failure) after a term switch", async () => {
    const confirmGate = deferred<GatedConfirmResult>();
    const executeGate = deferred<{ mergedCount: number }>();
    const failingConfirm = deferred<GatedConfirmResult>();
    const failingExecute = deferred<{ mergedCount: number }>();
    const failingPlan = deferred<GatedPlanResult<MergeTermPlanDetails>>();
    const confirms = [confirmGate, failingConfirm];
    const executes = [executeGate, failingExecute];
    const onMerged = vi.fn();
    const port = mergePort({ confirmMergeTerm: () => confirms.shift()!.promise, executeMergeTerm: () => executes.shift()!.promise });
    const { result, rerender } = renderHook(({ current }: { current: AdminTerm }) =>
      useMergeTermSection({ options: { term: current, onMerged }, port, locale: "en", kit: kit() }), { initialProps: { current: term() } });

    // Stale confirm success.
    act(() => result.current.setIntoTermId("t9"));
    await act(async () => { await result.current.startPlan(); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.doConfirm(); });
    rerender({ current: term({ id: "t2" }) });
    await act(async () => { confirmGate.resolve({ confirmationToken: "stale" }); await pending; });
    expect(result.current.confirmationToken).toBeNull();

    // Stale confirm failure.
    act(() => result.current.setIntoTermId("t9"));
    await act(async () => { await result.current.startPlan(); });
    act(() => { pending = result.current.doConfirm(); });
    rerender({ current: term({ id: "t3" }) });
    await act(async () => { failingConfirm.reject(new Error("late")); await pending; });
    expect(result.current.error).toBeNull();

    // Stale execute success, then stale execute failure.
    for (const [gate, nextId, settle] of [
      [executeGate, "t4", (g: typeof executeGate) => g.resolve({ mergedCount: 1 })],
      [failingExecute, "t5", (g: typeof executeGate) => g.reject(new Error("late"))],
    ] as const) {
      const confirmNow = deferred<GatedConfirmResult>();
      confirms.push(confirmNow);
      act(() => result.current.setIntoTermId("t9"));
      await act(async () => { await result.current.startPlan(); });
      act(() => { pending = result.current.doConfirm(); });
      await act(async () => { confirmNow.resolve({ confirmationToken: "tok-a" }); await pending; });
      act(() => { pending = result.current.doExecute(); });
      rerender({ current: term({ id: nextId }) });
      await act(async () => { settle(gate); await pending; });
      expect(result.current.error).toBeNull();
    }
    expect(onMerged).not.toHaveBeenCalled();

    // Stale plan failure.
    const planPort = mergePort({ planMergeTerm: () => failingPlan.promise });
    const other = renderHook(({ current }: { current: AdminTerm }) =>
      useMergeTermSection({ options: { term: current, onMerged }, port: planPort, locale: "en", kit: kit() }), { initialProps: { current: term() } });
    act(() => other.result.current.setIntoTermId("t9"));
    act(() => { pending = other.result.current.startPlan(); });
    other.rerender({ current: term({ id: "t6" }) });
    await act(async () => { failingPlan.reject(new Error("late")); await pending; });
    expect(other.result.current.error).toBeNull();
  });
});

describe("useTaxonomyHtmlEmbed", () => {
  const topics = taxonomy();
  const tags = taxonomy({ id: "tx2", name: "Tags" });
  const groups: AdminTaxonomyWithTerms[] = [{ taxonomy: topics, terms: [] }, { taxonomy: tags, terms: [] }];

  it("copies the embed for the chosen taxonomy and confirms", async () => {
    const writeText = vi.fn(async () => {});
    const failures: TaxonomyFailureReporter = { getGeneration: () => 3, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() };
    const { result } = renderHook(() => useTaxonomyHtmlEmbed({ taxonomies: groups, t: (key) => `«${key}»`, failures }, { clipboard: { writeText } }));
    expect(result.current.copyFeedback).toBeNull();
    await act(async () => { await result.current.copyHtmlEmbed({ taxonomy: tags }); });
    expect(writeText).toHaveBeenCalledWith(taxonomyHtmlEmbed({ taxonomy: tags, taxonomies: groups.map((group) => group.taxonomy) }));
    expect(result.current.copyFeedback).toBe("«Copied!»");
    expect(failures.publishLocalFailure).not.toHaveBeenCalled();
  });

  it("falls back to an empty taxonomy list and to navigator.clipboard when none is injected", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const failures: TaxonomyFailureReporter = { getGeneration: () => 0, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() };
    const { result } = renderHook(() => useTaxonomyHtmlEmbed({ taxonomies: null, t: (key) => key, failures }));
    await act(async () => { await result.current.copyHtmlEmbed({ taxonomy: topics }); });
    expect(writeText).toHaveBeenCalledWith(taxonomyHtmlEmbed({ taxonomy: topics, taxonomies: [] }));
    expect(result.current.copyFeedback).toBe("Copied!");
  });

  it("reports a real copy failure with the pre-action generation, but stays quiet on a clipboard refusal", async () => {
    const refused = new Error("denied");
    const broken = new Error("broken");
    let generation = 7;
    const failures: TaxonomyFailureReporter = {
      getGeneration: () => generation++,
      isClipboardRefusal: ({ error }) => error === refused,
      publishLocalFailure: vi.fn(),
    };
    let next: Error = refused;
    const { result } = renderHook(() => useTaxonomyHtmlEmbed({ taxonomies: groups, t: (key) => `«${key}»`, failures }, { clipboard: { writeText: async () => { throw next; } } }));

    await act(async () => { await result.current.copyHtmlEmbed({ taxonomy: topics }); });
    expect(result.current.copyFeedback).toBe("«Could not copy embed»");
    expect(failures.publishLocalFailure).not.toHaveBeenCalled();

    next = broken;
    await act(async () => { await result.current.copyHtmlEmbed({ taxonomy: topics }); });
    expect(failures.publishLocalFailure).toHaveBeenCalledWith({
      message: "The taxonomy embed code could not be copied.",
      action: "Try Copy HTML embed again. If it keeps failing, copy details and report this problem.",
      step: "Copy taxonomy embed code",
      cause: broken,
    }, { generation: 8 });
  });
});
