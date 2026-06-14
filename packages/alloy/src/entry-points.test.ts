import { describe, it, expect } from "vitest";
import * as runtime from "./runtime";
import * as vitePlugin from "./vite";
import * as webpackPlugin from "./webpack";
import * as rspackPlugin from "./rspack";
import * as rollupPlugin from "./rollup";
import * as generateEntry from "./generate";

describe("Package Entry Points", () => {
  describe("rollup", () => {
    it("exports alloy factory", () => {
      expect(rollupPlugin.alloy).toBeDefined();
      expect(typeof rollupPlugin.alloy).toBe("function");
      expect(rollupPlugin.default).toBeDefined();
      expect(rollupPlugin.default).toBe(rollupPlugin.alloy);
    });
  });

  describe("vite", () => {
    it("exports alloy factory", () => {
      expect(vitePlugin.alloy).toBeDefined();
      expect(typeof vitePlugin.alloy).toBe("function");
      expect(vitePlugin.default).toBeDefined();
      expect(vitePlugin.default).toBe(vitePlugin.alloy);
    });
  });

  describe("webpack", () => {
    it("exports alloy factory", () => {
      expect(webpackPlugin.alloy).toBeDefined();
      expect(typeof webpackPlugin.alloy).toBe("function");
      expect(webpackPlugin.default).toBeDefined();
      expect(webpackPlugin.default).toBe(webpackPlugin.alloy);
    });
  });

  describe("rspack", () => {
    it("exports alloy factory", () => {
      expect(rspackPlugin.alloy).toBeDefined();
      expect(typeof rspackPlugin.alloy).toBe("function");
      expect(rspackPlugin.default).toBeDefined();
      expect(rspackPlugin.default).toBe(rspackPlugin.alloy);
    });
  });

  describe("runtime", () => {
    it("exports core DI symbols", () => {
      expect(runtime.Container).toBeDefined();
      expect(runtime.Injectable).toBeDefined();
      expect(runtime.Singleton).toBeDefined();
      expect(runtime.deps).toBeDefined();
      expect(runtime.Lazy).toBeDefined();
      expect(runtime.createToken).toBeDefined();
      expect(runtime.defineProviders).toBeDefined();
    });
  });

  describe("generate", () => {
    it("exports declaration generation API", () => {
      expect(generateEntry.generate).toBeDefined();
      expect(typeof generateEntry.generate).toBe("function");
    });
  });
});
