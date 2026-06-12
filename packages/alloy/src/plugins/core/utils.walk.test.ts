import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkSync } from "./utils";

let tmpDir: string;

function makeTree(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-walk-"));
  fs.mkdirSync(path.join(tmpDir, "nested/deep"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
  fs.writeFileSync(path.join(tmpDir, "nested/b.ts"), "");
  fs.writeFileSync(path.join(tmpDir, "nested/deep/c.ts"), "");
  return tmpDir;
}

describe("walkSync", () => {
  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("collects files recursively", () => {
    const dir = makeTree();
    const files = walkSync(dir).map((f) => path.relative(dir, f));
    expect(files.toSorted()).toEqual([
      "a.ts",
      "nested/b.ts",
      "nested/deep/c.ts",
    ]);
  });

  it("returns an empty list for a missing directory", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-walk-"));
    expect(walkSync(path.join(tmpDir, "does-not-exist"))).toEqual([]);
  });

  it("skips dotfiles and dot-directories", () => {
    const dir = makeTree();
    fs.writeFileSync(path.join(dir, ".hidden.ts"), "");
    fs.mkdirSync(path.join(dir, ".cache"));
    fs.writeFileSync(path.join(dir, ".cache/d.ts"), "");
    const files = walkSync(dir).map((f) => path.relative(dir, f));
    expect(files.toSorted()).toEqual([
      "a.ts",
      "nested/b.ts",
      "nested/deep/c.ts",
    ]);
  });

  it("terminates on symlink cycles (issue #27)", () => {
    const dir = makeTree();
    // nested/loop -> <root>, creating a cycle back to an ancestor.
    fs.symlinkSync(dir, path.join(dir, "nested/loop"), "dir");
    const files = walkSync(dir).map((f) => path.relative(dir, f));
    expect(files.toSorted()).toEqual([
      "a.ts",
      "nested/b.ts",
      "nested/deep/c.ts",
    ]);
  });

  it("follows symlinked directories and files outside the tree once", () => {
    const dir = makeTree();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-walk-ext-"));
    try {
      fs.writeFileSync(path.join(external, "ext.ts"), "");
      fs.symlinkSync(external, path.join(dir, "linked"), "dir");
      fs.symlinkSync(
        path.join(external, "ext.ts"),
        path.join(dir, "ext-link.ts"),
        "file",
      );
      const files = walkSync(dir).map((f) => path.relative(dir, f));
      expect(files).toContain("linked/ext.ts");
      expect(files).toContain("ext-link.ts");
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it("ignores broken symlinks", () => {
    const dir = makeTree();
    fs.symlinkSync(
      path.join(dir, "gone.ts"),
      path.join(dir, "broken.ts"),
      "file",
    );
    const files = walkSync(dir).map((f) => path.relative(dir, f));
    expect(files.toSorted()).toEqual([
      "a.ts",
      "nested/b.ts",
      "nested/deep/c.ts",
    ]);
  });
});
