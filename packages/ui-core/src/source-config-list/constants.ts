/** Character used to mask a `password`-kind field value in list/summary display. */
export const MASK_CHAR = '•';

/** How many trailing characters of a masked `password`-kind field stay visible (e.g. `••••••wxyz`) — same convention as showing a card's last 4 digits. */
export const MASKED_VALUE_VISIBLE_SUFFIX_LENGTH = 4;

/** Minimum number of mask characters rendered even for very short values, so a 1-character secret doesn't visually leak its own length. */
export const MASKED_VALUE_MIN_MASK_LENGTH = 6;

/**
 * Pseudo-id used to key pending/result tracking for a "test before save"
 * call on the add-form's unsaved draft (`testSource(undefined, draft)`),
 * which has no real item id yet — mirrors `features/resource-dashboard`'s
 * `BULK_DELETE_SCOPE` pattern for a mutation that isn't scoped to one
 * already-persisted item.
 */
export const DRAFT_TEST_SCOPE = '__draft__';
