# Branch Finish Examples

Load this only when you want concrete option flows.

## Example Prompt

```text
Implementation complete. What would you like to do?

1. Merge back to main locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work
```

## Example Merge Flow

```bash
git checkout main
git pull
git merge feature/auth
npm test
git branch -d feature/auth
```

## Example PR Flow

```bash
git push -u origin feature/auth
gh pr create --title "feat: add auth" --body-file .github/pull_request_template.md
```

## Example Discard Confirmation

```text
This will permanently delete:
- Branch feature/auth
- Its commits
- Any associated worktree

Type 'discard' to confirm.
```
