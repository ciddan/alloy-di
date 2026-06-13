import fs from "node:fs";

/**
 * Warn if the emitted manifest / service-identifiers assets are not exposed via
 * the package's `exports` map, since consumers wouldn't be able to import them.
 */
export function checkPackageExports(
  packageJsonPath: string,
  manifestFileName: string,
) {
  try {
    const pkgRaw = fs.readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(pkgRaw);
    if (!pkg.exports) {
      return;
    }

    const exports = pkg.exports;
    const hasManifest = Object.values(exports).some(
      (e: unknown) =>
        (typeof e === "string" && e.includes(manifestFileName)) ||
        (typeof e === "object" &&
          e !== null &&
          Object.values(e).some((v: unknown) =>
            String(v).includes(manifestFileName),
          )),
    );

    const hasIdentifiers = Object.values(exports).some(
      (e: unknown) =>
        (typeof e === "string" && e.includes("service-identifiers.mjs")) ||
        (typeof e === "object" &&
          e !== null &&
          Object.values(e).some((v: unknown) =>
            String(v).includes("service-identifiers.mjs"),
          )),
    );

    if (!hasManifest) {
      console.warn(
        `[alloy] Warning: ${manifestFileName} is not exposed in package.json "exports". Consumers may not be able to access the manifest.`,
      );
    }
    if (!hasIdentifiers) {
      console.warn(
        `[alloy] Warning: service-identifiers.mjs is not exposed in package.json "exports". Consumers may not be able to access the generated identifiers helper.`,
      );
    }
  } catch {
    // ignore
  }
}
