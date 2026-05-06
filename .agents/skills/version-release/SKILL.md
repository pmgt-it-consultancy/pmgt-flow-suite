---
name: version-release
description: Use when bumping the native app version, preparing release notes, making a release commit, or when the user says "bump version", "release", "version bump", "patch release", "minor release", or "major release".
---

# Version Release

## Overview

Prepare a native app release by selecting the bump type, writing user-facing release notes,
running the repo's version script, committing the release files, and pushing when requested.

## Workflow

1. Inspect the worktree with `git status --short`.
2. Determine bump type:
   - `patch`: bug fixes, small UI tweaks, copy changes
   - `minor`: new features, enhancements, new screens
   - `major`: breaking changes, large rewrites, major milestones
3. If the user did not specify a bump type, infer it from recent changes and commits. Ask only if ambiguous.
4. Review recent changes for release notes:
   - Prefer `git log` since the last version bump.
   - Also inspect current staged/unstaged release-relevant changes when present.
5. Update `apps/native/release_notes.txt`.
6. Run the version script from `apps/native`:

```bash
pnpm version:{patch|minor|major}
```

This updates:

- `apps/native/package.json`
- `apps/native/app.config.ts`
- `apps/native/android/app/build.gradle`

7. Read the new version from `apps/native/package.json`.
8. Verify with appropriate checks, at minimum `pnpm --dir apps/native typecheck` unless a narrower project-specific check is clearly sufficient.
9. Commit only release-owned files unless the user explicitly asks to include other work:

```bash
git add apps/native/package.json apps/native/app.config.ts apps/native/android/app/build.gradle apps/native/release_notes.txt
git commit -m "chore: bump version to {new_version} (v{new_version})"
```

10. Push to the current branch only when the user asked for a push/release, or when the release request clearly includes publishing.

## Release Notes Format

Use this exact file structure:

```markdown
## What's New

- Feature or fix description - brief user-facing detail
- Another change

## Notes

- Caveats, behavior notes, or migration info
```

Omit `## Notes` if there are no caveats. Keep entries concise and avoid developer-only jargon.

## Safety Rules

- Do not include unrelated dirty worktree changes in the release commit.
- If release files already have user edits, preserve them unless they conflict with the release.
- Do not run destructive git commands.
- If the version script changes unexpected files, inspect the diff before committing.

## Common Mistakes

- Forgetting `apps/native/release_notes.txt`.
- Using `feat:` for the version bump commit; use `chore:`.
- Committing unrelated feature or fix files with the release bump.
- Pushing before verification completes.
