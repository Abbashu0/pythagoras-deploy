"use client";

/**
 * /admin/graphify — Interactive Graphify Viewer
 *
 * Shows the project's knowledge graph in a force-directed visualization.
 *
 * Features:
 *   - D3.js force-directed graph (lightweight, no external deps beyond d3)
 *   - Filter by community
 *   - Search by node label
 *   - Click node → show details (file, type, connections)
 *   - Show graph stats (nodes, edges, communities)
 *   - Show freshness (last built commit vs current HEAD)
 *   - Button to refresh the graph
 *
 * Data source: /api/graphify?resource=graph.json
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  RefreshCw,
  Search,
  Activity,
  Box,
  Link2,
  Layers,
  FileCode,
  AlertCircle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface GraphNode {
  id: string;
  label: string;
  file_type: string;
  source_file: string;
  source_location: string;
  community: number;
  community_name?: string;
  metadata?: Record<string, unknown>;
  // D3 will add x, y, vx, vy
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
  confidence: string;
  source_file: string;
  weight?: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  built_at_commit?: string;
}

interface GraphStatus {
  built: boolean;
  graphExists: boolean;
  reportExists: boolean;
  htmlExists: boolean;
  nodes?: number;
  edges?: number;
  communities?: number;
  graphifyDir: string;
}

export default function GraphifyPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // ---- Fetch status ----
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/graphify?resource=status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.error("[graphify] status fetch failed:", e);
    }
  }, []);

  // ---- Fetch graph ----
  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/graphify?resource=graph.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setGraph(data);
      } else {
        toast({
          title: "الـ graph غير مبني",
          description: "شغّل `graphify . --code-only` في الـ terminal.",
          variant: "destructive",
        });
      }
    } catch (e) {
      console.error("[graphify] graph fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchStatus();
    void fetchGraph();
  }, [fetchStatus, fetchGraph]);

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

  // ---- Filtered graph (by search + community) ----
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

    // Limit to top 300 nodes for performance
    if (visibleNodes.length > 300) {
      visibleNodes = visibleNodes.slice(0, 300);
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

    // Dynamic import to keep D3 out of the SSR bundle
    void (async () => {
      const d3 = await import("d3");
      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();

      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight;

      // Color scale by community
      const color = d3.scaleOrdinal(d3.schemeCategory10);

      // Clone to avoid mutating state
      const nodes = filteredGraph.nodes.map((n) => ({ ...n }));
      const links = filteredGraph.links.map((l) => ({
        ...l,
        source: typeof l.source === "string" ? l.source : l.source.id,
        target: typeof l.target === "string" ? l.target : l.target.id,
      }));

      const simulation = d3
        .forceSimulation(nodes as never)
        .force(
          "link",
          d3
            .forceLink(links as never)
            .id((d: never) => (d as GraphNode).id)
            .distance(50)
            .strength(0.3)
        )
        .force("charge", d3.forceManyBody().strength(-80))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(8));

      // Links
      const link = svg
        .append("g")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.3)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke-width", 0.5);

      // Nodes
      const node = svg
        .append("g")
        .selectAll<SVGCircleElement, GraphNode>("circle")
        .data(nodes)
        .join("circle")
        .attr("r", 4)
        .attr("fill", (d) => color(d.community))
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer")
        .on("click", (_event, d) => setSelectedNode(d))
        .on("mouseover", function () {
          d3.select(this).attr("r", 7).attr("stroke-width", 2);
        })
        .on("mouseout", function () {
          d3.select(this).attr("r", 4).attr("stroke-width", 0.5);
        });

      // Labels (only show for high-degree nodes to avoid clutter)
      const label = svg
        .append("g")
        .selectAll<SVGTextElement, GraphNode>("text")
        .data(nodes)
        .join("text")
        .text((d) => d.label)
        .attr("font-size", 8)
        .attr("fill", "#666")
        .attr("dx", 6)
        .attr("dy", 2)
        .style("pointer-events", "none")
        .style("opacity", 0);

      node.append("title").text((d) => `${d.label}\n${d.source_file}`);

      simulation.on("tick", () => {
        link
          .attr("x1", (d: never) => (d.source as GraphNode).x ?? 0)
          .attr("y1", (d: never) => (d.source as GraphNode).y ?? 0)
          .attr("x2", (d: never) => (d.target as GraphNode).x ?? 0)
          .attr("y2", (d: never) => (d.target as GraphNode).y ?? 0);
        node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
      });

      // Zoom/pan
      const zoom = d3
        .zoom()
        .scaleExtent([0.1, 10])
        .on("zoom", (event) => {
          svg.selectAll("g").attr("transform", event.transform);
        });
      svg.call(zoom as never);

      return () => {
        simulation.stop();
      };
    })();
  }, [filteredGraph]);

  // ---- Selected node connections ----
  const selectedNodeConnections = useMemo(() => {
    if (!graph || !selectedNode) return [];
    const conn: Array<{ node: GraphNode; relation: string; direction: "in" | "out" }> = [];
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

  // ---- Render ----
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
              Graphify — Knowledge Graph
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {status?.built
                ? `${status.nodes ?? 0} nodes · ${status.edges ?? 0} edges · ${status.communities ?? 0} communities`
                : "Graph غير مبني"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void fetchStatus();
              void fetchGraph();
            }}
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

      {/* Body — 3 columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: search + communities */}
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
                المجتمعات
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
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-[11px] transition-colors ${
                    selectedCommunity === c.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <span className="truncate">{c.name}</span>
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
            <p className="text-[10px] text-muted-foreground">
              كل لون = community مختلفة. كل node = مفهوم في الكود (function, class, file).
              كل edge = علاقة (calls, imports, defines, references).
            </p>
          </div>
        </aside>

        {/* Center: graph visualization */}
        <div className="relative flex-1 bg-muted/10">
          {loading ? (
            <div className="grid h-full place-items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">جارٍ تحميل الـ graph…</p>
            </div>
          ) : !graph ? (
            <div className="grid h-full place-items-center gap-3 p-8 text-center">
              <AlertCircle className="h-12 w-12 text-destructive/30" />
              <div>
                <h3 className="text-sm font-semibold">الـ graph غير مبني</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  شغّل هذا الأمر في الـ terminal:
                  <code className="mt-2 block rounded bg-muted p-2 text-[11px]">
                    graphify . --code-only
                  </code>
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
              {/* Visible nodes info overlay */}
              <div className="absolute right-3 top-3 rounded-lg border border-border bg-background/90 px-3 py-1.5 text-[11px] backdrop-blur">
                <span className="font-mono tabular-nums">
                  {filteredGraph.nodes.length}
                </span>{" "}
                nodes ·{" "}
                <span className="font-mono tabular-nums">
                  {filteredGraph.links.length}
                </span>{" "}
                links
                {filteredGraph.nodes.length === 300 && (
                  <span className="mr-2 text-amber-600">
                    (محدود بـ 300 للعرض)
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right sidebar: selected node details */}
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
                {/* Node identity */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    الاسم
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-foreground">
                    {selectedNode.label}
                  </div>
                </div>

                {/* File */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    الملف المصدر
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <FileCode className="h-3 w-3 text-muted-foreground" />
                    <code className="font-mono text-foreground">
                      {selectedNode.source_file}
                    </code>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {selectedNode.source_location}
                  </div>
                </div>

                {/* Type */}
                {selectedNode.metadata && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        النوع
                      </div>
                      <div className="mt-0.5 text-xs">
                        {String(selectedNode.metadata.kind || "—")}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        اللغة
                      </div>
                      <div className="mt-0.5 text-xs">
                        {String(selectedNode.metadata.language || "—")}
                      </div>
                    </div>
                  </div>
                )}

                {/* Community */}
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Community
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
                              className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                                conn.direction === "out"
                                  ? "bg-blue-500/10 text-blue-600"
                                  : "bg-emerald-500/10 text-emerald-600"
                              }`}
                            >
                              {conn.direction === "out" ? "→" : "←"}
                            </span>
                            <code className="font-mono text-foreground">
                              {conn.node.label}
                            </code>
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {conn.relation} · {conn.node.source_file}
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
