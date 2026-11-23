# number-stepper

A − / field / + stepper for a small persisted whole number (a single-digit range), exported from
`@jini-ai/ui/number-stepper`. Architecture: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

- **Needs injected:** `bounds: StepperBounds` (`{ min, max }`, product policy), `labels:
  NumberStepperLabels` (`decrease`, `increase`, `field`, `tip`), `labelledBy` (the row label's id),
  `hooks.useNumberStepper` (REQUIRED — pass `{ useNumberStepper }`), and a `NumberSetting`. Build that
  setting with `useOptimisticNumberSetting({ value, setValue, write, bounds, saveError }, { onSaveFailure })`:
  `value`/`setValue` are the host's live view of the stored value, `write: NumberSettingWrite | undefined`
  is the persistence port (undefined = cannot save; the host leaves the control out), `saveError`
  is host copy, `onSaveFailure` is the host's logger.
- **Provides:** an accessible spinbutton (the field is the one tab stop; Up/Down/Home/End stay in the
  field instead of reaching a surrounding menu), optimistic saves with rollback, and the pure rules
  `clampToBounds`, `stepperKeyTarget`, `numberFromTypedDigit`, `acceptedSavedValue`.
- **Styling:** ships no stylesheet yet. It renders `jini-number-stepper`, `__step`, `__value` and
  `__tip` (plus `jini-tooltip` for the tip layer); a host adds its own via `classNames`
  (`group`, `step`, `value`, `tip` — the tip span needs a visually-hidden class).
- **Must never import:** host bridges/IPC, host hooks, product copy, `console`.

```tsx
import { NumberStepper, useNumberStepper, useOptimisticNumberSetting } from '@jini-ai/ui/number-stepper';

const BOUNDS = { min: 1, max: 5 };
function useWorkers() {
  const { value, setValue } = useStoredWorkers();           // host hook
  const write = api.saveWorkers && (({ next }) => api.saveWorkers({ count: next }));
  return useOptimisticNumberSetting({ value, setValue, write, bounds: BOUNDS, saveError: 'Could not save.' });
}
<NumberStepper setting={useWorkers()} bounds={BOUNDS} labelledBy="workers-label" hooks={{ useNumberStepper }}
  labels={{ decrease: 'Fewer', increase: 'More', field: 'Workers', tip: 'More workers use more memory.' }} />
```
