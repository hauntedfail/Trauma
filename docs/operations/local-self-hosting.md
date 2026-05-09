# Local And Self-Hosted Operation

Trauma is designed for local use first, with a clean path to single-instance
self-hosting.

## Operating Model

Expected runtime:

- One Bun process.
- One SolidStart app.
- One SQLite database file.
- One markdown store on persistent disk.
- Optional git remote for markdown backup.

The initial deployment target is a local machine, VPS, or home server. The
server must have persistent disk access.

## Data Ownership

SQLite owns runtime metadata.

The markdown store owns readable memory content and is the only content area
covered by built-in git backup.

The SQLite database file should be protected by normal host backup strategy if
needed. Trauma's built-in git backup does not commit the database file.

## Git Backup

Built-in backup commits markdown store changes from `storePath` using
`projectPath` as the git working directory.

Backup work is asynchronous. A failed backup does not invalidate memory
creation, highlight creation, or markdown writes. Failures are recorded and
surfaced through metadata.

## Auth

There is no auth in the initial operating model. The app is single-user and
should be deployed behind local access controls, private networking, or a
reverse proxy policy if exposed.

Future public/team operation requires a separate auth design.
