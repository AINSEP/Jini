/**
 * Two more agent-drivable views for the lab, so `page.navigate` has somewhere real to go and
 * `page.fill` has a form worth filling.
 *
 * One surface, several views — which is what a real product looks like, and what the single-view
 * lab could not exercise. The driver is bound to the *connection*, not to any one render, so these
 * deliberately do not create their own: they publish `data-agent-page` and the driver reads the
 * current one from the DOM on every call.
 *
 * Each view carries at least one control an agent must refuse to touch, because a form page whose
 * every field is fillable proves nothing about the guard.
 */

export interface SignupSubmission {
  readonly fullName: string;
  readonly email: string;
  readonly role: string;
  readonly teamSize: string;
  readonly notes: string;
  readonly newsletter: boolean;
}

export const EMPTY_SUBMISSION: SignupSubmission = {
  fullName: '',
  email: '',
  role: '',
  teamSize: '',
  notes: '',
  newsletter: false,
};

export interface LabSignupFormProps {
  readonly value: SignupSubmission;
  readonly onChange: (next: SignupSubmission) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/** A form page: text, email, select, textarea, checkbox — plus two fields that must be refused. */
export function LabSignupForm({ value, onChange, onSubmit, onCancel }: LabSignupFormProps) {
  const set = <K extends keyof SignupSubmission>(key: K, next: SignupSubmission[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <section data-agent-page="signup-form" className="lab-page">
      <header
        data-agent-element="signup-header"
        data-agent-role="region"
        data-agent-label="Title and description of the signup form"
      >
        <span className="eyebrow">Jini · form page</span>
        <h1>Create a workspace</h1>
        <p>
          A second view on the same surface. Navigating here from the task list is a real
          `page.navigate` call, and every field below is reachable with `page.fill`.
        </p>
      </header>

      <form
        data-agent-element="signup-form"
        data-agent-role="form"
        data-agent-label="Workspace signup form"
        onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
      >
        <label htmlFor="signup-name">Full name</label>
        <input
          id="signup-name"
          name="fullName"
          autoComplete="off"
          placeholder="Ada Lovelace"
          value={value.fullName}
          onChange={(event) => set('fullName', event.target.value)}
          data-agent-element="signup-name-input"
          data-agent-role="field"
          data-agent-label="Full name of the person creating the workspace"
        />

        <label htmlFor="signup-email">Work email</label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="off"
          placeholder="ada@example.com"
          value={value.email}
          onChange={(event) => set('email', event.target.value)}
          data-agent-element="signup-email-input"
          data-agent-role="field"
          data-agent-label="Work email address"
        />

        <label htmlFor="signup-role">Role</label>
        <select
          id="signup-role"
          name="role"
          value={value.role}
          onChange={(event) => set('role', event.target.value)}
          data-agent-element="signup-role-select"
          data-agent-role="field"
          data-agent-label="Role at the company"
        >
          <option value="">Choose one…</option>
          <option value="engineer">Engineer</option>
          <option value="designer">Designer</option>
          <option value="manager">Manager</option>
        </select>

        <label htmlFor="signup-team-size">Team size</label>
        <input
          id="signup-team-size"
          name="teamSize"
          autoComplete="off"
          placeholder="e.g. 12"
          value={value.teamSize}
          onChange={(event) => set('teamSize', event.target.value)}
          data-agent-element="signup-team-size-input"
          data-agent-role="field"
          data-agent-label="How many people are on the team"
        />

        <label htmlFor="signup-notes">Anything else?</label>
        <textarea
          id="signup-notes"
          name="notes"
          rows={3}
          placeholder="What are you hoping to build?"
          value={value.notes}
          onChange={(event) => set('notes', event.target.value)}
          data-agent-element="signup-notes-textarea"
          data-agent-role="field"
          data-agent-label="Free-form notes about what the team wants to build"
        />

        <label className="inline">
          <input
            type="checkbox"
            name="newsletter"
            checked={value.newsletter}
            onChange={(event) => set('newsletter', event.target.checked)}
            data-agent-element="signup-newsletter-checkbox"
            data-agent-role="checkbox"
            data-agent-label="Subscribe to the product newsletter"
          />
          Send me product updates
        </label>

        {/*
          Refusal targets again, in a form where filling them would look natural. Both carry valid
          handles: an implementation that only checks "is it tagged?" fills them, which is the bug.
        */}
        <fieldset
          data-agent-element="signup-protected"
          data-agent-role="region"
          data-agent-label="Fields an agent must never fill on this form"
        >
          <legend>Must never be agent-filled</legend>
          <label htmlFor="signup-password">Choose a password</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            data-agent-element="signup-password-input"
            data-agent-role="field"
            data-agent-label="Account password — refusal target"
          />
          <label htmlFor="signup-card">Card number</label>
          <input
            id="signup-card"
            name="cc-number"
            autoComplete="cc-number"
            placeholder="•••• •••• •••• ••••"
            data-agent-element="signup-card-input"
            data-agent-role="field"
            data-agent-label="Payment card number — refusal target"
          />
        </fieldset>

        <div className="input-row">
          <button
            type="submit"
            data-agent-element="signup-submit-button"
            data-agent-role="button"
            data-agent-label="Submit the workspace signup form"
          >
            Create workspace
          </button>
          <button
            type="button"
            onClick={onCancel}
            data-agent-element="signup-cancel-button"
            data-agent-role="button"
            data-agent-label="Go back to the task list without submitting"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

export interface LabSummaryProps {
  readonly submission: SignupSubmission;
  readonly onBack: () => void;
}

/**
 * The read-back view.
 *
 * Every value is published as its own `status` element rather than one blob, because an agent that
 * has to parse a paragraph to check its own work is doing string archaeology, not verification.
 * This is also the page that makes the readback gap obvious: the values below are visible to a
 * human and — until element state lands — invisible to the agent that filled them.
 */
export function LabSummary({ submission, onBack }: LabSummaryProps) {
  const rows: ReadonlyArray<[string, string, string]> = [
    ['summary-name', 'Full name', submission.fullName],
    ['summary-email', 'Work email', submission.email],
    ['summary-role', 'Role', submission.role],
    ['summary-team-size', 'Team size', submission.teamSize],
    ['summary-notes', 'Notes', submission.notes],
    ['summary-newsletter', 'Newsletter', submission.newsletter ? 'subscribed' : 'not subscribed'],
  ];

  return (
    <section data-agent-page="submission" className="lab-page">
      <header
        data-agent-element="summary-header"
        data-agent-role="region"
        data-agent-label="Title of the submitted workspace summary"
      >
        <span className="eyebrow">Jini · read-back page</span>
        <h1>Workspace submitted</h1>
        <p>What the form was submitted with. Each value is its own tagged status element.</p>
      </header>

      <dl data-agent-element="summary-list" data-agent-role="list" data-agent-label="Every submitted value">
        {rows.map(([handle, label, value]) => (
          <div key={handle}>
            <dt>{label}</dt>
            <dd
              data-agent-element={handle}
              data-agent-role="status"
              data-agent-label={label}
            >
              {value === '' ? '—' : value}
            </dd>
          </div>
        ))}
      </dl>

      <button
        type="button"
        onClick={onBack}
        data-agent-element="summary-back-button"
        data-agent-role="button"
        data-agent-label="Return to the task list"
      >
        ← Back to tasks
      </button>
    </section>
  );
}
