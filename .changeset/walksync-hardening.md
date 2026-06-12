---
"alloy-di": patch
---

Harden the `buildStart` source scan against symlink cycles. A symlink under
`src/` pointing back at an ancestor directory made the recursive walk follow
it until the kernel's `ELOOP` limit aborted the build. Directories are now
tracked by real path so cycles terminate (symlinked directories are still
followed once), broken symlinks are skipped, dotfiles and dot-directories
are no longer scanned, and the walk stats each entry once via dirents
instead of twice.
