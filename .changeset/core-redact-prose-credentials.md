---
"@jini-ai/core": patch
---

The "prose after a colon" reading no longer overrides credential syntax. After a label that starts its line (or a list item), an alphabetic value is masked unless it opens with an ordinary function word, a plain-word passphrase is masked to the line end, and a single token on the line after the label is masked. Sentences that mention the word mid-line, placeholders (`(skipped)`, `none`) and form transcripts stay readable.
