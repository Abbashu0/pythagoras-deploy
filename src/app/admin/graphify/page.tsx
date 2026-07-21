"use client";

/**
 * /admin/graphify — Interactive Knowledge Graph Viewer
 *
 * Shows the project's knowledge graph in a force-directed visualization.
 *
 * Supports TWO graph sources (toggle in header):
 *   1. Graphify — AST-based, fast, structural (tree-sitter, no LLM)
 *   2. Understand Anything — semantic, deeper, with summaries
 *
 * Features:
 *   - D3.js force-directed graph
 *   - Filter by community (Graphify) or by layer (Understand Anything)
 *   - Search by node label/file
 *   - Click node → show details + connections
 *   - Show graph stats
 *   - Toggle between graph sources
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  RefreshCw,
  Search,
  Box,
  Link2,
  Layers,
  FileCode,
  AlertCircle,
  Info,
  GitBranch,
  Share2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ============================================================
// Types — normalized across both graph sources
// ============================================================

interface NormNode {
  id: string;
  label: string;
  type: string;
  source_file: string;
  source_location?: string;
  community: number;
  community_name?: string;
  metadata?: Record<string, unknown>;
  // D3 runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface NormLink {
  source: string | NormNode;
  target: string | NormNode;
  relation: string;
  confidence: string;
  source_file?: string;
  weight?: number;
}

interface NormGraph {
  nodes: NormNode[];
  links: NormLink[];
  built_at_commit?: string;
}

type GraphSource = "graphify" | "understand";

// ============================================================
// Source-specific fetchers
// ============================================================

async function fetchGraphify(): Promise<NormGraph> {
  // Try static file first (faster, no cold-start), then fall back to API
  let res: Response;
  try {
    res = await fetch("/graphs/graphify.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    res = await fetch("/api/graphify?resource=graph.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    nodes: (data.nodes || []).map((n: Record<string, unknown>) => ({
      id: n.id as string,
      label: n.label as string,
      type: ((n.metadata as Record<string, unknown> | undefined)?.kind as string) || (n.file_type as string) || "node",
      source_file: (n.source_file as string) || "",
      source_location: (n.source_location as string) || "",
      community: (n.community as number) || 0,
      community_name: n.community_name as string,
      metadata: n.metadata as Record<string, unknown>,
    })),
    links: (data.links || []).map((l: Record<string, unknown>) => ({
      source: l.source as string,
      target: l.target as string,
      relation: (l.relation as string) || "related",
      confidence: (l.confidence as string) || "EXTRACTED",
      source_file: l.source_file as string,
      weight: l.weight as number,
    })),
    built_at_commit: data.built_at_commit as string,
  };
}

async function fetchUnderstand(): Promise<NormGraph> {
  // Try static file first (faster, no cold-start), then fall back to API
  let res: Response;
  try {
    res = await fetch("/graphs/understand.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    res = await fetch("/api/understand?resource=graph.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  // Group by file path → community-like grouping
  const fileToCommunity = new Map<string, number>();
  let nextComm = 0;
  for (const n of data.nodes || []) {
    const dir = (n.filePath || "").split("/").slice(0, -1).join("/") || "root";
    if (!fileToCommunity.has(dir)) {
      fileToCommunity.set(dir, nextComm++);
    }
  }
  return {
    nodes: (data.nodes || []).map((n: Record<string, unknown>) => {
      const filePath = (n.filePath as string) || "";
      const dir = filePath.split("/").slice(0, -1).join("/") || "root";
      return {
        id: n.id as string,
        label: (n.name as string) || n.id,
        type: (n.type as string) || "node",
        source_file: filePath,
        source_location: n.lineRange ? `L${n.lineRange[0]}` : "",
        community: fileToCommunity.get(dir) || 0,
        community_name: dir,
        metadata: {
          kind: n.type,
          language: (n.tags as string[])?.[0] || "",
          complexity: n.complexity,
          summary: n.summary,
        },
      };
    }),
    links: (data.edges || []).map((e: Record<string, unknown>) => ({
      source: e.source as string,
      target: e.target as string,
      relation: (e.type as string) || "related",
      confidence: "EXTRACTED",
      weight: (e.weight as number) ?? 0.7,
    })),
    built_at_commit: data.builtAtCommit as string,
  };
}

async function fetchStatus(source: GraphSource): Promise<Record<string, unknown>> {
  const url = source === "graphify"
    ? "/api/graphify?resource=status"
    : "/api/understand?resource=status";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { built: false };
  return res.json();
}

// ============================================================
// Main Page
// ============================================================

export default function GraphifyPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [source, setSource] = useState<GraphSource>("understand");
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [graph, setGraph] = useState<NormGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<NormNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // ---- Fetch graph data ----
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const graphData = source === "graphify" ? fetchGraphify() : fetchUnderstand();
      const graph = await graphData;
      setGraph(graph);
      setStatus({
        built: true,
        nodes: graph.nodes.length,
        edges: graph.links.length,
      });
    } catch (e) {
      console.error(`[${source}] fetch failed:`, e);
      toast({
        title: "فشل تحميل الـ graph",
        description: source === "graphify"
          ? "شغّل `graphify . --code-only` في الـ terminal"
          : "شغّل `node scripts/understand/build-graph.mjs`",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [source, toast]);

  // ---- Fetch graph on mount + when source changes ----
  // (with delay to avoid memory spike during page transitions)
  useEffect(() => {
    setGraph(null);
    setSelectedNode(null);
    setSelectedCommunity(null);
    const timer = setTimeout(() => {
      void fetchData();
    }, 1500);
    return () => clearTimeout(timer);
  }, [source, fetchData]);

  // ---- Communities list ----
  const communities = useMemo(() => {
    if (!graph) return [];
    const map = new Map<number, { count: number; name: string }>();
    for (const node of graph.nodes) {
      const c = node.community;
      if (!map.has(c)) {
        map.set(c, { count: 0, name: node.community_name || `Community ${c}` });
      }
      map.get(c)!.count++;
    }
    return Array.from(map.entries())
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => b.count - a.count);
  }, [graph]);

  // ---- Filtered graph ----
  const filteredGraph = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const normSearch = search.trim().toLowerCase();

    let visibleNodes = graph.nodes;
    if (selectedCommunity !== null) {
      visibleNodes = visibleNodes.filter((n) => n.community === selectedCommunity);
    }
    if (normSearch) {
      visibleNodes = visibleNodes.filter((n) =>
        n.label.toLowerCase().includes(normSearch) ||
        n.source_file.toLowerCase().includes(normSearch)
      );
    }

    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    let visibleLinks = graph.links.filter(
      (l) =>
        visibleIds.has(typeof l.source === "string" ? l.source : l.source.id) &&
        visibleIds.has(typeof l.target === "string" ? l.target : l.target.id)
    );

    if (visibleNodes.length > 100) {
      visibleNodes = visibleNodes.slice(0, 100);
      const newIds = new Set(visibleNodes.map((n) => n.id));
      visibleLinks = visibleLinks.filter(
        (l) =>
          newIds.has(typeof l.source === "string" ? l.source : l.source.id) &&
          newIds.has(typeof l.target === "string" ? l.target : l.target.id)
      );
    }

    return { nodes: visibleNodes, links: visibleLinks };
  }, [graph, search, selectedCommunity]);

  // ---- D3 force simulation ----
  useEffect(() => {
    if (!filteredGraph.nodes.length || !svgRef.current) return;
    const svgEl = svgRef.current;

    void (async () => {
      const d3 = await import("d3");
      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();

      const width = svgEl.clientWidth;
      const height = svgEl.clientHeight;

      const color = d3.scaleOrdinal(d3.schemeCategory10);

      const nodes = filteredGraph.nodes.map((n) => ({ ...n }));
      const links = filteredGraph.links.map((l) => ({
        ...l,
        source: typeof l.source === "string" ? l.source : l.source.id,
        target: typeof l.target === "string" ? l.target : l.target.id,
      }));

      // Use any-typed simulation to avoid D3's strict generic friction
      // (the runtime behavior is correct; the types just don't flow through)
      const sim: any = d3
        .forceSimulation(nodes as any)
        .force(
          "link",
          d3
            .forceLink(links as any)
            .id((d: any) => d.id)
            .distance(50)
            .strength(0.3)
        )
        .force("charge", d3.forceManyBody().strength(-80))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(8));

      const link = svg
        .append("g")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.3)
        .selectAll("line")
        .data(links as any[])
        .join("line")
        .attr("stroke-width", 0.5);

      // Color by node type for Understand Anything, community for Graphify
      const isUnderstand = source === "understand";
      const typeColors: Record<string, string> = {
        file: "#3b82f6",
        function: "#10b981",
        class: "#a855f7",
        module: "#f59e0b",
        service: "#ef4444",
        endpoint: "#06b6d4",
        config: "#64748b",
      };

      const node = svg
        .append("g")
        .selectAll("circle")
        .data(nodes as any[])
        .join("circle")
        .attr("r", 4)
        .attr("fill", (d: any) =>
          isUnderstand
            ? typeColors[d.type] || "#64748b"
            : color(d.community)
        )
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer")
        .on("click", (_event: any, d: any) => setSelectedNode(d as NormNode))
        .on("mouseover", (function (this: SVGCircleElement, _event: any) {
          d3.select(this).attr("r", 7).attr("stroke-width", 2);
        }) as any)
        .on("mouseout", (function (this: SVGCircleElement, _event: any) {
          d3.select(this).attr("r", 4).attr("stroke-width", 0.5);
        }) as any);

      const label = svg
        .append("g")
        .selectAll("text")
        .data(nodes as any[])
        .join("text")
        .text((d: any) => d.label)
        .attr("font-size", 8)
        .attr("fill", "#666")
        .attr("dx", 6)
        .attr("dy", 2)
        .style("pointer-events", "none")
        .style("opacity", 0);

      node.append("title").text((d: any) => `${d.label}\n${d.source_file}`);

      sim.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x ?? 0)
          .attr("y1", (d: any) => d.source.y ?? 0)
          .attr("x2", (d: any) => d.target.x ?? 0)
          .attr("y2", (d: any) => d.target.y ?? 0);
        node.attr("cx", (d: any) => d.x ?? 0).attr("cy", (d: any) => d.y ?? 0);
        label.attr("x", (d: any) => d.x ?? 0).attr("y", (d: any) => d.y ?? 0);
      });

      const zoom = d3
        .zoom()
        .scaleExtent([0.1, 10])
        .on("zoom", (event: any) => {
          svg.selectAll("g").attr("transform", event.transform);
        });
      svg.call(zoom as any);

      return () => {
        sim.stop();
      };
    })();
  }, [filteredGraph, source]);

  // ---- Selected node connections ----
  const selectedNodeConnections = useMemo(() => {
    if (!graph || !selectedNode) return [];
    const conn: Array<{ node: NormNode; relation: string; direction: "in" | "out" }> = [];
    for (const link of graph.links) {
      const srcId = typeof link.source === "string" ? link.source : link.source.id;
      const tgtId = typeof link.target === "string" ? link.target : link.target.id;
      if (srcId === selectedNode.id) {
        const target = graph.nodes.find((n) => n.id === tgtId);
        if (target) conn.push({ node: target, relation: link.relation, direction: "out" });
      } else if (tgtId === selectedNode.id) {
        const source = graph.nodes.find((n) => n.id === srcId);
        if (source) conn.push({ node: source, relation: link.relation, direction: "in" });
      }
    }
    return conn.slice(0, 50);
  }, [graph, selectedNode]);

  const stats = {
    nodes: status?.nodes as number | undefined,
    edges: status?.edges as number | undefined,
    communities: status?.communities as number | undefined,
    built: status?.built as boolean | undefined,
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
            className="gap-1 text-xs"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            رجوع
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              Knowledge Graph Explorer
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {stats.built
                ? `${stats.nodes ?? 0} nodes · ${stats.edges ?? 0} edges${stats.communities ? ` · ${stats.communities} communities` : ""}`
                : "Graph غير مبني"}
            </p>
          </div>
        </div>

        {/* Source toggle */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setSource("graphify")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
                source === "graphify"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Graphify — AST-based structural graph (fast, no LLM)"
            >
              <Share2 className="h-3 w-3" />
              Graphify
            </button>
            <button
              onClick={() => setSource("understand")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
                source === "understand"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Understand Anything — Semantic graph with summaries"
            >
              <Sparkles className="h-3 w-3" />
              Understand Anything
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchData()}
            disabled={loading}
            className="gap-1 text-xs"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            تحديث
          </Button>
        </div>
      </header>

      {/* Source info banner */}
      <div className="border-b border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
        {source === "graphify" ? (
          <span className="flex items-center gap-2">
            <Share2 className="h-3 w-3" />
            <strong>Graphify</strong> — تحليل بنيوي بـ tree-sitter AST (سريع، بدون LLM). يكتسب calls/imports/defines عبر ~40 لغة.
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Sparkles className="h-3 w-3" />
            <strong>Understand Anything</strong> — تحليل دلالي مع شروحات لكل node (functions, classes, files). الألوان حسب نوع الـ node.
          </span>
        )}
      </div>

      {/* Body — 3 columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="hidden w-64 flex-col border-l border-border bg-card/40 md:flex">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث في الـ nodes…"
                className="h-8 pr-7 text-xs"
                dir="rtl"
              />
            </div>
          </div>

          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {source === "graphify" ? "المجتمعات" : "المجلدات"}
              </span>
              {selectedCommunity !== null && (
                <button
                  onClick={() => setSelectedCommunity(null)}
                  className="text-[10px] text-primary hover:underline"
                >
                  مسح الفلتر
                </button>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {communities.slice(0, 30).map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    setSelectedCommunity(selectedCommunity === c.id ? null : c.id)
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1 text-[11px] transition-colors",
                    selectedCommunity === c.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/50"
                  )}
                >
                  <span className="truncate" title={c.name}>
                    {c.name}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {c.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="p-3">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              دليل الألوان
            </span>
            {source === "understand" ? (
              <div className="space-y-1 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
                  <span>File</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#10b981" }} />
                  <span>Function</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#a855f7" }} />
                  <span>Class</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#06b6d4" }} />
                  <span>Endpoint / Service</span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                كل لون = community مختلفة. كل node = مفهوم في الكود. كل edge = علاقة (calls, imports, defines, references).
              </p>
            )}
          </div>
        </aside>

        {/* Center: graph */}
        <div className="relative flex-1 bg-muted/10">
          {loading ? (
            <div className="grid h-full place-items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">جارٍ تحميل الـ graph…</p>
            </div>
          ) : !graph ? (
            <div className="grid h-full place-items-center gap-4 p-8 text-center">
              <div className="space-y-3">
                <Layers className="mx-auto h-12 w-12 text-muted-foreground/30" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {source === "graphify" ? "Graphify" : "Understand Anything"}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {source === "graphify"
                      ? "تحليل بنيوي بـ tree-sitter AST — 1400+ nodes"
                      : "تحليل دلالي مع شروحات لكل node — 990 nodes"}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => void fetchData()}
                  className="gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  تحميل الـ Graph
                </Button>
                <p className="text-[10px] text-muted-foreground/70">
                  سيتم تحميل ومعالجة البيانات في المتصفح
                </p>
              </div>
            </div>
          ) : (
            <>
              <svg
                ref={svgRef}
                className="h-full w-full"
                style={{ cursor: "grab" }}
              />
              <div className="absolute right-3 top-3 rounded-lg border border-border bg-background/90 px-3 py-1.5 text-[11px] backdrop-blur">
                <span className="font-mono tabular-nums">
                  {filteredGraph.nodes.length}
                </span>{" "}
                nodes ·{" "}
                <span className="font-mono tabular-nums">
                  {filteredGraph.links.length}
                </span>{" "}
                links
                {filteredGraph.nodes.length === 100 && (
                  <span className="mr-2 text-amber-600">
                    (محدود بـ 100 — استخدم الفلتر لتضييق النطاق)
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right sidebar: node details */}
        <aside className="hidden w-80 flex-col border-r border-border bg-card/40 lg:flex">
          <div className="border-b border-border px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Info className="h-4 w-4 text-primary" />
              تفاصيل الـ Node
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedNode ? (
              <div className="grid place-items-center gap-2 py-12 text-center text-xs text-muted-foreground">
                <Box className="h-8 w-8 text-muted-foreground/30" />
                <p>اضغط على أي node في الـ graph لعرض تفاصيله</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    الاسم
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-foreground">
                    {selectedNode.label}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    النوع
                  </div>
                  <div className="mt-0.5 text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {selectedNode.type}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    الملف المصدر
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <FileCode className="h-3 w-3 text-muted-foreground" />
                    <code className="font-mono text-foreground break-all">
                      {selectedNode.source_file || "—"}
                    </code>
                  </div>
                  {selectedNode.source_location && (
                    <div className="text-[10px] text-muted-foreground">
                      {selectedNode.source_location}
                    </div>
                  )}
                </div>

                {/* Summary (Understand Anything) */}
                {Boolean(selectedNode.metadata?.summary) && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      الشرح
                    </div>
                    <div className="mt-0.5 rounded-md border border-border bg-muted/30 p-2 text-xs leading-relaxed">
                      {String((selectedNode.metadata as any).summary || "")}
                    </div>
                  </div>
                )}

                {/* Metadata */}
                {selectedNode.metadata && (
                  <div className="grid grid-cols-2 gap-3">
                    {(selectedNode.metadata as any).language && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          اللغة
                        </div>
                        <div className="mt-0.5 text-xs">
                          {String((selectedNode.metadata as any).language)}
                        </div>
                      </div>
                    )}
                    {(selectedNode.metadata as any).complexity && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          التعقيد
                        </div>
                        <div className="mt-0.5 text-xs">
                          {String((selectedNode.metadata as any).complexity)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {source === "graphify" ? "Community" : "المجلد"}
                  </div>
                  <div className="mt-0.5 text-xs">
                    #{selectedNode.community} ·{" "}
                    <span className="text-muted-foreground">
                      {selectedNode.community_name || "—"}
                    </span>
                  </div>
                </div>

                {/* Connections */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <Link2 className="h-3 w-3" />
                    الاتصالات ({selectedNodeConnections.length})
                  </div>
                  {selectedNodeConnections.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      لا توجد اتصالات.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {selectedNodeConnections.map((conn, idx) => (
                        <li
                          key={idx}
                          className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded px-1 py-0.5 text-[9px] font-bold",
                                conn.direction === "out"
                                  ? "bg-blue-500/10 text-blue-600"
                                  : "bg-emerald-500/10 text-emerald-600"
                              )}
                            >
                              {conn.direction === "out" ? "→" : "←"}
                            </span>
                            <code className="font-mono text-foreground break-all">
                              {conn.node.label}
                            </code>
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {conn.relation}
                            {conn.node.source_file && (
                              <span className="mr-1">· {conn.node.source_file}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
