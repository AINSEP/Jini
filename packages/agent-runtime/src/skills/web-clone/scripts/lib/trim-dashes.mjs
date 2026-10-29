// Strip every leading and trailing "-" in one linear pass. Same result as
// `text.replace(/^-+|-+$/g, "")`, whose `-+$` half backtracks quadratically on long
// runs of "-" that stop short of the end.
export function trimDashes(text) {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "-") start += 1;
  while (end > start && text[end - 1] === "-") end -= 1;
  return text.slice(start, end);
}
