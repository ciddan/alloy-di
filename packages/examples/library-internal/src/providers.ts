import { defineProviders, asValue } from "alloy-di/runtime";
import { LibraryApiBaseUrl } from "./tokens";

/**
 * Provider module for the internal example library.
 * Registers a simple token/value that can be consumed by services or applications.
 *
 * The Alloy rollup manifest plugin will include this file when preserveModules is enabled.
 * Consumer apps can auto-import and apply these providers in the generated container.
 */
export default defineProviders({
  values: [asValue(LibraryApiBaseUrl, "https://internal.example/api")],
});
