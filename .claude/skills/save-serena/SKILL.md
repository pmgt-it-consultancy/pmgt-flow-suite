---
name: save:serena
description: Save the current progress or the accomplished work in Serena. So that we have a generalized location to store all the work done.
---

# Save Progress to Serena

Save a summary of the current work to Serena's memory system so it persists across conversations.

## Process

1. **Activate the Serena project** (`pmgt-flow-suite`) if not already active using `mcp__serena__activate_project`.

2. **Gather context** — run these in parallel:
   - `git log --oneline -20` to see recent commits
   - `git log --oneline <base-branch>..HEAD` to see branch-specific work (use `feature/pos-system` or `main` as base)
   - `git status` to see uncommitted changes
   - `git branch --show-current` to get current branch name

3. **Check existing Serena memories** — use `mcp__serena__list_memories` and read any existing memory for the current branch to decide whether to update or create.

4. **Write the memory** using `mcp__serena__write_memory` with:
   - **Memory name**: Use the branch name as the memory name (e.g., `performance-optimizations-branch`)
   - **Content format**:
     ```markdown
     # {Branch Name} Branch

     **Branch:** `{branch}`
     **Base:** `{base-branch}`
     **Current version:** {version}
     **Date:** {today}

     ## Work Done on This Branch

     ### {Feature Group} (v{version})
     - Description of change (commit hash)
     - ...

     ## Uncommitted Changes (if any)
     - Summary of what's staged/modified
     ```

5. **Confirm** — report what was saved to the user.

## Notes
- Group commits by feature/version, not chronologically
- Keep descriptions concise and user-facing
- Update existing memory if one already exists for the branch rather than creating duplicates
- Include version numbers where relevant
