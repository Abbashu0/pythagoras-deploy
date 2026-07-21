"use client";

/**
 * /admin/graphify — Knowledge Graph Dashboard (simplified, stable version)
 *
 * Two graph sources supported:
 *   1. Graphify — AST-based, fast, structural
 *   2. Understand Anything — semantic, with summaries
 *
 * To avoid memory spikes and container crashes, this page is intentionally
 * lightweight: it shows stats + links to open each graph in its own page.
 *
 * The full interactive D3 viewer is still available at /admin/graphify/viewer
 * (lazy-loaded, only when user clicks "Open Interactive Viewer").
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ExternalLink,
  Share2,
  Sparkles,
  FileCode,
  Box,
  Link2,
  Layers,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface GraphStats {
  built: boolean;
  nodes?: number;
  edges?: number;
  communities?: number;
  languages?: string[];
  frameworks?: string[];
}

export default function GraphifyPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [graphifyStats, setGraphifyStats] = useState<GraphStats | null>(null);
  const [understandStats, setUnderstandStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch both statuses in parallel (lightweight API calls)
    Promise.all([
      fetch("/api/graphify?resource=status", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ built: false })),
      fetch("/api/understand?resource=status", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ built: false })),
    ]).then(([g, u]) => {
      setGraphifyStats(g);
      setUnderstandStats(u);
      setLoading(false);
    });
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between gap-4">
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
            <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Layers className="h-5 w-5 text-primary" />
              Knowledge Graph
            </h1>
            <p className="text-[11px] text-muted-foreground">
              بنية تحتية لفهم المشروع — محدّث تلقائياً بعد كل git commit
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.location.reload()}
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
      </header>

      {/* Info banner */}
      <div className="mb-6 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-xs">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">كيف يعمل هذا؟</p>
            <p className="text-muted-foreground">
              لدينا graphs اثنان يحلّلان المشروع تلقائياً بعد كل git commit:
              <strong> Graphify</strong> للتحليل البنيوي السريع (AST)،
              و <strong>Understand Anything</strong> للتحليل الدلالي مع شروحات.
              اضغط على أي graph لفتحه في عارض تفاعلي كامل.
            </p>
          </div>
        </div>
      </div>

      {/* Graph cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Graphify card */}
        <GraphCard
          title="Graphify"
          subtitle="تحليل بنيوي — tree-sitter AST"
          icon={<Share2 className="h-5 w-5" />}
          color="blue"
          stats={graphifyStats}
          loading={loading}
          onOpenViewer={() => window.open("/graphs/graphify-interactive.html", "_blank")}
          onOpenJson={() => window.open("/graphs/graphify.json", "_blank")}
          description="يكتشف calls, imports, defines عبر ~40 لغة. سريع جداً، بدون LLM. الـ graph يكتشف communities تلقائياً (Leiden algorithm)."
        />

        {/* Understand Anything card */}
        <GraphCard
          title="Understand Anything"
          subtitle="تحليل دلالي — مع شروحات"
          icon={<Sparkles className="h-5 w-5" />}
          color="purple"
          stats={understandStats}
          loading={loading}
          onOpenViewer={() => window.open("/understand-dashboard/?token=pythagoras-demo", "_blank")}
          onOpenJson={() => window.open("/graphs/understand.json", "_blank")}
          description="يحلل functions, classes, imports مع شروحات لكل node. الـ schema يدعم 27 نوع (file, function, class, service, endpoint, schema, ...) و 38 نوع edge."
        />
      </div>

      {/* Workflow section */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold text-foreground">دورة العمل</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <WorkflowStep
            number={1}
            title="قبل أي مهمة"
            description="استخدم Graphify للبحث السريع وتحديد الملفات المرتبطة"
            icon={<Share2 className="h-4 w-4" />}
          />
          <WorkflowStep
            number={2}
            title="أثناء التنفيذ"
            description="استخدم Understand Anything لشرح الملفات والدوال"
            icon={<Sparkles className="h-4 w-4" />}
          />
          <WorkflowStep
            number={3}
            title="بعد الانتهاء"
            description="git commit يحدّث كلا الـ graphs تلقائياً (post-commit hook)"
            icon={<RefreshCw className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* Stats summary */}
      {!loading && (graphifyStats?.built || understandStats?.built) && (
        <section className="mt-8">
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <Box className="h-4 w-4 text-primary" />
                إحصائيات الكود
              </h3>
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                <StatItem
                  label="Graphify nodes"
                  value={graphifyStats?.nodes?.toLocaleString() || "—"}
                />
                <StatItem
                  label="Understand nodes"
                  value={understandStats?.nodes?.toLocaleString() || "—"}
                />
                <StatItem
                  label="Understand edges"
                  value={understandStats?.edges?.toLocaleString() || "—"}
                />
                <StatItem
                  label="Languages"
                  value={understandStats?.languages?.length?.toString() || "—"}
                />
              </div>
              {understandStats?.languages && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {understandStats.languages.map((lang) => (
                    <span
                      key={lang}
                      className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono"
                    >
                      {lang}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface GraphCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: "blue" | "purple";
  stats: GraphStats | null;
  loading: boolean;
  onOpenViewer: () => void;
  onOpenJson: () => void;
  description: string;
}

function GraphCard({
  title,
  subtitle,
  icon,
  color,
  stats,
  loading,
  onOpenViewer,
  onOpenJson,
  description,
}: GraphCardProps) {
  const colorClasses = {
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-600",
    purple: "border-purple-500/30 bg-purple-500/5 text-purple-600",
  };

  return (
    <Card className={colorClasses[color]}>
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`grid h-10 w-10 place-items-center rounded-lg ${colorClasses[color]}`}>
              {icon}
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">{title}</h3>
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : stats?.built ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
              ✓ مبني
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              غير مبني
            </span>
          )}
        </div>

        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>

        {/* Stats */}
        {stats?.built && (
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-background/60 p-2">
              <div className="font-mono text-base font-bold tabular-nums text-foreground">
                {(stats.nodes || 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">nodes</div>
            </div>
            <div className="rounded-md bg-background/60 p-2">
              <div className="font-mono text-base font-bold tabular-nums text-foreground">
                {(stats.edges || 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">edges</div>
            </div>
            <div className="rounded-md bg-background/60 p-2">
              <div className="font-mono text-base font-bold tabular-nums text-foreground">
                {stats.communities || "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">communities</div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onOpenViewer}
            disabled={!stats?.built}
            className="flex-1 gap-1.5 text-xs"
          >
            <ExternalLink className="h-3 w-3" />
            فتح العارض التفاعلي
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenJson}
            disabled={!stats?.built}
            className="gap-1.5 text-xs"
          >
            <FileCode className="h-3 w-3" />
            JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowStep({
  number,
  title,
  description,
  icon,
}: {
  number: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
            {number}
          </span>
          <span className="text-primary">{icon}</span>
        </div>
        <h4 className="mb-1 text-xs font-bold text-foreground">{title}</h4>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}
