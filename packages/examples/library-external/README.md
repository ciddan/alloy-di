# Example External Library

A sample external logging library that exposes plain classes (no framework decorators) so consumers can wire it into Alloy or any DI system of their choice via providers.

## Overview

This library showcases a simple logging system with:

- **Logger**: Main service that provides logging methods (debug, info, warn, error)
- **IOutput**: Interface for output systems that handle log messages
- **ConsoleOutput**: Console-based implementation of IOutput
- **LogLevel enum**: Shared log level definitions

## Architecture

The library demonstrates key separation-of-concern concepts:

1. **Interface Segregation**: `IOutput` defines the contract for output systems
2. **Dependency Injection Friendly**: `Logger` depends on an `IOutput` implementation via constructor injection
3. **Framework Agnostic**: No decorators or Alloy imports—consumers decide how to register the classes

## Usage Example

```typescript
import { Logger, ConsoleOutput } from "@alloy-di/example-library-external";

// Wire manually or register via Alloy providers in your app
const logger = new Logger(new ConsoleOutput());

logger.info("Application started");
logger.debug("Debug information", { someData: 123 });
logger.warn("Warning message");
logger.error("Error occurred", new Error("Something went wrong"));
```

## Building

```bash
pnpm run build
```

## Files

- `src/logger.ts` - Main Logger service
- `src/output.ts` - IOutput interface
- `src/console-output.ts` - Console implementation of IOutput
- `src/log-level.ts` - Log level enumeration
- `src/index.ts` - Public API exports
