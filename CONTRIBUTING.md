# Contributing to Alloy

Thanks for helping improve Alloy! Please review the guidelines below before opening a pull request.

1. **Pull requests are welcome.** If you are unsure whether a change fits, start with a short issue or discussion.
2. **Bug fixes require a linked issue.** Reference the issue number in the PR description (e.g., `Fixes #123`).
3. **Add tests for code changes.** Unit, integration, or snapshot tests should cover the behavior you are touching.
4. **Follow the commit message standard.** We use Conventional Commits (e.g., `feat: add container hooks`, `fix: handle windows paths`).
5. **Run the full quality gate before submitting.** Ensure the following commands succeed locally:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

If you have questions or run into flaky tests, mention it in the PR so reviewers can help. Happy hacking!
