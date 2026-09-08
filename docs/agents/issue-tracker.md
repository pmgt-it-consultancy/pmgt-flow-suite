# Issue tracker: GitHub

Issues and specs live in pmgt-it-consultancy/pmgt-flow-suite on GitHub. Use gh from this checkout.

- Publish with gh issue create using --body-file for multiline text.
- Read the full issue and comments with gh issue view <number> --comments.
- Apply labels with gh issue edit; close only completed child tickets.
- Add native dependencies through POST repos/pmgt-it-consultancy/pmgt-flow-suite/issues/<child>/dependencies/blocked_by with issue_id set to the blocker's numeric database ID. If unavailable, include Blocked by references in the issue body.
- Parent specs remain open unless the user explicitly asks to close them.

PRs as a request surface: no.

