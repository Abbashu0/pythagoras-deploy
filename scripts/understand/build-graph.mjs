#!/usr/bin/env node
/**
 * build-understand-graph.mjs
 * ==========================
 * Build a knowledge graph in Understand Anything format (.ua/knowledge-graph.json)
 * using only regex-based AST extraction (no LLM, no tree-sitter WASM).
 *
 * Output schema: https://github.com/Egonex-AI/Understand-Anything
 *
 * Usage:
 *   node scripts/understand/build-graph.mjs           # full rebuild
 */

import { writeFileSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = process.argv[2] || process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, ".ua");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "knowledge-graph.json");

// ============================================================
// Ignore patterns
// ============================================================
const IGNORE_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "out", ".cache",
  "graphify-out", ".ua", ".understand-anything", "skills", "examples",
  "download", "upload", "tool-results", "agent-ctx", "mini-services",
  "prisma", "db", ".vercel", ".turbo",
]);

const IGNORE_EXTS = new Set([
  ".log", ".db", ".db-journal", ".env", ".swp", ".DS_Store",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".mp4", ".mp3", ".mov", ".wav", ".pdf", ".zip", ".tar", ".gz",
]);

// ============================================================
// Language detection
// ============================================================
const LANG_BY_EXT = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".scala": "scala",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".html": "html",
  ".css": "css",
  ".scss": "css",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
};

// Languages we can extract structure from
const STRUCTURED_LANGS = new Set([
  "typescript", "javascript", "python", "go", "rust", "java",
  "ruby", "php", "c", "cpp", "csharp", "scala", "lua",
]);

// ============================================================
// File walker
// ============================================================
async function* walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walk(fullPath, base);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (IGNORE_EXTS.has(ext)) continue;
      const relPath = path.relative(base, fullPath).replace(/\\/g, "/");
      yield { absPath: fullPath, relPath, ext };
    }
  }
}

// ============================================================
// Regex-based extractors per language
// ============================================================

/**
 * Extract structure from TS/JS source.
 * Detects: imports, exports, functions, classes, arrow functions.
 */
function extractJsStructure(source, filePath) {
  const ext = path.extname(filePath);
  const isJsx = ext === ".tsx" || ext === ".jsx";

  const imports = [];
  const exports_ = [];
  const functions = [];
  const classes = [];

  // Imports: import X from 'path' / import { a, b } from 'path' / import * as X from 'path'
  const importRegex = /^\s*import\s+(?:([^'";\n]+?)\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = importRegex.exec(source)) !== null) {
    const specifiers = (m[1] || "").trim();
    imports.push({
      source: m[2],
      specifiers: specifiers ? specifiers.split(",").map((s) => s.trim()) : [],
      lineNumber: source.slice(0, m.index).split("\n").length,
    });
  }

  // Exports: export { X } / export default X / export const X = ...
  const exportRegex = /^\s*export\s+(?:default\s+)?(?:const|let|var|function|class|async\s+function)?\s*([A-Za-z_$][\w$]*)/gm;
  while ((m = exportRegex.exec(source)) !== null) {
    exports_.push({
      name: m[1],
      lineNumber: source.slice(0, m.index).split("\n").length,
      isDefault: /default/.test(m[0]),
    });
  }

  // Functions: function name( / async function name( / const name = ( ... ) =>
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = funcRegex.exec(source)) !== null) {
    const line = source.slice(0, m.index).split("\n").length;
    functions.push({
      name: m[1],
      lineRange: [line, line + 10],
      params: [],
    });
  }

  // Arrow functions: const name = (...) => / const name = async (...) =>
  const arrowRegex = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
  while ((m = arrowRegex.exec(source)) !== null) {
    const line = source.slice(0, m.index).split("\n").length;
    functions.push({
      name: m[1],
      lineRange: [line, line + 5],
      params: m[2] ? m[2].split(",").map((p) => p.trim()).filter(Boolean) : [],
    });
  }

  // Classes: class Name { / class Name extends X {
  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?(?:\s+implements\s+([A-Za-z_$][\w$.]*))?/g;
  while ((m = classRegex.exec(source)) !== null) {
    const line = source.slice(0, m.index).split("\n").length;
    classes.push({
      name: m[1],
      lineRange: [line, line + 30],
      methods: [],
      properties: [],
    });
  }

  return { imports, exports: exports_, functions, classes };
}

function extractPythonStructure(source) {
  const imports = [];
  const functions = [];
  const classes = [];

  // Python imports
  const importRegex = /^\s*(?:from\s+([\w.]+)\s+import\s+(.+)|import\s+([\w.]+))/gm;
  let m;
  while ((m = importRegex.exec(source)) !== null) {
    imports.push({
      source: m[1] || m[3],
      specifiers: m[2] ? m[2].split(",").map((s) => s.trim()) : [],
      lineNumber: source.slice(0, m.index).split("\n").length,
    });
  }

  // Python functions
  const funcRegex = /^\s*def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm;
  while ((m = funcRegex.exec(source)) !== null) {
    const line = source.slice(0, m.index).split("\n").length;
    functions.push({
      name: m[1],
      lineRange: [line, line + 10],
      params: m[2] ? m[2].split(",").map((p) => p.trim()).filter(Boolean) : [],
    });
  }

  // Python classes
  const classRegex = /^\s*class\s+([A-Za-z_][\w]*)(?:\(([^)]*)\))?:/gm;
  while ((m = classRegex.exec(source)) !== null) {
    const line = source.slice(0, m.index).split("\n").length;
    classes.push({
      name: m[1],
      lineRange: [line, line + 20],
      methods: [],
      properties: [],
    });
  }

  return { imports, exports: [], functions, classes };
}

/**
 * Resolve an import path to a real file in the project.
 * e.g., "@/lib/utils" → "src/lib/utils.ts"
 */
function resolveImport(importSource, fromFile, allFiles) {
  if (!importSource) return null;

  // Skip external packages (no ./ or @/)
  if (!importSource.startsWith(".") && !importSource.startsWith("@/") && !importSource.startsWith("~/")) {
    return null;
  }

  // Normalize @/ and ~/ to src/
  let normalized = importSource;
  if (normalized.startsWith("@/")) normalized = "src/" + normalized.slice(2);
  else if (normalized.startsWith("~/")) normalized = normalized.slice(2);
  else if (normalized.startsWith("./")) normalized = path.join(path.dirname(fromFile), normalized.slice(2)).replace(/\\/g, "/");
  else if (normalized.startsWith("../")) normalized = path.join(path.dirname(fromFile), normalized).replace(/\\/g, "/");

  // Try with extensions
  const candidates = [
    normalized,
    normalized + ".ts",
    normalized + ".tsx",
    normalized + ".js",
    normalized + ".jsx",
    normalized + ".mjs",
    normalized + "/index.ts",
    normalized + "/index.tsx",
    normalized + "/index.js",
    normalized + "/index.jsx",
  ];

  for (const c of candidates) {
    if (allFiles.has(c.replace(/\\/g, "/"))) return c.replace(/\\/g, "/");
  }
  return null;
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`[understand] Building graph for: ${PROJECT_ROOT}`);
  const startTime = Date.now();

  let gitHash = "unknown";
  try {
    gitHash = execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim().slice(0, 8);
  } catch {}

  let projectName = path.basename(PROJECT_ROOT);
  try {
    const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
    projectName = pkg.name || projectName;
  } catch {}

  console.log(`[understand] Project: ${projectName} @ ${gitHash}`);

  // Collect all files
  const files = [];
  for await (const { absPath, relPath, ext } of walk(PROJECT_ROOT)) {
    const lang = LANG_BY_EXT[ext];
    if (!lang) continue;
    files.push({ absPath, relPath, lang, ext });
  }

  console.log(`[understand] Found ${files.length} code files`);

  // First pass: index all file paths
  const allFilesSet = new Set(files.map((f) => f.relPath));

  const nodes = [];
  const edges = [];
  const languages = new Set();
  const edgeKeys = new Set();

  const addEdge = (source, target, type, direction = "forward", weight = 0.7) => {
    const key = `${type}|${source}|${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, type, direction, weight });
  };

  // Process each file
  let processed = 0;
  for (const { absPath, relPath, lang } of files) {
    languages.add(lang);
    const fileId = `file:${relPath}`;
    const fileName = path.basename(relPath);

    let source = "";
    try {
      source = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    // Add file node
    nodes.push({
      id: fileId,
      type: "file",
      name: fileName,
      filePath: relPath,
      summary: `${lang} file: ${fileName}`,
      tags: [lang],
      complexity: source.split("\n").length > 200 ? "complex" : source.split("\n").length > 50 ? "moderate" : "simple",
    });

    // Extract structure for supported languages
    if (STRUCTURED_LANGS.has(lang)) {
      let structure;
      try {
        if (lang === "python") structure = extractPythonStructure(source);
        else structure = extractJsStructure(source, relPath);
      } catch {
        structure = { imports: [], exports: [], functions: [], classes: [] };
      }

      // Add function nodes + contains edges
      for (const fn of structure.functions) {
        const funcId = `function:${relPath}:${fn.name}`;
        nodes.push({
          id: funcId,
          type: "function",
          name: fn.name,
          filePath: relPath,
          lineRange: fn.lineRange,
          summary: `Function ${fn.name}() in ${fileName}`,
          tags: [lang],
          complexity: "simple",
        });
        addEdge(fileId, funcId, "contains", "forward", 1.0);
      }

      // Add class nodes + contains edges
      for (const cls of structure.classes) {
        const classId = `class:${relPath}:${cls.name}`;
        nodes.push({
          id: classId,
          type: "class",
          name: cls.name,
          filePath: relPath,
          lineRange: cls.lineRange,
          summary: `Class ${cls.name} in ${fileName}`,
          tags: [lang],
          complexity: "moderate",
        });
        addEdge(fileId, classId, "contains", "forward", 1.0);
      }

      // Add import edges (resolve to actual files)
      for (const imp of structure.imports) {
        const resolvedPath = resolveImport(imp.source, relPath, allFilesSet);
        if (resolvedPath) {
          addEdge(fileId, `file:${resolvedPath}`, "imports", "forward", 0.7);
        }
      }
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`[understand] Processed ${processed}/${files.length} files...`);
    }
  }

  console.log(`[understand] Processed: ${processed}`);
  console.log(`[understand] Nodes: ${nodes.length}, Edges: ${edges.length}`);

  // Build graph object
  const graph = {
    version: "1.0.0",
    kind: "code",
    project: {
      name: projectName,
      languages: Array.from(languages).sort(),
      frameworks: ["Next.js", "React", "Tailwind CSS", "Prisma"].filter((f) => {
        try {
          const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          const key = f.toLowerCase().replace(/[\s-]/g, "");
          return Object.keys(deps).some((d) => d.toLowerCase().includes(key));
        } catch {
          return false;
        }
      }),
    },
    nodes,
    edges,
    layers: [],
    tour: [],
    builtAt: new Date().toISOString(),
    builtAtCommit: gitHash,
  };

  // Write output
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(graph, null, 2));

  console.log(`[understand] Wrote ${OUTPUT_FILE}`);
  console.log(`[understand] File size: ${(statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
  console.log(`[understand] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("[understand] FATAL:", err);
  process.exit(1);
});
