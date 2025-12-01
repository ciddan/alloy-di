import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const coverageRoot = path.join(repoRoot, "coverage");
const rawDir = path.join(coverageRoot, "raw");
const mergedDir = path.join(coverageRoot, "merged");

async function prepareDirs(): Promise<void> {
  await fs.rm(coverageRoot, { recursive: true, force: true });
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(mergedDir, { recursive: true });
}

type PackageInfo = {
  name: string;
};

async function collectCoverageFiles(): Promise<void> {
  const coverageFiles = await glob(
    "packages/**/analytics/coverage/coverage-final.json",
    {
      cwd: repoRoot,
      absolute: true,
    },
  );

  if (coverageFiles.length === 0) {
    throw new Error(
      "No coverage-final.json files were found. Did you run `pnpm test:cover`?",
    );
  }

  await Promise.all(
    coverageFiles.map(async (source) => {
      const coverageDir = path.dirname(source);
      const packageRoot = path.resolve(coverageDir, "..", "..");
      const packageJsonPath = path.join(packageRoot, "package.json");

      let packageName = path.basename(packageRoot);
      try {
        const pkgJson = JSON.parse(
          await fs.readFile(packageJsonPath, "utf8"),
        ) as PackageInfo;
        if (pkgJson.name) {
          packageName = pkgJson.name;
        }
      } catch (error) {
        console.warn(`Unable to read package.json for ${packageRoot}:`, error);
      }

      const sanitized = packageName.replace(/@/g, "").replace(/[/]/g, "-");
      const destination = path.join(rawDir, `${sanitized}.json`);
      await fs.copyFile(source, destination);
    }),
  );
}

function run(command: string): void {
  execSync(command, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function generateReports(): void {
  run("pnpm exec nyc merge coverage/raw coverage/merged/coverage.json");
  run(
    "pnpm exec nyc report --temp-dir coverage/merged --report-dir coverage --reporter=lcov --reporter=text-summary",
  );
}

async function main(): Promise<void> {
  await prepareDirs();
  await collectCoverageFiles();
  generateReports();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
