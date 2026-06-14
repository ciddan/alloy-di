import { describe, expect, it } from "vitest";
import {
  alloy,
  ALLOY_VITE_PLUGIN_OPTIONS,
  type AlloyVitePlugin,
} from "./index";

describe("vite plugin options metadata", () => {
  it("keeps the original options on the plugin for CLI generation", () => {
    const options = {
      providers: ["src/providers.ts"],
      containerDeclarationDir: "generated",
    };
    const plugin = alloy(options) as AlloyVitePlugin;

    expect(plugin[ALLOY_VITE_PLUGIN_OPTIONS]).toBe(options);
  });
});
