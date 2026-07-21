/**
 * /api/understand — Serve the Understand Anything knowledge graph
 *
 * GET /api/understand?resource=graph.json  → graph JSON (.ua/knowledge-graph.json)
 * GET /api/understand?resource=status      → graph metadata + freshness
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

const UA_DIR = path.join(process.cwd(), ".ua");

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource") || "status";

  try {
    if (resource === "graph.json") {
      const filePath = path.join(UA_DIR, "knowledge-graph.json");
      if (!(await fileExists(filePath))) {
        return NextResponse.json(
          { error: "Graph not built. Run `node scripts/understand/build-graph.mjs` first." },
          { status: 404 }
        );
      }
      const content = await readFile(filePath, "utf-8");
      return new NextResponse(content, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (resource === "status") {
      const graphPath = path.join(UA_DIR, "knowledge-graph.json");
      const exists = await fileExists(graphPath);

      let stats: {
        nodes?: number;
        edges?: number;
        languages?: string[];
        frameworks?: string[];
        builtAt?: string;
        builtAtCommit?: string;
      } = {};

      if (exists) {
        try {
          const content = await readFile(graphPath, "utf-8");
          const data = JSON.parse(content);
          stats = {
            nodes: data.nodes?.length,
            edges: data.edges?.length,
            languages: data.project?.languages,
            frameworks: data.project?.frameworks,
            builtAt: data.builtAt,
            builtAtCommit: data.builtAtCommit,
          };
        } catch {
          // ignore parse errors
        }
      }

      return NextResponse.json({
        built: exists,
        ...stats,
        uaDir: ".ua/",
      });
    }

    return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
  } catch (error) {
    console.error("[api/understand] error:", error);
    return NextResponse.json(
      { error: "Failed to read understand resource", details: String(error) },
      { status: 500 }
    );
  }
}
