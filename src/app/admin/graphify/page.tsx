"use client";

/**
 * /admin/graphify — Knowledge Graph Dashboard
 *
 * The graphs are hosted externally on GitHub Pages to avoid loading
 * the container. This page shows stats and links to the external viewers.
 *
 * Local graph files (graphify-out/ and .ua/) are kept for internal
 * workflow use (graphify query/explain/path commands) but are NOT
 * served by the app.
 *
 * GitHub Pages URLs:
 *   - Graphify: https://abbashu0.github.io/pythagoras-deploy/graphify.html
 *   - Understand Anything: https://abbashu0.github.io/pythagoras-deploy/understand-anything/
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ExternalLink,
  Share2,
  Sparkles,
  Box,
  Link2,
  Layers,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface GraphStats {
  built: boolean;
  nodes?: number;
  edges?: number;
  communities?: number;
  languages?: string[];
}

// GitHub Pages URLs (external hosting — no load on our server)
const GRAPHIFY_URL = "https://abbashu0.github.io/pythagoras-deploy/graphify.html";
const UNDERSTAND_URL = "https://abbashu0.github.io/pythagoras-deploy/understand-anything/";

export default function GraphifyPage() {
  const router = useRouter();

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
              مستضافة على GitHub Pages — لا تثقل الخادم
            </p>
          </div>
        </div>
      </header>

      {/* Info banner */}
      <div className="mb-6 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-xs">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">كيف يعمل هذا؟</p>
            <p className="text-muted-foreground">
              الـ graphs مستضافة على GitHub Pages لتفادي إثقال الخادم. تُحدّث تلقائياً
              بعد كل git commit (عبر post-commit hooks). اضغط على أي graph لفتحه في
              صفحة جديدة.
            </p>
          </div>
        </div>
      </div>

      {/* Graph cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Graphify card */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-blue-500/30 bg-blue-500/5 text-blue-600">
                  <Share2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Graphify</h3>
                  <p className="text-[11px] text-muted-foreground">
                    تحليل بنيوي — tree-sitter AST
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                ✓ جاهز
              </span>
            </div>

            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              يكتشف calls, imports, defines عبر ~40 لغة. سريع جداً، بدون LLM. الـ graph
              يكتشف communities تلقائياً (Leiden algorithm).
            </p>

            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="font-mono text-base font-bold tabular-nums text-foreground">
                  2,930
                </div>
                <div className="text-[10px] text-muted-foreground">nodes</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="font-mono text-base font-bold tabular-nums text-foreground">
                  7,438
                </div>
                <div className="text-[10px] text-muted-foreground">edges</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="font-mono text-base font-bold tabular-nums text-foreground">
                  201
                </div>
                <div className="text-[10px] text-muted-foreground">communities</div>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => window.open(GRAPHIFY_URL, "_blank")}
              className="w-full gap-1.5 text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              فتح العرض التفاعلي
            </Button>
          </CardContent>
        </Card>

        {/* Understand Anything card */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-purple-500/30 bg-purple-500/5 text-purple-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Understand Anything
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    تحليل دلالي — مع شروحات
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                ✓ جاهز
              </span>
            </div>

            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              يحلل functions, classes, imports مع شروحات لكل node. يدعم tour mode,
              language lessons, filter pills, و right sidebar.
            </p>

            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="font-mono text-base font-bold tabular-nums text-foreground">
                  530
                </div>
                <div className="text-[10px] text-muted-foreground">nodes</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="font-mono text-base font-bold tabular-nums text-foreground">
                  568
                </div>
                <div className="text-[10px] text-muted-foreground">edges</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="font-mono text-base font-bold tabular-nums text-foreground">
                  8
                </div>
                <div className="text-[10px] text-muted-foreground">languages</div>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => window.open(UNDERSTAND_URL, "_blank")}
              className="w-full gap-1.5 text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              فتح العرض التفاعلي
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Workflow section */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold text-foreground">دورة العمل</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  1
                </span>
                <Share2 className="h-4 w-4 text-primary" />
              </div>
              <h4 className="mb-1 text-xs font-bold text-foreground">قبل أي مهمة</h4>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                استخدم Graphify للبحث السريع وتحديد الملفات المرتبطة
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  2
                </span>
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <h4 className="mb-1 text-xs font-bold text-foreground">أثناء التنفيذ</h4>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                استخدم Understand Anything لشرح الملفات والدوال
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  3
                </span>
                <RefreshCw className="h-4 w-4 text-primary" />
              </div>
              <h4 className="mb-1 text-xs font-bold text-foreground">بعد الانتهاء</h4>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                git commit يحدّث كلا الـ graphs تلقائياً على GitHub Pages
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
