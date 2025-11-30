import { describe, expect, it } from "vitest";
import {
  getImportMetaEnv,
  getNodeEnv,
  isDevEnvironment,
  type ImportMetaEnvShape,
} from "./env-detection";

describe("env-detection", () => {
  describe("getImportMetaEnv", () => {
    it("returns the provided override when present", () => {
      const override: ImportMetaEnvShape = {
        MODE: "test",
        PROD: false,
        NODE_ENV: "development",
        custom: "value",
      };

      expect(getImportMetaEnv({ importMetaEnv: override })).toBe(override);
    });

    it("returns undefined when override explicitly disables import.meta.env", () => {
      expect(getImportMetaEnv({ importMetaEnv: null })).toBeUndefined();
    });
  });

  describe("getNodeEnv", () => {
    it("returns the provided nodeEnv override", () => {
      expect(getNodeEnv({ nodeEnv: "production" })).toBe("production");
    });

    it("returns undefined when nodeEnv override is null", () => {
      expect(getNodeEnv({ nodeEnv: null })).toBeUndefined();
    });
  });

  describe("isDevEnvironment", () => {
    it("short-circuits when the isDev override is provided", () => {
      expect(isDevEnvironment({ isDev: true })).toBe(true);
      expect(isDevEnvironment({ isDev: false })).toBe(false);
    });

    it("derives from nodeEnv override when provided", () => {
      expect(isDevEnvironment({ nodeEnv: "production" })).toBe(false);
      expect(isDevEnvironment({ nodeEnv: "development" })).toBe(true);
    });

    it("falls back to importMetaEnv override hints", () => {
      expect(
        isDevEnvironment({
          nodeEnv: null,
          importMetaEnv: { PROD: true },
        }),
      ).toBe(false);

      expect(
        isDevEnvironment({
          nodeEnv: null,
          importMetaEnv: { MODE: "development" },
        }),
      ).toBe(true);

      expect(
        isDevEnvironment({
          nodeEnv: null,
          importMetaEnv: { NODE_ENV: "production" },
        }),
      ).toBe(false);
    });

    it("defaults to development when no hints are available", () => {
      expect(isDevEnvironment()).toBe(true);
    });
  });
});
