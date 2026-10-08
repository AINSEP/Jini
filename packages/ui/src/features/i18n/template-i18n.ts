/** Parameterized messages belong in locale data too: branching on locale in every interpolation
 * helper would require editing every caller to add a language, instead of adding templates. */
export function interpolate({ template, vars }: { template: string; vars: Record<string, string | number> }): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in vars ? String(vars[key]) : match;
  });
}

/**
 * Split around placeholders when values must be rendered as nodes, such as inline code naming
 * a destructive action's target; plain string interpolation cannot insert those nodes.
 * Missing/mistyped locale tokens collapse the remaining text into one segment, followed by
 * empty segments, so a translation defect does not crash its dialog.
 */
/** Returns tokens.length + 1 segments in token order; callers interleave their node values. */
export function splitOnPlaceholders({ template, tokens }: { template: string; tokens: readonly string[] }): string[] {
  const segments: string[] = [];
  let rest = template;
  for (const token of tokens) {
    const index = rest.indexOf(token);
    if (index === -1) {
      segments.push(rest);
      rest = "";
    } else {
      segments.push(rest.slice(0, index));
      rest = rest.slice(index + token.length);
    }
  }
  segments.push(rest);
  return segments;
}

/** Only singular versus other; this is not full CLDR pluralization. Languages needing more than
 * two forms require a richer mechanism rather than being forced into these two templates. */
export function pickPlural({ count, forms }: { count: number; forms: { one: string; other: string } }): string {
  return count === 1 ? forms.one : forms.other;
}

/** Resolve caller-owned locale data, defaulting to English or an explicit fallback.
 * Own-property lookup prevents constructor/toString/__proto__ locale names from returning
 * prototype objects, which would throw when passed to a string interpolator.
 * @throws When neither the requested entry nor a fallback is defined. */
export function localeEntry<T>(
  { table, locale }: { table: Readonly<Record<string, T>>; locale: string },
  { fallback = table.en }: { fallback?: T } = {},
): T {
  const entry = Object.hasOwn(table, locale) ? (table[locale] ?? fallback) : fallback;
  if (entry === undefined) {
    throw new Error(`No locale entry for "${locale}" and no English or explicit fallback`);
  }
  return entry;
}

