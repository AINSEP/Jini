/**
 * The post and page editors' Save button when nothing changed (owner, 2026-10-10): Save is never
 * disabled, in case a real change wasn't picked up. With changes it saves; with none it opens the
 * "Nothing changed. Save anyway?" warning, whose "Save anyway" closes it and saves anyway. The server
 * skips the write when the content really is identical and answers with the same version.
 *
 * @complexity O(1) — three closures, one branch (plus the optional flush).
 */
export function unchangedSaveHandlers(
  required: { dirty: boolean; save: () => Promise<void>; setConfirmingUnchangedSave: (open: boolean) => void },
  optional: {
    /** Folds an edit the editor hasn't reported yet (an open Interactive text session) into the
     *  working copy and says whether it differs from the saved body. Without it, typing in the
     *  Interactive tab and pressing Save showed "Nothing changed": the RTE only reports on close.
     *  "failed" means the flush already showed its own error, so neither save nor warn. */
    flushPendingEdits?: () => Promise<"changed" | "unchanged" | "failed">;
  } = {}
): { onSave: () => void; onUnchangedSaveConfirm: () => void; onUnchangedSaveCancel: () => void } {
  const { dirty, save, setConfirmingUnchangedSave } = required;
  const { flushPendingEdits } = optional;
  const saveOrWarn = async () => {
    const pending = flushPendingEdits ? await flushPendingEdits() : "unchanged";
    if (pending === "changed") {
      await save();
      return;
    }
    if (pending === "unchanged") setConfirmingUnchangedSave(true);
  };
  return {
    onSave: () => {
      if (dirty) void save();
      else void saveOrWarn();
    },
    onUnchangedSaveConfirm: () => {
      setConfirmingUnchangedSave(false);
      void save();
    },
    onUnchangedSaveCancel: () => setConfirmingUnchangedSave(false),
  };
}
