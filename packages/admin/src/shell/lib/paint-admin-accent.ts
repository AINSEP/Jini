/**
 * The host inputs feed Jini's derived accent tokens, including descendants with their own theme.
 * The ledger's registered default (Jini's neutral blue, which Jini expects hosts to brand over) is
 * not an operator choice, so it clears the inline inputs and Classic's `var(--primary)` mapping
 * keeps Classic's Jini accent brand orange. Glass without a saved choice likewise keeps its own
 * palette. Writing the ledger default inline turned selected chips, toggles and
 * primary buttons blue on any site that never picked an accent (owner, 2026-10-08: "selected tabs
 * and navs should be orange").
 * The ink input follows the fill via Jini's `readableTextColor`: a light accent such as Tovu gold
 * otherwise kept the themes' white ink, unreadable on primary buttons and badges.
 */
export function paintAdminAccent({ accent: accentColor, root, deps }: { accent: string | undefined; root: HTMLElement; deps: { readableTextColor: (required: { hex: string }) => string } }, _optional = {}) {
  if (accentColor === undefined) {
    root.style.removeProperty("--jini-theme-light-primary");
    root.style.removeProperty("--jini-theme-dark-primary");
    root.style.removeProperty("--jini-theme-light-primary-ink");
    root.style.removeProperty("--jini-theme-dark-primary-ink");
    root.removeAttribute("data-admin-accent");
    return;
  }
  root.style.setProperty("--jini-theme-light-primary", accentColor);
  root.style.setProperty("--jini-theme-dark-primary", accentColor);
  const ink = deps.readableTextColor({ hex: accentColor });
  root.style.setProperty("--jini-theme-light-primary-ink", ink);
  root.style.setProperty("--jini-theme-dark-primary-ink", ink);
  // Classic's default inputs point at --primary. Only bridge back to Jini's roles while
  // these literal overrides exist, avoiding a cycle and preserving the default palette.
  // "light" marks an accent that took dark ink, so Classic also darkens its text uses.
  root.setAttribute("data-admin-accent", ink === "#ffffff" ? "" : "light");
}

