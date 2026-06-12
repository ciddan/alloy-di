import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileIfChanged } from "./utils";

let tmpDir: string | undefined;

function makeTmpFile(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-write-"));
  return path.join(tmpDir, "artifact.d.ts");
}

describe("writeFileIfChanged", () => {
  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes when the file is missing", () => {
    const file = makeTmpFile();
    expect(writeFileIfChanged(file, "content")).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("content");
  });

  it("skips the write when content is identical", () => {
    const file = makeTmpFile();
    writeFileIfChanged(file, "content");
    const before = fs.statSync(file).mtimeMs;
    expect(writeFileIfChanged(file, "content")).toBe(false);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("rewrites when content differs", () => {
    const file = makeTmpFile();
    writeFileIfChanged(file, "old");
    expect(writeFileIfChanged(file, "new")).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("new");
  });

  it("serves repeat calls from memory without touching disk", () => {
    const file = makeTmpFile();
    writeFileIfChanged(file, "content");

    const readSpy = vi.spyOn(fs, "readFileSync");
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    expect(writeFileIfChanged(file, "content")).toBe(false);
    expect(readSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("treats artifacts as volatile: external edits do not defeat the fast path", () => {
    const file = makeTmpFile();
    writeFileIfChanged(file, "content");
    fs.writeFileSync(file, "manual edit");

    // Same generated content -> memory hit, the manual edit is left alone
    // until the generated content actually changes (and then clobbered).
    expect(writeFileIfChanged(file, "content")).toBe(false);
    expect(fs.readFileSync(file, "utf-8")).toBe("manual edit");
    expect(writeFileIfChanged(file, "changed")).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("changed");
  });

  it("read-compares on the first call of a session to avoid a startup write", () => {
    // A path this process has never written: pre-existing identical content
    // must be detected via the disk read, not rewritten.
    const file = makeTmpFile();
    fs.writeFileSync(file, "from previous session");

    const writeSpy = vi.spyOn(fs, "writeFileSync");
    expect(writeFileIfChanged(file, "from previous session")).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
