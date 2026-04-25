#!/usr/bin/env bun
/**
 * extract-doc.ts — TSDoc/JSDoc extractor for FreeClaude Quest Mode context priming.
 *
 * Uses the TypeScript compiler API to walk ASTs and extract documented symbols with
 * their signatures and structured doc tags. Falls back to a regex extractor if the
 * TS compiler API is unavailable (documented below).
 *
 * Usage:
 *   bun run scripts/extract-doc.ts --workdir DIR [--include "glob,glob"] [--exclude "glob,glob"]
 *                                   [--symbols "name1,name2"] [--format json|md] [--max-files N]
 *                                   [--out PATH]
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative, extname, resolve } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// TypeScript compiler API — import or fall back
// ---------------------------------------------------------------------------

let ts: typeof import("typescript") | null = null;
let TS_API_AVAILABLE = false;

try {
  // Dynamic import to allow graceful fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ts = require("typescript") as typeof import("typescript");
  TS_API_AVAILABLE = true;
} catch {
  console.error(
    "[extract-doc] WARNING: TypeScript compiler API unavailable; falling back to regex extractor. " +
      "Signatures will be approximate and tags may be missed."
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One extracted documented symbol. */
export interface DocItem {
  file: string;
  symbol: string;
  kind: "function" | "class" | "method" | "interface" | "type" | "const";
  signature: string;
  doc: string;
  tags: Array<{ tag: string; name?: string; text?: string }>;
  loc: { line: number; col: number };
}

/** Top-level output shape. */
export interface ExtractResult {
  workdir: string;
  scannedFiles: number;
  extractedSymbols: number;
  items: DocItem[];
}

/** CLI options. */
interface CliOptions {
  workdir: string;
  include: string[];
  exclude: string[];
  symbols: string[];
  format: "json" | "md";
  maxFiles: number;
  out: string | null;
}

// ---------------------------------------------------------------------------
// Minimal glob matcher
// ---------------------------------------------------------------------------
// Supports `*`, `**`, `?`, and character classes `[abc]`.
// Limitation: does NOT support brace expansions like `{a,b}`.
// Patterns are matched against the POSIX-style relative path from workdir.

/**
 * Convert a glob pattern to a RegExp.
 * Supports: `*` (within segment), `**` (multi-segment), `?`, `[...]`.
 */
export function globToRegex(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i++; // skip trailing slash after **
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i);
      if (close === -1) {
        re += "\\[";
        i++;
      } else {
        re += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else {
      re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
      i++;
    }
  }
  re += "$";
  return new RegExp(re);
}

/** Return true if relPath matches any pattern in the list. */
function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(relPath));
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

const ALWAYS_SKIP = new Set(["node_modules", "dist", "build", ".git"]);
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".mjs"]);

/**
 * Recursively walk a directory and return source file paths.
 * Skips ALWAYS_SKIP directories unconditionally.
 */
export function walkDir(
  dir: string,
  workdir: string,
  include: string[],
  exclude: string[]
): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(workdir, full);

    if (entry.isDirectory()) {
      results.push(...walkDir(full, workdir, include, exclude));
    } else if (entry.isFile()) {
      if (!SOURCE_EXTS.has(extname(entry.name))) continue;
      // Include filter: if provided, file must match at least one include glob
      if (include.length > 0 && !matchesAny(rel, include)) continue;
      // Exclude filter: if provided, skip files matching any exclude glob
      if (exclude.length > 0 && matchesAny(rel, exclude)) continue;
      results.push(full);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// TS compiler API extractor
// ---------------------------------------------------------------------------

/**
 * Map a TS SyntaxKind to our simplified kind string.
 */
function kindFromSyntaxKind(
  kind: number
): DocItem["kind"] | null {
  if (!ts) return null;
  switch (kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
      return "function";
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
      return "class";
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.MethodSignature:
      return "method";
    case ts.SyntaxKind.InterfaceDeclaration:
      return "interface";
    case ts.SyntaxKind.TypeAliasDeclaration:
      return "type";
    case ts.SyntaxKind.VariableStatement:
    case ts.SyntaxKind.VariableDeclaration:
      return "const";
    default:
      return null;
  }
}

/**
 * Truncate a signature to at most 200 chars.
 */
function truncateSig(sig: string): string {
  const clean = sig.replace(/\s+/g, " ").trim();
  return clean.length > 200 ? clean.slice(0, 197) + "..." : clean;
}

/**
 * Extract the symbol name from an AST node.
 * Returns "default" for anonymous default exports.
 */
function getSymbolName(node: import("typescript").Node): string {
  if (!ts) return "unknown";
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return (node as { name?: { text: string } }).name?.text ?? "default";
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const name = (node as { name?: import("typescript").Node }).name;
    if (name && ts.isIdentifier(name)) return name.text;
    if (name && ts.isStringLiteral(name)) return name.text;
    return "<computed>";
  }
  if (ts.isVariableStatement(node)) {
    const decls = node.declarationList.declarations;
    if (decls.length > 0 && ts.isIdentifier(decls[0].name)) {
      return decls[0].name.text;
    }
  }
  return "unknown";
}

/**
 * Build a human-readable one-line signature for a node.
 */
function buildSignature(
  node: import("typescript").Node,
  sourceFile: import("typescript").SourceFile,
  kind: DocItem["kind"]
): string {
  if (!ts) return "";

  // For variable statements use the first declaration
  const target =
    kind === "const" && ts.isVariableStatement(node)
      ? node.declarationList.declarations[0]
      : node;

  let text = target.getText(sourceFile);

  // For functions/methods, strip the body to get just the signature
  if (
    kind === "function" ||
    kind === "method"
  ) {
    const fn = node as import("typescript").FunctionDeclaration;
    if (fn.body) {
      const bodyStart = fn.body.getStart(sourceFile);
      const nodeStart = node.getStart(sourceFile);
      text = text.slice(0, bodyStart - nodeStart).trim();
    }
  }
  // For classes/interfaces, strip the body
  if (kind === "class" || kind === "interface") {
    const cl = node as import("typescript").ClassDeclaration;
    const members = cl.members;
    if (members && members.length > 0) {
      const firstMember = members[0].getStart(sourceFile);
      const nodeStart = node.getStart(sourceFile);
      text = text.slice(0, firstMember - nodeStart).trim() + " { ... }";
    }
  }

  return truncateSig(text);
}

/**
 * Parse raw JSDoc tag nodes into our simplified DocTag shape.
 */
function extractTags(
  jsDocNodes: readonly import("typescript").JSDoc[]
): DocItem["tags"] {
  if (!ts) return [];

  const SUPPORTED_TAGS = new Set([
    "param", "returns", "return", "throws", "example",
    "deprecated", "since", "see",
  ]);

  const tags: DocItem["tags"] = [];

  for (const jsDoc of jsDocNodes) {
    if (!jsDoc.tags) continue;
    for (const tag of jsDoc.tags) {
      const tagName = tag.tagName.text.toLowerCase();
      if (!SUPPORTED_TAGS.has(tagName)) continue;

      const text =
        typeof tag.comment === "string"
          ? tag.comment
          : Array.isArray(tag.comment)
          ? (tag.comment as Array<{ text?: string }>)
              .map((c) => c.text ?? "")
              .join("")
          : "";

      if (ts.isJSDocParameterTag(tag)) {
        tags.push({
          tag: "param",
          name: ts.isIdentifier(tag.name) ? tag.name.text : tag.name.getText(),
          text,
        });
      } else if (tagName === "returns" || tagName === "return") {
        tags.push({ tag: "returns", text });
      } else {
        tags.push({ tag: tagName, text });
      }
    }
  }

  return tags;
}

/**
 * Extract the plain-text doc comment from JSDoc nodes.
 */
function extractDocComment(
  jsDocNodes: readonly import("typescript").JSDoc[]
): string {
  return jsDocNodes
    .map((jd) => {
      if (typeof jd.comment === "string") return jd.comment;
      if (Array.isArray(jd.comment)) {
        return (jd.comment as Array<{ text?: string }>)
          .map((c) => c.text ?? "")
          .join("");
      }
      return "";
    })
    .join("\n")
    .trim();
}

/**
 * Extract documented symbols from a single source file using the TS compiler API.
 */
export function extractFromFileTS(
  filePath: string,
  workdir: string,
  symbolFilter: string[]
): DocItem[] {
  if (!ts) return [];

  const content = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true
  );

  const relFile = relative(workdir, filePath);
  const items: DocItem[] = [];

  const TRACKED_KINDS = new Set([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.MethodSignature,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.VariableStatement,
  ]);

  function visit(node: import("typescript").Node, parentClass?: string): void {
    if (TRACKED_KINDS.has(node.kind)) {
      const kind = kindFromSyntaxKind(node.kind);

      // Compute newParent for class members before any early return
      const newParent =
        node.kind === ts!.SyntaxKind.ClassDeclaration ||
        node.kind === ts!.SyntaxKind.ClassExpression
          ? getSymbolName(node)
          : parentClass;

      if (!kind) {
        ts!.forEachChild(node, (child) => visit(child, newParent));
        return;
      }

      const jsDocNodes = ts!.getJSDocCommentsAndTags(node).filter(
        (n): n is import("typescript").JSDoc => n.kind === ts!.SyntaxKind.JSDoc
      );

      if (jsDocNodes.length > 0) {
        const symbolName = getSymbolName(node);
        const qualifiedName =
          parentClass && kind === "method"
            ? `${parentClass}.${symbolName}`
            : symbolName;

        // Apply symbol filter
        if (symbolFilter.length > 0) {
          const match =
            symbolFilter.includes(symbolName) ||
            symbolFilter.includes(qualifiedName);
          if (!match) {
            // Use newParent so Class.method filters work on nested visits
            ts!.forEachChild(node, (child) => visit(child, newParent));
            return;
          }
        }

        const signature = buildSignature(node, sourceFile, kind);
        const doc = extractDocComment(jsDocNodes);
        const tags = extractTags(jsDocNodes);

        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile)
        );

        items.push({
          file: relFile,
          symbol: qualifiedName,
          kind,
          signature,
          doc,
          tags,
          loc: { line: line + 1, col: character + 1 },
        });
      }

      ts!.forEachChild(node, (child) => visit(child, newParent));
    } else {
      ts!.forEachChild(node, (child) => visit(child, parentClass));
    }
  }

  ts.forEachChild(sourceFile, (child) => visit(child));
  return items;
}

// ---------------------------------------------------------------------------
// Regex-based fallback extractor
// ---------------------------------------------------------------------------
// Limitation: cannot reliably parse generic types, overloads, or complex
// destructured parameters. Tag extraction is best-effort.

const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//g;
const JSDOC_TAG = /@(\w+)(?:\s+\{[^}]*\})?\s*(\S*)\s*([^\n@]*)/g;

/**
 * Regex fallback: extract documented symbols from a source file.
 * Used when the TypeScript compiler API is unavailable.
 */
export function extractFromFileRegex(
  filePath: string,
  workdir: string,
  symbolFilter: string[]
): DocItem[] {
  const content = readFileSync(filePath, "utf8");
  const relFile = relative(workdir, filePath);
  const lines = content.split("\n");
  const items: DocItem[] = [];

  const blocks = [...content.matchAll(JSDOC_BLOCK)];

  for (const block of blocks) {
    const blockEnd = block.index! + block[0].length;
    // Find the first non-blank line after the JSDoc block
    const after = content.slice(blockEnd).match(/^\s*\n?(.*)/);
    if (!after) continue;
    const declLine = after[1].trim();
    if (!declLine || declLine.startsWith("//") || declLine.startsWith("/*"))
      continue;

    // Determine kind and symbol name
    let kind: DocItem["kind"] | null = null;
    let symbol = "unknown";

    if (/^export\s+(async\s+)?function\s+(\w+)/.test(declLine)) {
      kind = "function";
      symbol = declLine.match(/function\s+(\w+)/)![1];
    } else if (/^(export\s+)?class\s+(\w+)/.test(declLine)) {
      kind = "class";
      symbol = declLine.match(/class\s+(\w+)/)![1];
    } else if (/^(export\s+)?interface\s+(\w+)/.test(declLine)) {
      kind = "interface";
      symbol = declLine.match(/interface\s+(\w+)/)![1];
    } else if (/^(export\s+)?type\s+(\w+)/.test(declLine)) {
      kind = "type";
      symbol = declLine.match(/type\s+(\w+)/)![1];
    } else if (
      /^(export\s+)?(const|let|var)\s+(\w+)/.test(declLine) ||
      /^\w+\s*\(/.test(declLine)
    ) {
      kind = "const";
      const m = declLine.match(/(const|let|var)\s+(\w+)/);
      symbol = m ? m[2] : "unknown";
    }

    if (!kind || symbol === "unknown") continue;
    if (symbolFilter.length > 0 && !symbolFilter.includes(symbol)) continue;

    // Parse the JSDoc comment
    const raw = block[0];
    const doc = raw
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/@\w+.*/g, "")
      .trim();

    const tags: DocItem["tags"] = [];
    let tagMatch: RegExpExecArray | null;
    JSDOC_TAG.lastIndex = 0;
    while ((tagMatch = JSDOC_TAG.exec(raw)) !== null) {
      const [, tagName, namePart, textPart] = tagMatch;
      const SUPPORTED = ["param", "returns", "return", "throws", "example", "deprecated", "since", "see"];
      if (!SUPPORTED.includes(tagName.toLowerCase())) continue;
      if (tagName.toLowerCase() === "param") {
        tags.push({ tag: "param", name: namePart, text: textPart.trim() });
      } else {
        tags.push({ tag: tagName.toLowerCase(), text: (namePart + " " + textPart).trim() });
      }
    }

    // Compute line number
    const linesBefore = content.slice(0, blockEnd).split("\n").length;
    const col = lines[linesBefore]?.search(/\S/) + 1 || 1;

    items.push({
      file: relFile,
      symbol,
      kind,
      signature: truncateSig(declLine),
      doc,
      tags,
      loc: { line: linesBefore + 1, col },
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Extract documented symbols from a single file, using TS API when available.
 */
export function extractFromFile(
  filePath: string,
  workdir: string,
  symbolFilter: string[]
): DocItem[] {
  try {
    return TS_API_AVAILABLE
      ? extractFromFileTS(filePath, workdir, symbolFilter)
      : extractFromFileRegex(filePath, workdir, symbolFilter);
  } catch (err) {
    console.error(`[extract-doc] Error processing ${filePath}: ${(err as Error).message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

/**
 * Render extracted items as Markdown, grouped by file.
 */
export function renderMarkdown(result: ExtractResult): string {
  const byFile = new Map<string, DocItem[]>();
  for (const item of result.items) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file)!.push(item);
  }

  const parts: string[] = [
    `# Doc context`,
    ``,
    `- **workdir**: \`${result.workdir}\``,
    `- **scannedFiles**: ${result.scannedFiles}`,
    `- **extractedSymbols**: ${result.extractedSymbols}`,
    ``,
  ];

  for (const [file, items] of byFile) {
    parts.push(`## ${file}`, ``);
    for (const item of items) {
      parts.push(`### ${item.symbol} [${item.kind}]`, ``);
      parts.push("```ts", item.signature, "```", ``);
      if (item.doc) parts.push(item.doc, ``);
      if (item.tags.length > 0) {
        for (const t of item.tags) {
          const namePart = t.name ? ` \`${t.name}\`` : "";
          parts.push(`- **@${t.tag}**${namePart}: ${t.text ?? ""}`);
        }
        parts.push(``);
      }
      parts.push(`*Line ${item.loc.line}, col ${item.loc.col}*`, ``);
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into CliOptions.
 * Exits with code 1 on invalid arguments.
 */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    workdir: process.cwd(),
    include: [],
    exclude: [],
    symbols: [],
    format: "json",
    maxFiles: 500,
    out: null,
  };

  const args = argv.slice(2);
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "--workdir":
        opts.workdir = args[++i];
        break;
      case "--include":
        opts.include = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--exclude":
        opts.exclude = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--symbols":
        opts.symbols = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--format":
        opts.format = args[++i] as "json" | "md";
        if (opts.format !== "json" && opts.format !== "md") {
          console.error("--format must be 'json' or 'md'");
          process.exit(1);
        }
        break;
      case "--max-files":
        opts.maxFiles = parseInt(args[++i], 10);
        break;
      case "--out":
        opts.out = args[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
    i++;
  }

  return opts;
}

/** Print CLI help text. */
function printHelp(): void {
  console.log(`
extract-doc.ts — TSDoc/JSDoc extractor for FreeClaude Quest Mode

USAGE:
  bun run scripts/extract-doc.ts --workdir DIR [OPTIONS]

OPTIONS:
  --workdir DIR          Root directory to scan (default: cwd)
  --include "glob,glob"  Only include files matching these globs
  --exclude "glob,glob"  Exclude files matching these globs
  --symbols "a,b,C.m"   Filter to specific symbol names (exact or Class.method)
  --format json|md       Output format (default: json)
  --max-files N          Max files to scan (default: 500; warns on truncation)
  --out PATH             Write output to file instead of stdout (atomic)
  --help, -h             Show this help

NOTES:
  - Always skips node_modules, dist, build, .git.
  - Glob patterns: supports *, **, ?, [...]; no brace expansions.
  - Uses TypeScript compiler API when available; falls back to regex.
`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the extractor with the given CLI options.
 * Returns the ExtractResult for programmatic use.
 */
export async function run(opts: CliOptions): Promise<ExtractResult> {
  const workdir = resolve(opts.workdir);

  if (!existsSync(workdir)) {
    console.error(`[extract-doc] workdir not found: ${workdir}`);
    process.exit(2);
  }

  const stat = statSync(workdir);
  if (!stat.isDirectory()) {
    console.error(`[extract-doc] workdir is not a directory: ${workdir}`);
    process.exit(2);
  }

  let files = walkDir(workdir, workdir, opts.include, opts.exclude);
  let truncated = false;

  if (files.length > opts.maxFiles) {
    console.error(
      `[extract-doc] WARNING: found ${files.length} files; truncating to --max-files ${opts.maxFiles}`
    );
    files = files.slice(0, opts.maxFiles);
    truncated = true;
  }

  const allItems: DocItem[] = [];
  for (const f of files) {
    allItems.push(...extractFromFile(f, workdir, opts.symbols));
  }

  const result: ExtractResult = {
    workdir,
    scannedFiles: files.length + (truncated ? 0 : 0),
    extractedSymbols: allItems.length,
    items: allItems,
  };

  const output =
    opts.format === "md"
      ? renderMarkdown(result)
      : JSON.stringify(result, null, 2);

  if (opts.out) {
    // Atomic write: write to a temp file then rename
    const tmpPath = join(opts.out + ".tmp." + process.pid);
    writeFileSync(tmpPath, output, "utf8");
    const { renameSync } = await import("fs");
    renameSync(tmpPath, opts.out);
    console.error(`[extract-doc] Written to ${opts.out}`);
  } else {
    process.stdout.write(output + "\n");
  }

  return result;
}

// Run when invoked directly (not imported)
const isMain =
  typeof process !== "undefined" &&
  (process.argv[1]?.endsWith("extract-doc.ts") ||
    process.argv[1]?.endsWith("extract-doc.js"));

if (isMain) {
  const opts = parseArgs(process.argv);
  run(opts).catch((err) => {
    console.error("[extract-doc] Fatal:", err);
    process.exit(1);
  });
}
