/**
 * extract-doc.test.ts — Bun test suite for scripts/extract-doc.ts
 *
 * Each test creates small fixture .ts files in a temporary directory,
 * runs the extractor, and asserts the output.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractFromFile,
  extractFromFileTS,
  walkDir,
  globToRegex,
  renderMarkdown,
  parseArgs,
  run,
  type DocItem,
  type ExtractResult,
} from "../extract-doc";

// ---------------------------------------------------------------------------
// Test directory setup
// ---------------------------------------------------------------------------

const ROOT = join(tmpdir(), `fc-extract-doc-test-${process.pid}`);

function mkdir(rel: string): string {
  const p = join(ROOT, rel);
  mkdirSync(p, { recursive: true });
  return p;
}

function write(rel: string, content: string): string {
  const full = join(ROOT, rel);
  mkdirSync(join(ROOT, rel, "..").replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: run extractor on a fixture file
// ---------------------------------------------------------------------------

function extract(relPath: string, symbols: string[] = []): DocItem[] {
  return extractFromFile(join(ROOT, relPath), ROOT, symbols);
}

// ---------------------------------------------------------------------------
// 1. Function with JSDoc + @param/@returns
// ---------------------------------------------------------------------------

test("function with JSDoc @param and @returns is extracted", () => {
  write(
    "func.ts",
    `
/**
 * Add two numbers together.
 * @param a The first number
 * @param b The second number
 * @returns Their sum
 */
export function add(a: number, b: number): number {
  return a + b;
}
`
  );

  const items = extract("func.ts");
  expect(items.length).toBeGreaterThanOrEqual(1);

  const item = items.find((i) => i.symbol === "add");
  expect(item).toBeDefined();
  expect(item!.kind).toBe("function");
  expect(item!.doc).toContain("Add two numbers");
  expect(item!.signature).toMatch(/add\s*\(/);

  const paramTags = item!.tags.filter((t) => t.tag === "param");
  expect(paramTags.length).toBe(2);
  expect(paramTags[0].name).toBe("a");
  expect(paramTags[1].name).toBe("b");

  const returnTag = item!.tags.find((t) => t.tag === "returns");
  expect(returnTag).toBeDefined();
  expect(returnTag!.text).toMatch(/sum/i);
});

// ---------------------------------------------------------------------------
// 2. Class with method docs (kind = method)
// ---------------------------------------------------------------------------

test("class method with JSDoc has kind=method and qualified symbol name", () => {
  write(
    "cls.ts",
    `
/**
 * A sample service class.
 */
export class UserService {
  /**
   * Fetch a user by ID.
   * @param id The user ID
   * @returns The user object
   */
  async getUser(id: string): Promise<User> {
    return fetch(\`/users/\${id}\`);
  }
}
`
  );

  const items = extract("cls.ts");
  const method = items.find((i) => i.kind === "method");
  expect(method).toBeDefined();
  expect(method!.symbol).toBe("UserService.getUser");
  expect(method!.doc).toContain("Fetch a user");
  expect(method!.tags.some((t) => t.tag === "param")).toBe(true);
});

// ---------------------------------------------------------------------------
// 3. Interface with member doc
// ---------------------------------------------------------------------------

test("interface declaration is extracted with kind=interface", () => {
  write(
    "iface.ts",
    `
/**
 * Represents a product entity.
 */
export interface Product {
  id: string;
  name: string;
  price: number;
}
`
  );

  const items = extract("iface.ts");
  const iface = items.find((i) => i.kind === "interface");
  expect(iface).toBeDefined();
  expect(iface!.symbol).toBe("Product");
  expect(iface!.doc).toContain("product entity");
});

// ---------------------------------------------------------------------------
// 4. Type alias
// ---------------------------------------------------------------------------

test("type alias with JSDoc has kind=type", () => {
  write(
    "typealias.ts",
    `
/**
 * A string-keyed record with any values.
 */
export type AnyRecord = Record<string, unknown>;
`
  );

  const items = extract("typealias.ts");
  const typeItem = items.find((i) => i.kind === "type");
  expect(typeItem).toBeDefined();
  expect(typeItem!.symbol).toBe("AnyRecord");
  expect(typeItem!.doc).toContain("string-keyed");
});

// ---------------------------------------------------------------------------
// 5. Const with doc
// ---------------------------------------------------------------------------

test("const declaration with JSDoc has kind=const", () => {
  write(
    "constfile.ts",
    `
/**
 * Default timeout in milliseconds.
 */
export const DEFAULT_TIMEOUT = 5000;
`
  );

  const items = extract("constfile.ts");
  const constItem = items.find((i) => i.kind === "const");
  expect(constItem).toBeDefined();
  expect(constItem!.symbol).toBe("DEFAULT_TIMEOUT");
  expect(constItem!.doc).toContain("timeout");
});

// ---------------------------------------------------------------------------
// 6. Skip files in node_modules and dist
// ---------------------------------------------------------------------------

test("files in node_modules and dist are always skipped", () => {
  const nmDir = mkdir("node_modules/somelib");
  writeFileSync(
    join(nmDir, "index.ts"),
    `/** Doc */ export function libFn() {}`
  );

  const distDir = mkdir("dist");
  writeFileSync(
    join(distDir, "bundle.ts"),
    `/** Doc */ export function bundled() {}`
  );

  const files = walkDir(ROOT, ROOT, [], []);
  const hasNm = files.some((f) => f.includes("node_modules"));
  const hasDist = files.some((f) => f.includes(`${ROOT}/dist`));
  expect(hasNm).toBe(false);
  expect(hasDist).toBe(false);
});

// ---------------------------------------------------------------------------
// 7. Include glob filter
// ---------------------------------------------------------------------------

test("--include glob restricts scanned files", () => {
  const subDir = mkdir("services");
  writeFileSync(
    join(subDir, "api.ts"),
    `/** API */ export function apiCall() {}`
  );
  write("toplevel.ts", `/** Top */ export function topFn() {}`);

  const files = walkDir(ROOT, ROOT, ["services/**"], []);
  expect(files.some((f) => f.includes("services/api.ts"))).toBe(true);
  expect(files.some((f) => f.endsWith("toplevel.ts"))).toBe(false);
});

// ---------------------------------------------------------------------------
// 8. Exclude glob filter
// ---------------------------------------------------------------------------

test("--exclude glob removes matched files from scan", () => {
  mkdir("generated");
  write("generated/auto.ts", `/** Auto */ export function gen() {}`);
  write("manual.ts", `/** Manual */ export function manual() {}`);

  const files = walkDir(ROOT, ROOT, [], ["generated/**"]);
  expect(files.some((f) => f.includes("generated/auto.ts"))).toBe(false);
  expect(files.some((f) => f.endsWith("manual.ts"))).toBe(true);
});

// ---------------------------------------------------------------------------
// 9. Symbol filter — single name
// ---------------------------------------------------------------------------

test("--symbols filter returns only the matching symbol", () => {
  write(
    "multi.ts",
    `
/**
 * First function.
 */
export function alpha(): void {}

/**
 * Second function.
 */
export function beta(): void {}
`
  );

  const items = extract("multi.ts", ["alpha"]);
  expect(items.every((i) => i.symbol === "alpha")).toBe(true);
  expect(items.some((i) => i.symbol === "beta")).toBe(false);
});

// ---------------------------------------------------------------------------
// 10. Symbol filter — Class.method notation
// ---------------------------------------------------------------------------

test("--symbols filter supports Class.method notation", () => {
  write(
    "clsfilter.ts",
    `
/**
 * Repository class.
 */
export class Repo {
  /**
   * Find all records.
   */
  findAll(): string[] { return []; }

  /**
   * Find one by ID.
   * @param id Record ID
   */
  findOne(id: string): string { return id; }
}
`
  );

  const items = extract("clsfilter.ts", ["Repo.findOne"]);
  expect(items.length).toBeGreaterThanOrEqual(1);
  expect(items.some((i) => i.symbol === "Repo.findOne")).toBe(true);
  expect(items.some((i) => i.symbol === "Repo.findAll")).toBe(false);
});

// ---------------------------------------------------------------------------
// 11. max-files cap warns and truncates
// ---------------------------------------------------------------------------

test("max-files cap truncates file list and warns to stderr", async () => {
  // Create enough files in a subdirectory
  const capDir = mkdir("capped");
  for (let n = 0; n < 5; n++) {
    writeFileSync(join(capDir, `file${n}.ts`), `/** Doc ${n} */ export function fn${n}() {}`);
  }

  const stderrLines: string[] = [];
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => stderrLines.push(args.join(" "));

  const result = await run({
    workdir: capDir,
    include: [],
    exclude: [],
    symbols: [],
    format: "json",
    maxFiles: 2,
    out: null,
  });

  console.error = origError;

  expect(result.scannedFiles).toBeLessThanOrEqual(2);
  expect(stderrLines.some((l) => l.includes("truncating"))).toBe(true);
});

// ---------------------------------------------------------------------------
// 12. Markdown format renders expected headings
// ---------------------------------------------------------------------------

test("markdown format renders file and symbol headings", async () => {
  write(
    "mdfile.ts",
    `
/**
 * Greet someone.
 * @param name The person's name
 * @returns A greeting string
 */
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`
  );

  let mdOutput = "";
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    if (typeof chunk === "string") mdOutput += chunk;
    return true;
  };

  await run({
    workdir: ROOT,
    include: ["mdfile.ts"],
    exclude: [],
    symbols: ["greet"],
    format: "md",
    maxFiles: 500,
    out: null,
  });

  process.stdout.write = origWrite;

  expect(mdOutput).toContain("## mdfile.ts");
  expect(mdOutput).toContain("### greet [function]");
  expect(mdOutput).toContain("```ts");
  expect(mdOutput).toContain("Greet someone");
});

// ---------------------------------------------------------------------------
// 13. Bad workdir exits with code 2
// ---------------------------------------------------------------------------

test("non-existent workdir calls process.exit(2)", async () => {
  let exitCode: number | null = null;
  const origExit = process.exit.bind(process);
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;

  try {
    await run({
      workdir: "/nonexistent/path/fc-test-xyzzy",
      include: [],
      exclude: [],
      symbols: [],
      format: "json",
      maxFiles: 500,
      out: null,
    });
  } catch {
    // expected
  } finally {
    process.exit = origExit;
  }

  expect(exitCode).toBe(2);
});
