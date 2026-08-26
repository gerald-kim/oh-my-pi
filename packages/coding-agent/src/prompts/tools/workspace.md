Manage the current session's explicit workspace roots.

Use `list` to inspect the working directory and additional roots. Use `add` before working in a repository or worktree that is not already a workspace root; adding a root loads its project context for subsequent model calls and enables project-scoped tooling such as LSP discovery. Use `remove` only when that root is no longer part of the active task.

`add` and `remove` require `path`. Paths may be absolute or relative to the session working directory. Never add a broad parent directory when the narrower repository or worktree root is known.