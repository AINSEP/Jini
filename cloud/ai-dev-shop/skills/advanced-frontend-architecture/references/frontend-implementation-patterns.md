<!-- Source: Addy Osmani / agent-skills / frontend-ui-engineering -->

# Frontend Implementation Patterns

> Framework note: the examples below use React/TypeScript syntax. They are
> tactical UI implementation patterns, not architecture-selection rules. In
> Angular, Vue, Svelte, or plain TypeScript projects, transpose the principle to
> native idioms instead of importing React concepts into the architecture.

## Avoid the AI Aesthetic

These signals mark AI-generated or template-default UI. Each one alone is a yellow flag; several together are a red flag for low-quality design.

| Signal | Why It Marks Low Quality |
|--------|--------------------------|
| Purple/indigo as dominant brand color | Default gradient palette from Tailwind + AI tools; signals no brand thinking |
| Excessive gradients (background, cards, buttons) | Adds visual complexity without communicating anything; hides poor color choices |
| `rounded-2xl` on everything | Indiscriminate rounding erases visual hierarchy; deliberate rounding shapes feel |
| Generic hero sections (headline + subhead + two CTA buttons) | Template structure with no product-specific thinking |
| Lorem ipsum or placeholder copy | Design decisions that depend on real copy were deferred; layout breaks with real text |
| Oversized padding everywhere (`p-8` to `p-16` on all containers) | Wastes screen real estate, creates disconnected components |
| Stock card grids (icon + title + description, 3-per-row) | Structure inherited from template, not from actual content requirements |
| Shadow-heavy design (`shadow-xl` on every card, button, modal) | Overuse of depth cues flattens visual hierarchy and reads as amateur |

**Corrective approach:** Start from the content and constraints — what text, data, and actions actually exist? Let layout emerge from that, not from a template.

---

## Component Architecture Patterns

### Colocate Component Files

```
src/features/checkout/
  CheckoutForm.tsx         ← component
  CheckoutForm.test.tsx    ← test lives with component
  CheckoutForm.module.css  ← styles colocated
  useCheckoutForm.ts       ← hook colocated
  types.ts                 ← local types
```

This is preferable to a flat `components/` folder — related files move and change together.

### Prefer Composition Over Configuration

```tsx
// CONFIGURATION — boolean flags hide variants, hard to extend
<Button primary large withIcon loading>Submit</Button>

// COMPOSITION — explicit, extensible, each variant is a component
<Button variant="primary" size="lg">
  <Spinner className="mr-2" />
  Submit
</Button>
```

Boolean flag proliferation is a sign that composition would serve better.

### Keep Components Focused

If a component exceeds ~200 lines, it is doing too much. Split strategies:
- Extract sub-components for repeated UI patterns
- Extract hooks for logic clusters
- Extract helper functions for pure transformations

### Separate Data Fetching from Presentation

```tsx
// Container — owns data fetching and state
function UserProfileContainer({ userId }: { userId: string }) {
  const { data: user, isLoading, error } = useUser(userId);

  if (isLoading) return <UserProfileSkeleton />;
  if (error) return <ErrorMessage error={error} />;
  if (!user) return null;

  return <UserProfile user={user} />;
}

// Presentation — pure rendering, no fetching, fully testable in isolation
function UserProfile({ user }: { user: User }) {
  return (
    <div>
      <Avatar src={user.avatarUrl} alt={user.name} />
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
    </div>
  );
}
```

Presentation components are easy to test, easy to reuse, and easy to build in Storybook.

---

## State Management Decision Guide

```
Where should this state live?
├── Used only in one component?
│   └── Local state (useState)
├── Needs to be shared between 2-3 nearby components?
│   └── Lifted state (pass via props to common ancestor)
├── Widely shared, rarely changes (theme, locale, auth user)?
│   └── React Context
├── Reflects something in the URL (filters, pagination, selected tab)?
│   └── URL state (useSearchParams, router)
├── Server data (fetched, cached, synchronized)?
│   └── Server state (React Query / SWR / Apollo)
└── Complex client-side application state (undo/redo, multi-step wizard)?
    └── Global store (Zustand / Redux Toolkit)
```

**Start at the top of the tree.** Reach for global stores only when local state, lifted state, and context have genuinely failed. Most state problems are solved at the first three levels.

---

## Loading and Transitions

### Skeleton Loading vs Spinner

- **Skeleton** (preferred for content): mirrors the layout of the content being loaded; reduces perceived wait time; prevents layout shift when content arrives
- **Spinner**: appropriate for short operations (<300ms) or when content shape is unknown; overused for content loading

### Optimistic Updates with React Query

```tsx
function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (update: TodoUpdate) => api.updateTodo(update),

    // Optimistically update the cache before the request completes
    onMutate: async (update) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] });

      // Snapshot the previous value for rollback
      const previousTodos = queryClient.getQueryData<Todo[]>(['todos']);

      // Optimistically update
      queryClient.setQueryData<Todo[]>(['todos'], (old = []) =>
        old.map(todo => todo.id === update.id ? { ...todo, ...update } : todo)
      );

      // Return snapshot for rollback in onError
      return { previousTodos };
    },

    // Roll back on error
    onError: (_error, _update, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(['todos'], context.previousTodos);
      }
    },

    // Refetch after success or error to sync with server
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}
```

---

## Accessibility Implementation

### Keyboard Navigation for Custom Interactive Elements

```tsx
// role="button" elements must handle keyboard events
function ToggleCard({ onClick, children }: ToggleCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}
```

### Focus Management for Dialogs

```tsx
function Modal({ isOpen, onClose, children }: ModalProps) {
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Move focus into dialog when it opens.
      // Note: this demonstrates focus-on-open only.
      // For modal-dialog accessibility, also trap focus (Tab/Shift+Tab
      // cycles within dialog) per WAI-ARIA APG. Use `focus-trap-react`
      // or implement via a keydown handler on the dialog container.
      firstFocusableRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">Dialog Title</h2>
      {children}
      <button ref={firstFocusableRef} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
```

### Skeleton Loaders and Loading States

```tsx
// aria-busy signals loading state to screen readers
function UserCard({ userId }: { userId: string }) {
  const { data, isLoading } = useUser(userId);

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading user profile">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-3 w-48 mt-2" />
      </div>
    );
  }

  return <UserProfile user={data!} />;
}

// Meaningful empty states with role="status"
function EmptyState() {
  return (
    <div role="status" aria-live="polite">
      <p>No results found. Try adjusting your filters.</p>
    </div>
  );
}
```

---

## Responsive Breakpoints to Test

Always verify layouts at these viewport widths:

| Width | Represents |
|-------|-----------|
| 320px | Small phones (iPhone SE, older Android) |
| 768px | Tablets, large phones landscape |
| 1024px | Small laptops, iPad landscape |
| 1440px | Standard desktop monitor |

Common failure points: navigation collapse/expand, table overflow, image scaling, form layout, font size readability, touch target size (WCAG 2.2 AA minimum is 24×24px with exceptions; 44×44px is WCAG 2.5.5 AAA and the Apple HIG / mobile best-practice target).
