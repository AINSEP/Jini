/**
 * @module QuestionsPanel
 *
 * A host-facing wrapper around `<QuestionForm>` that owns the Continue/Skip
 * footer UI and forwards `ready`/answer-change state. Generalized from OD's
 * `components/QuestionsPanel.tsx`: the OD original also owns PostHog
 * analytics tracking (`trackQuestionsFormClick`/`trackQuestionsFormSurfaceView`),
 * a project-scoped file-upload path (`uploadProjectFiles`), and a 10-minute
 * skip-countdown auto-continue — all OD product policy, not generic panel
 * behavior, so they are dropped here per
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §1's "prune OD actions"
 * directive for this component family. A host that wants analytics gets it
 * for free via `<JiniChatProvider analytics={...}>` (not wired into this
 * component directly — see `AnalyticsAdapter`); a host that wants a
 * skip-countdown or file-upload-backed answers can compose its own wrapper
 * around the exported `<QuestionForm>` instead. className/structure (`qp-*`)
 * kept close to the original; every user-facing string wrapped in `useT()`.
 */
import { useRef, useState } from 'react';
import type { QuestionForm as QuestionFormType } from '../../core/index.js';
import { useT } from '../hooks/context.js';
import { QuestionForm, type QuestionFormHandle } from './QuestionForm.js';

export interface QuestionsPanelProps {
  form: QuestionFormType | null;
  interactive: boolean;
  /** Disables Continue/Skip while the turn is busy, without locking the form itself. */
  submitDisabled?: boolean;
  submittedAnswers?: Record<string, string | string[]>;
  /** The assistant turn is still streaming the form — keeps Continue disabled and shows a generating hint. */
  generating?: boolean;
  onSubmit: (text: string, answers: Record<string, string | string[]>) => void;
}

export function QuestionsPanel({ form, interactive, submitDisabled = false, submittedAnswers, generating = false, onSubmit }: QuestionsPanelProps) {
  const t = useT();
  const formRef = useRef<QuestionFormHandle>(null);
  const [ready, setReady] = useState(false);

  if (!form) return null;

  const answered = submittedAnswers !== undefined;
  const busy = submitDisabled || generating;

  return (
    <div className="qp-panel">
      <QuestionForm ref={formRef} form={form} interactive={interactive} {...(submittedAnswers !== undefined ? { submittedAnswers } : {})} hideInternalSubmit onReadyChange={setReady} onSubmit={onSubmit} />
      {!answered ? (
        <div className="qp-foot">
          {generating ? <span className="qp-hint">{t('Still generating…')}</span> : null}
          <button type="button" className="qp-skip" disabled={busy} onClick={() => formRef.current?.skipAll()}>
            {t('Skip')}
          </button>
          <button type="button" className="qp-continue primary" disabled={busy || !ready} onClick={() => formRef.current?.submit()}>
            {t('Continue')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
