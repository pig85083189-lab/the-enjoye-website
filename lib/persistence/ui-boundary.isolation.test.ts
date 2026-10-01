import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const UI_DIRS = ["app", "components", "features"];

function walkTsx(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = path.join(abs, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTsx(path.relative(ROOT, full)));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(path.relative(ROOT, full));
    }
  }
  return out;
}

describe("Phase 1B UI persistence boundary", () => {
  it("does not query customers or appointments from React modules", () => {
    const files = UI_DIRS.flatMap(walkTsx);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (/\.from\(\s*["']customers["']\s*\)/.test(source)) offenders.push(`${file}:customers`);
      if (/\.from\(\s*["']appointments["']\s*\)/.test(source)) offenders.push(`${file}:appointments`);
    }
    expect(offenders).toEqual([]);
  });
});
