import { createToken } from "alloy-di/runtime";

/**
 * Example token for library-level configuration.
 * Consumers can provide overrides at app level; the library ships a default via providers.
 */
export const LibraryApiBaseUrl = createToken<string>("LibraryApiBaseUrl");
