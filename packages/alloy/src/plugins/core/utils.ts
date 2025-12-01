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
    hash = Math.trunc(hash * 31 + value.charCodeAt(i));
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

export function walkSync(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return fileList;
  }
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkSync(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });
  return fileList;
}
