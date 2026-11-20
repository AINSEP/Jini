export function FormSubmissionDate({ date }: { date: { text: string; full: string; dateTime: string | undefined } }) {
  return <time dateTime={date.dateTime} title={date.full}>{date.text}</time>;
}
