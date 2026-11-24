import { useState } from "react";
import type { AdminTaxonomy, AdminTaxonomyWithTerms } from "../api/taxonomy-api.types.js";
import { taxonomyHtmlEmbed } from "../html-rules.js";
import type { TaxonomyFailureReporter } from "../taxonomy-host-kit.js";

/** Copy follows Forms' saved-identity and visible-feedback contract; clipboard is a swappable port. */
export function useTaxonomyHtmlEmbed(
  { taxonomies, t, failures }: { taxonomies: readonly AdminTaxonomyWithTerms[] | null; t: (key: string) => string; failures: TaxonomyFailureReporter },
  { clipboard }: { clipboard?: { writeText: (text: string) => Promise<void> } } = {},
) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  async function copyHtmlEmbed({ taxonomy }: { taxonomy: AdminTaxonomy }, _optional = {}) {
    const failureGeneration = failures.getGeneration();
    try {
      await (clipboard ?? navigator.clipboard).writeText(taxonomyHtmlEmbed({ taxonomy, taxonomies: (taxonomies ?? []).map((group) => group.taxonomy) }));
      setCopyFeedback(t("Copied!"));
    } catch (error) {
      setCopyFeedback(t("Could not copy embed"));
      if (failures.isClipboardRefusal({ error })) return;
      failures.publishLocalFailure({
        message: "The taxonomy embed code could not be copied.",
        action: "Try Copy HTML embed again. If it keeps failing, copy details and report this problem.",
        step: "Copy taxonomy embed code",
        cause: error,
      }, { generation: failureGeneration });
    }
  }
  return { copyHtmlEmbed, copyFeedback };
}
