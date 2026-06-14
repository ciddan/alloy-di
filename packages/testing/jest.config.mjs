// Jest runs only the Jest adapter smoke test, in ESM mode (Node's native ESM)
// so `alloy-di`'s import-only package exports resolve. Vitest remains the
// package's primary runner; see vitest.config.ts.
/** @type {import("jest").Config} */
export default {
  rootDir: ".",
  testMatch: ["<rootDir>/src/runner-tests/**/*.jest.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "js", "mjs", "cjs", "json", "node"],
  transform: {
    "^.+\\.ts$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/"],
  testEnvironment: "node",
  testEnvironmentOptions: {
    customExportConditions: ["node", "import"],
  },
};
