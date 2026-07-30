/**
 * A nav across every lab view, so a person can reach any page directly instead of walking the
 * workflow to get to step three.
 *
 * It is tagged for agent control like everything else, which makes it useful beyond browsing: it
 * gives `page.navigate` a visible counterpart, so a run that navigates can be checked against what
 * a human clicking the same link would get. The current view is published as state rather than
 * styling alone — `aria-current` and a `data-agent-role="status"` element — because "which page am
 * I on" is exactly the question a caller has to answer after navigating.
 */

export interface LabNavItem {
  readonly id: string;
  readonly label: string;
}

/** Every reachable view, in workflow order. Ids match `data-agent-page` and `page.navigate`. */
export const LAB_NAV_ITEMS: readonly LabNavItem[] = [
  { id: 'agent-lab', label: 'Task list' },
  { id: 'signup-form', label: 'Signup form' },
  { id: 'submission', label: 'Signup summary' },
  { id: 'expense-queue', label: '1 · Expense queue' },
  { id: 'expense-form', label: '2 · Claim form' },
  { id: 'expense-receipt', label: '3 · Receipt' },
];

export interface LabNavProps {
  readonly current: string;
  readonly onNavigate: (id: string) => void;
}

export function LabNav({ current, onNavigate }: LabNavProps) {
  return (
    <nav
      className="lab-nav"
      aria-label="Lab pages"
      data-agent-element="lab-nav"
      data-agent-role="region"
      data-agent-label="Links to every page in the lab"
    >
      <span
        data-agent-element="lab-nav-current"
        data-agent-role="status"
        data-agent-label="Which lab page is showing right now"
      >
        {current}
      </span>
      {LAB_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`link-button${item.id === current ? ' lab-nav-active' : ''}`}
          aria-current={item.id === current ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
          data-agent-element={`lab-nav-${item.id}`}
          data-agent-role="link"
          data-agent-label={`Go to the ${item.label} page`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
