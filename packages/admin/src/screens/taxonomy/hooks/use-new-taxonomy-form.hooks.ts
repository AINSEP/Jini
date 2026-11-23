import { useState } from "react";
import { useFetchMutation } from "@jini-ai/ui/fetch-query";
import { KEYS } from "../rules.js";
import type { NewTaxonomyFormPort } from "./new-taxonomy-form-port.hooks.js";
import type { TaxonomyHostKit } from "../taxonomy-host-kit.js";

/**
 * @file Everything `NewTaxonomyForm` does (REQ-02), so it can stay markup only.
 *
 * Extracted verbatim — same state, same validation guard, same effect, same error string. Mirrors
 * `use-new-term-form.hooks.ts`'s local-state/submit/error shape, same as the original components
 * mirrored each other.
 *
 * `port` is injected — see `new-taxonomy-form-port.hooks.ts` — rather than importing `lib/api`
 * directly, so a test can describe the create outcome against `createFakeNewTaxonomyFormPort`
 * instead of stubbing global `fetch`. `useWiredNewTaxonomyForm` below is the zero-argument pair
 * `Taxonomy.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `createTaxonomy` is a `useFetchMutation` that
 * `invalidates: [KEYS.list]` instead of the parent's `onCreated` calling `load()` by hand — same
 * client-side-validation-vs-request-error precedence as `redirects`'s
 * `use-import-redirects-form.hooks.ts`'s `error`.
 */

export interface NewTaxonomyFormOptions {
  onCreated: () => void;
}

export interface NewTaxonomyFormController {
  name: string;
  setName: (name: string) => void;
  hierarchical: boolean;
  setHierarchical: (hierarchical: boolean) => void;
  error: string | null;
  saving: boolean;
  submit: (e: React.FormEvent) => Promise<void>;
}

/** What the host passes useNewTaxonomyForm: the caller's options, the bound port, the resolved admin
 *  locale and the host's {@link TaxonomyHostKit}. */
export interface UseNewTaxonomyFormArgs {
  options: NewTaxonomyFormOptions;
  port: NewTaxonomyFormPort;
  locale: string;
  kit: TaxonomyHostKit;
}

export function useNewTaxonomyForm(
  { options, port, locale, kit }: UseNewTaxonomyFormArgs,
  _optional: Record<string, never> = {}
): NewTaxonomyFormController {
  const [name, setName] = useState("");
  const [hierarchical, setHierarchical] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const createMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; hierarchical: boolean } }) => port.createTaxonomy(input),
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
      await createMutation.mutate({ input: { name: name.trim(), hierarchical } });
      setName("");
      setHierarchical(false);
      options.onCreated();
    } catch {
      // already surfaced through createMutation.error -> error below
    }
  }

  const saving = createMutation.status === "pending";
  const error = validationError ?? (createMutation.error ? kit.describeApiError({ e: createMutation.error, fallback: kit.translate({ locale: locale, key: "Failed to create taxonomy" }) }) : null);

  return { name, setName, hierarchical, setHierarchical, error, saving, submit };
}
