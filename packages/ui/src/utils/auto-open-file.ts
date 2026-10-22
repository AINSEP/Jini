// Decide whether to auto-open a file after an agent write/edit tool result.
// Only files that exist in the project's refreshed file list should open as
// tabs — out-of-project paths (upstream repo edits, system files) would
// otherwise create permanent placeholder tabs.
//
// Resolution order:
//   1) Path-suffix match. If the agent's `filePath` equals or ends with
//      `/${file.path}` (full segment alignment), treat it as a positive
//      identification of that project file. If exactly one file matches,
//      open it. If multiple files share a path-suffix with `filePath`,
//      decline as ambiguous rather than open the wrong one.
//   2) Basename fallback — only when `filePath` has no slash (it's already
//      a basename) and exactly one project file has that basename. This
//      preserves the golden path for short filePath inputs while still
//      rejecting external edits that happen to share a basename with a
//      project file (those will have a slash in `filePath` and reach this
//      step with zero suffix matches → declined).

interface CandidateFile {
  readonly name: string;
  readonly path?: string;
  readonly kind?: string;
  readonly mtime?: number;
}

interface AutoOpenOptions {
  // Names of files that are modules loaded by a sibling HTML entry (e.g. via
  // `<script type="text/babel" src>`). These have no standalone preview, so
  // auto-opening one strands the user on a dead-end tab. When a resolved
  // candidate is in this set we decline to open it.
  readonly moduleFileNames?: ReadonlySet<string>;
}

const NO_MODULES: ReadonlySet<string> = new Set();

function basenameOf(p: string): string {
  // `String.prototype.split` always returns a non-empty array (even for
  // `''`, which splits to `['']`), so `.pop()` can never actually return
  // `undefined` here — the `?? p` fallback this used to have was dead code
  // for every real string input, not real API surface, so it was removed
  // rather than tested around.
  return p.split('/').pop() as string;
}

type AutoOpenDecision = { shouldOpen: boolean; fileName: string | null };

function decline(): AutoOpenDecision {
  return { shouldOpen: false, fileName: null };
}

function relPathOf(file: CandidateFile): string {
  return file.path ?? file.name;
}

// Does the agent's `filePath` positively identify the project file at `rel`?
function isPathSuffixMatch({ filePath, rel }: { filePath: string; rel: string }): boolean {
  if (!rel) return false;
  // Require segment alignment: filePath ends with "/${rel}" so that
  // "subdir/App.jsx" matches ".../subdir/App.jsx" but not
  // ".../notsubdir/App.jsx".
  return filePath === rel || filePath.endsWith('/' + rel);
}

// Resolve a positive identification into an open decision, declining files
// that are modules of a multi-file HTML entry rather than standalone pages.
// More than one match means multiple project files plausibly correspond to
// this path — refuse rather than open the wrong one.
function resolveUniqueMatch({ matches, moduleFileNames }: {
  matches: ReadonlyArray<CandidateFile>;
  moduleFileNames: ReadonlySet<string>;
}): AutoOpenDecision {
  if (matches.length !== 1) return decline();
  const fileName = matches[0]!.name;
  return moduleFileNames.has(fileName) ? decline() : { shouldOpen: true, fileName };
}

export function decideAutoOpenAfterWrite(
  filePath: string,
  nextFiles: ReadonlyArray<CandidateFile>,
  options: AutoOpenOptions = {},
): AutoOpenDecision {
  const moduleFileNames = options.moduleFileNames ?? NO_MODULES;
  if (!filePath) return decline();

  // 1) Path-suffix match against full project-relative paths.
  const suffixMatches = nextFiles.filter((f) => isPathSuffixMatch({ filePath, rel: relPathOf(f) }));
  if (suffixMatches.length > 0) return resolveUniqueMatch({ matches: suffixMatches, moduleFileNames });

  // 2) Basename fallback only when filePath itself is just a basename.
  // If filePath contains a slash but didn't path-suffix-match anything,
  // it's an external edit that happens to share a basename — declining
  // is the whole point of the guard.
  if (filePath.includes('/')) return decline();

  // A blank rel's basename is '' and can never equal the non-empty filePath.
  const basenameMatches = nextFiles.filter((f) => basenameOf(relPathOf(f)) === filePath);
  return resolveUniqueMatch({ matches: basenameMatches, moduleFileNames });
}

function isHtmlPreviewFile(file: CandidateFile): boolean {
  return file.kind === 'html' || /\.html?$/i.test(relPathOf(file));
}

// Markdown documents (plan.md, report.md, DESIGN.md, …) often render inline
// in a viewer, so a turn that produces one should surface it just like an
// HTML page. Extension — not `kind` — is the discriminator here so a caller
// whose backend maps both `.md` and `.txt` to the same generic text kind
// still opens markdown while deliberately leaving plain `.txt` alone.
function isMarkdownPreviewFile(file: CandidateFile): boolean {
  return /\.(md|markdown)$/i.test(relPathOf(file));
}

// Auto-open priority for a turn's produced files. Higher wins. HTML is the
// primary visual deliverable, so when a turn writes both an HTML page and a
// markdown note (e.g. index.html + README.md) the page takes focus; markdown
// is the next-best previewable artifact; everything else (decks, images, raw
// text) has no in-place preview worth stealing focus for and is left for the
// user to open from the produced-files list.
function autoOpenPreviewRank(file: CandidateFile): number {
  if (isHtmlPreviewFile(file)) return 2;
  if (isMarkdownPreviewFile(file)) return 1;
  return 0;
}

// `zh/index.html` → depth 2, root `index.html` → depth 1; null for non-entry
// files. Depth orders competing entries so the site root wins over a locale
// or section subtree's own index.
function siteEntryDepth(file: CandidateFile): number | null {
  const path = relPathOf(file);
  if (!/(^|\/)index\.html?$/i.test(path)) return null;
  return path.split('/').length;
}

export interface SelectAutoOpenOptions {
  // Prefer the site entry (`index.html`) among the turn's produced HTML
  // files. Website-clone turns reproduce a whole multi-page site in one
  // run — subpages, assets, and reports keep landing after the entry page,
  // so the newest-mtime tie-break below would open whatever page happened
  // to be written last. With this flag the shallowest produced `index.html`
  // wins (ties to newest mtime); turns that produce no index.html keep the
  // standard rank/mtime behavior.
  readonly preferSiteEntry?: boolean;
}

// Missing or non-finite mtimes count as 0 for the newest-wins tie-break.
function finiteMtime(file: CandidateFile): number {
  return typeof file.mtime === 'number' && Number.isFinite(file.mtime) ? file.mtime : 0;
}

// The file with the highest `score` (null = not a candidate); equal scores
// break to the newest mtime, and an mtime tie goes to the later file.
function pickHighestScoring({ files, score }: {
  files: ReadonlyArray<CandidateFile>;
  score: (file: CandidateFile) => number | null;
}): CandidateFile | null {
  let best: { file: CandidateFile; score: number } | null = null;
  for (const file of files) {
    const fileScore = score(file);
    if (fileScore === null) continue;
    const beatsBest =
      best === null ||
      fileScore > best.score ||
      (fileScore === best.score && finiteMtime(file) >= finiteMtime(best.file));
    if (beatsBest) best = { file, score: fileScore };
  }
  return best?.file ?? null;
}

// Every site entry is an `index.html`/`.htm`, so it is always an HTML preview
// file too; the shallower entry scores higher.
function siteEntryScore(file: CandidateFile): number | null {
  const depth = siteEntryDepth(file);
  return depth === null ? null : -depth;
}

function previewRankScore(file: CandidateFile): number | null {
  const rank = autoOpenPreviewRank(file);
  return rank === 0 ? null : rank;
}

// Pick which of a turn's produced files to auto-open in the viewer. Among
// previewable files, a higher-priority kind always beats a lower one; ties
// break to the most recently written file (newest mtime). Returns null when
// the turn produced nothing previewable.
export function selectAutoOpenProducedArtifact(
  producedFiles: ReadonlyArray<CandidateFile>,
  options: SelectAutoOpenOptions = {},
): string | null {
  if (options.preferSiteEntry) {
    const entry = pickHighestScoring({ files: producedFiles, score: siteEntryScore });
    if (entry) return entry.name;
  }
  return pickHighestScoring({ files: producedFiles, score: previewRankScore })?.name ?? null;
}
