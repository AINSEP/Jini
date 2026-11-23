import { useState } from "react";
import type { AdminTaxonomyWithTerms } from "../api/taxonomy-api.types.js";
import { useFetchMutation } from "@jini-ai/ui/fetch-query";
import { KEYS } from "../rules.js";
import type { NewTermFormPort } from "./new-term-form-port.hooks.js";
import type { TaxonomyHostKit } from "../taxonomy-host-kit.js";

/**
 * @file Everything `NewTermForm` does, so it can stay markup only.
 *
 * Extracted verbatim — same state, same validation guard, same effect, same error string.
 *
 * `open`/`setOpen` (web-design pass, 2026-08-05): every taxonomy group used to render its own
 * "New term" form open at all times, so an N-group taxonomy list showed N always-visible boxed
 * forms interleaved with the term rows — no sibling list screen (Media, Comments, Menus,
 * Integrations) keeps a create form permanently open like that. `NewTermForm` now starts collapsed
 * behind a small trigger and only mounts the real form once opened; `submit` closes it again on
 * success (mirrors the reset-on-success it already does for `name`/`parentId`), so a completed add
 * returns the group to its compact resting state instead of leaving an empty form sitting open.
 *
 * `port` is injected — see `new-term-form-port.hooks.ts` — rather than importing `lib/api`
 * directly, so a test can describe the create outcome against `createFakeNewTermFormPort` instead
 * of stubbing global `fetch`. `useWiredNewTermForm` below is the zero-argument pair `Taxonomy.tsx`
 * actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `createTerm` is a `useFetchMutation` that
 * `invalidates: [KEYS.list]` instead of the parent's `onCreated` calling `load()` by hand — same
 * client-side-validation-vs-request-error precedence as `use-new-taxonomy-form.hooks.ts`.
 */

export interface NewTermFormOptions {
  taxonomy: AdminTaxonomyWithTerms;
  onCreated: () => void;
}

export interface NewTermFormController {
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  name: string;
  setName: (name: string) => void;
  parentId: string;
  setParentId: (parentId: string) => void;
  error: string | null;
  saving: boolean;
  submit: (e: React.FormEvent) => Promise<void>;
}

export function useNewTermForm(
  options: NewTermFormOptions,
  port: NewTermFormPort,
  locale: string,
  kit: TaxonomyHostKit
): NewTermFormController {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const createMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; parentId: string | null } }) =>
      port.createTerm({ taxonomyId: options.taxonomy.taxonomy.id, name: input.name }, { parentId: input.parentId }),
  }, {
    invalidates: [KEYS.list],
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError(kit.translate({ locale: locale, key: "Name is required." }));
      return;
    }
    setValidationError(null);
    try {
      await createMutation.mutate({ input: {
        name: name.trim(),
        parentId: options.taxonomy.taxonomy.hierarchical && parentId ? parentId : null,
      } });
      setName("");
      setParentId("");
      setOpen(false);
      options.onCreated();
    } catch {
      // already surfaced through createMutation.error -> error below
    }
  }

  const saving = createMutation.status === "pending";
  const error = validationError ?? (createMutation.error ? kit.describeApiError({ e: createMutation.error, fallback: kit.translate({ locale: locale, key: "Failed to create term" }) }) : null);

  return { open, setOpen, name, setName, parentId, setParentId, error, saving, submit };
}
