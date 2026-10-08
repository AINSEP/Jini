export function FormSubmissionDate({ date }: { date: { text: string; full: string; dateTime: string | undefined } }, _optional: Record<string, never> = {}) {
  return <time dateTime={date.dateTime} title={date.full}>{date.text}</time>;
}
