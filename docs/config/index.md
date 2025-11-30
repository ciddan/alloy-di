# Configuration Overview

Alloy is configured via its build plugins. The configuration interface is consistent across build tools but tailored to their specific requirements.

- [Vite Plugin Configuration](/config/vite-plugin)
- [Rollup/Rolldown Plugin Configuration](/config/rollup-plugin)

## Common Options

Both plugins share core options for managing dependency injection behavior:

- **providers**: Register services from external libraries or existing code without decorators.
- **manifests**: Import pre-built manifests from internal libraries to enable monorepo support.
