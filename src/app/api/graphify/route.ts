/**
 * /api/graphify — Serve the Graphify graph.json + GRAPH_REPORT.md
 *
 * GET /api/graphify?resource=graph.json     → graph JSON
 * GET /api/graphify?resource=report.md      → GRAPH_REPORT.md
 * GET /api/graphify?resource=status         → graph metadata + freshness
 *
 * Used by /admin/graphify page (interactive viewer).
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

const GRAPHIFY_DIR = path.join(process.cwd(), "graphify-out");

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
      const filePath = path.join(GRAPHIFY_DIR, "graph.json");
      if (!(await fileExists(filePath))) {
        return NextResponse.json(
          { error: "Graph not built. Run `graphify . --code-only` first." },
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

    if (resource === "report.md") {
      const filePath = path.join(GRAPHIFY_DIR, "GRAPH_REPORT.md");
      if (!(await fileExists(filePath))) {
        return NextResponse.json(
          { error: "Report not built." },
          { status: 404 }
        );
      }
      const content = await readFile(filePath, "utf-8");
      return new NextResponse(content, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (resource === "status") {
      const graphPath = path.join(GRAPHIFY_DIR, "graph.json");
      const reportPath = path.join(GRAPHIFY_DIR, "GRAPH_REPORT.md");
      const htmlPath = path.join(GRAPHIFY_DIR, "graph.html");

      const [graphExists, reportExists, htmlExists] = await Promise.all([
        fileExists(graphPath),
        fileExists(reportPath),
        fileExists(htmlPath),
      ]);

      let graphStats: { nodes?: number; edges?: number; communities?: number } = {};
      if (graphExists) {
        try {
          const content = await readFile(graphPath, "utf-8");
          const data = JSON.parse(content);
          graphStats = {
            nodes: data.nodes?.length,
            edges: data.edges?.length,
            communities: data.metadata?.communities,
          };
        } catch {
          // ignore parse errors
        }
      }

      return NextResponse.json({
        built: graphExists,
        graphExists,
        reportExists,
        htmlExists,
        ...graphStats,
        graphifyDir: "graphify-out/",
      });
    }

    return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
  } catch (error) {
    console.error("[api/graphify] error:", error);
    return NextResponse.json(
      { error: "Failed to read graphify resource", details: String(error) },
      { status: 500 }
    );
  }
}
