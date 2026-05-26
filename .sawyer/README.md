# Sawyer the Cleaner

Sawyer is the repository finalizer for agent work. The orchestrator passes the
completed work summary, verification results, intended files, excluded paths, and
target remote/branch. Sawyer stages, commits, and pushes each coherent unit of
work while preserving unrelated user changes.

## Exclusion Whitelist

`.sawyer/exclude-whitelist.txt` lists repo-relative files and directories that
agents must exclude from commits even when Git does not ignore them.

Rules:

- Blank lines and lines beginning with `#` are comments.
- Directory entries should end with `/`.
- Sawyer must not stage listed paths.
- Sawyer must not delete listed paths from the working tree.
- If a listed path is accidentally staged during finalization, Sawyer must
  unstage it before committing.

