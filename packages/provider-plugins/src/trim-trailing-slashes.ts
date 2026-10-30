/** `text` without its trailing `/` characters, in one linear pass: same result as
 *  `text.replace(/\/+$/, '')`, whose `+$` backtracks on long runs that stop short of the end. */
export function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}
