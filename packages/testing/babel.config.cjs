// Babel config used only by the Jest adapter test run. Vitest and the build
// (rolldown) do not use Babel. `@babel/preset-env` keeps ESM output when Jest
// signals static-ESM support (via the babel-jest caller), so `alloy-di`'s
// import-only package exports resolve correctly under Jest's ESM mode.
module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    "@babel/preset-typescript",
  ],
};
