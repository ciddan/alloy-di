import fs from "node:fs";
import path from "node:path";

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;

export function normalizeImportPath(p: string): string {
  const raw = p.trim();
  if (!raw || isBareModuleSpecifier(raw)) {
    return raw;
  }
  return ensureLeadingSlash(normalizeSlashes(raw));
}

function isBareModuleSpecifier(raw: string): boolean {
  return (
    !raw.startsWith("/") &&
    !raw.startsWith("\\") &&
    !raw.startsWith(".") &&
    !raw.startsWith("~") &&
    !WINDOWS_DRIVE_PATTERN.test(raw) &&
    !raw.includes("\\")
  );
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/").replaceAll(/^\/+/g, "/");
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

export function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function createClassKey(filePath: string, className: string): string {
  return `${filePath}::${className}`;
}

export function createAliasName(className: string, filePath: string): string {
  const normalized = normalizeImportPath(filePath);
  const hash = hashString(normalized);
  return `${className}__${hash}`;
}

export function createSymbolKey(filePath: string, className: string): string {
  const normalizedPath = normalizeImportPath(filePath);
  return `alloy:${normalizedPath}#${className}`;
}

const lastWrittenContent = new Map<string, string>();

/**
 * Write a generated artifact only when its content actually changed.
 *
 * @returns true when the file was written, false when it already matched.
 */
export function writeFileIfChanged(filePath: string, content: string): boolean {
  if (lastWrittenContent.get(filePath) === content) {
    return false;
  }

  try {
    if (fs.readFileSync(filePath, "utf-8") === content) {
      lastWrittenContent.set(filePath, content);
      return false;
    }
  } catch {
    // Missing or unreadable — fall through to the write.
  }

  fs.writeFileSync(filePath, content);
  lastWrittenContent.set(filePath, content);
  return true;
}

export function walkSync(
  dir: string,
  fileList: string[] = [],
  visitedDirs?: Set<string>,
): string[] {
  // Directories are tracked by real path so symlink cycles (e.g. a link
  // under src/ pointing back at an ancestor) terminate instead of recursing
  // forever. Symlinked directories are still followed — once.
  const visited = visitedDirs ?? new Set<string>();
  let realDir: string;

  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return fileList;
  }

  if (visited.has(realDir)) {
    return fileList;
  }

  visited.add(realDir);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSync(filePath, fileList, visited);
    } else if (entry.isFile()) {
      fileList.push(filePath);
    } else if (entry.isSymbolicLink()) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue; // broken link
      }

      if (stat.isDirectory()) {
        walkSync(filePath, fileList, visited);
      } else if (stat.isFile()) {
        fileList.push(filePath);
      }
    }
  }

  return fileList;
}
