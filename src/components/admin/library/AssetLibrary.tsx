"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Database,
  FileAudio,
  FileVideo,
  Grid2X2,
  HardDrive,
  ImageIcon,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { AssetBrowser, AssetBrowserEmpty } from "./AssetBrowser";
import { AssetDetailsDialog } from "./AssetDetailsDialog";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format";
import {
  handleExpiredSession,
  MEDIA_KIND_LABELS,
  parseApiResponse,
  SORT_LABELS,
  type AssetPageResponse,
  type AssetStatsResponse,
  type LibraryAsset,
  type LibraryMediaKind,
  type LibrarySort,
  type LibraryStats,
} from "./library-types";

const PAGE_SIZE = 24;

export function AssetLibrary() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [mediaKind, setMediaKind] = useState<LibraryMediaKind | "all">("all");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<LibraryAsset | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.normalize("NFKC").trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const buildListUrl = useCallback((offset: number) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort,
    });
    if (query) params.set("q", query);
    if (mediaKind !== "all") params.set("mediaKind", mediaKind);
    return `/api/admin/assets?${params.toString()}`;
  }, [mediaKind, query, sort]);

  const loadInitial = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const body = await fetch(buildListUrl(0), { signal: controller.signal }).then((response) => parseApiResponse<AssetPageResponse>(response));
      if (generation !== generationRef.current) return;
      setAssets(body.items);
      setTotal(body.total);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      if (handleExpiredSession(requestError)) return;
      setAssets([]);
      setTotal(0);
      setError(requestError instanceof Error ? requestError.message : "تعذّر تحميل مكتبة المحتوى.");
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [buildListUrl]);

  useEffect(() => {
    void loadInitial();
    return () => requestRef.current?.abort();
  }, [loadInitial, refreshVersion]);

  const loadStats = useCallback(async () => {
    try {
      const body = await fetch("/api/admin/assets/stats").then((response) => parseApiResponse<AssetStatsResponse>(response));
      setStats(body.stats);
    } catch (requestError) {
      if (!handleExpiredSession(requestError)) setStats(null);
    }
  }, []);

  useEffect(() => { void loadStats(); }, [loadStats, refreshVersion]);

  const loadMore = async () => {
    if (loadingMore || assets.length >= total) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    try {
      const body = await fetch(buildListUrl(assets.length)).then((response) => parseApiResponse<AssetPageResponse>(response));
      if (generation !== generationRef.current) return;
      setAssets((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...body.items.filter((item) => !known.has(item.id))];
      });
      setTotal(body.total);
    } catch (requestError) {
      if (!handleExpiredSession(requestError)) {
        setError(requestError instanceof Error ? requestError.message : "تعذّر تحميل المزيد من الملفات.");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const hasFilters = Boolean(query) || mediaKind !== "all";
  const statsItems = [
    { label: "كل الملفات", value: stats?.totalCount ?? null, icon: Database },
    { label: "الصور", value: stats?.byMediaKind.image ?? null, icon: ImageIcon },
    { label: "الفيديو", value: stats?.byMediaKind.video ?? null, icon: FileVideo },
    { label: "الصوت", value: stats?.byMediaKind.audio ?? null, icon: FileAudio },
    { label: "حجم التخزين", value: stats ? formatBytes(stats.totalBytes) : null, icon: HardDrive },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8" dir="rtl">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">PYTHAGORAS CONTENT</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground sm:text-3xl">مكتبة المحتوى</h1>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">إدارة الملفات الدائمة المخزنة محليًا، وفحص معلوماتها وسلامتها قبل ربطها بمحتوى المنصة.</p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="h-10 flex-shrink-0"><Plus className="h-4 w-4" /> رفع ملفات</Button>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="ملخص مكتبة المحتوى">
        {statsItems.map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex min-h-20 items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
            <div className="min-w-0"><div className="truncate text-[10px] text-muted-foreground">{label}</div><div className="mt-1 truncate text-base font-black text-foreground">{value === null ? "—" : typeof value === "number" ? value.toLocaleString("ar-IQ") : value}</div></div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">البحث في مكتبة المحتوى</span>
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="ابحث باسم العرض أو اسم الملف الأصلي…"
              className="h-10 w-full rounded-xl border bg-background pr-10 pl-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              dir="auto"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={mediaKind} onValueChange={(value) => setMediaKind(value as LibraryMediaKind | "all")}>
              <SelectTrigger className="h-10 min-w-36 flex-1 sm:flex-none"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">كل الأنواع</SelectItem>
                {(Object.keys(MEDIA_KIND_LABELS) as LibraryMediaKind[]).map((kind) => <SelectItem key={kind} value={kind}>{MEDIA_KIND_LABELS[kind]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as LibrarySort)}>
              <SelectTrigger className="h-10 min-w-36 flex-1 sm:flex-none"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">{(Object.keys(SORT_LABELS) as LibrarySort[]).map((option) => <SelectItem key={option} value={option}>{SORT_LABELS[option]}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex h-10 items-center rounded-xl border bg-background p-1" aria-label="طريقة العرض">
              <button type="button" onClick={() => setView("grid")} className={cn("grid h-8 w-8 place-items-center rounded-lg", view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")} aria-label="عرض شبكي" aria-pressed={view === "grid"}><Grid2X2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => setView("list")} className={cn("grid h-8 w-8 place-items-center rounded-lg", view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")} aria-label="عرض قائمة" aria-pressed={view === "list"}><List className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive sm:flex-row sm:items-center" role="alert">
          <span>{error}</span><Button variant="outline" size="sm" onClick={() => void loadInitial()}><RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة</Button>
        </div>
      )}

      {loading ? (
        <LibrarySkeleton view={view} />
      ) : assets.length === 0 ? (
        <AssetBrowserEmpty filtered={hasFilters} />
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>عرض {assets.length.toLocaleString("ar-IQ")} من {total.toLocaleString("ar-IQ")} ملف</span></div>
          <AssetBrowser assets={assets} view={view} onSelectAsset={setSelectedAsset} />
          {assets.length < total && (
            <div className="flex justify-center pt-2"><Button variant="outline" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{loadingMore ? "جارٍ التحميل…" : "تحميل المزيد"}</Button></div>
          )}
        </>
      )}

      <AssetUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCompleted={() => setRefreshVersion((version) => version + 1)} />
      <AssetDetailsDialog asset={selectedAsset} onOpenChange={(open) => !open && setSelectedAsset(null)} />
    </div>
  );
}

function LibrarySkeleton({ view }: { view: "grid" | "list" }) {
  if (view === "list") return <div className="space-y-2 rounded-2xl border bg-card p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="aspect-[4/3] w-full rounded-2xl" />)}</div>;
}
