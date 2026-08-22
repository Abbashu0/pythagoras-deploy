"use client";

import { useCallback, useEffect, useState } from "react";
import { ImagePlus, Loader2, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AssetBrowser, AssetBrowserEmpty } from "./AssetBrowser";
import { AssetUploadDialog } from "./AssetUploadDialog";
import {
  handleExpiredSession,
  parseApiResponse,
  type LibraryAsset,
} from "./library-types";

interface BrowseResponse {
  ok: true;
  items: LibraryAsset[];
  total: number;
}

export function AssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: LibraryAsset) => void;
}) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          mediaKind: "image",
          limit: "24",
          offset: String(offset),
          sort: "newest",
        });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/admin/assets?${params}`, {
          cache: "no-store",
        });
        const body = await parseApiResponse<BrowseResponse>(response);
        setAssets((current) =>
          offset === 0 ? body.items : [...current, ...body.items],
        );
        setTotal(body.total);
      } catch (cause) {
        if (!handleExpiredSession(cause))
          setError(
            cause instanceof Error ? cause.message : "تعذر تحميل الصور.",
          );
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    if (open) void load(0);
  }, [open, load]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
        className="max-h-[88vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-5xl"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle>اختيار صورة من مكتبة المحتوى</DialogTitle>
            <DialogDescription>
              الصور هنا محفوظة في التخزين الدائم ويمكن إعادة استخدامها دون نسخ
              الملف.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-xl border bg-background pr-10 pl-3 text-sm"
                placeholder="ابحث عن صورة"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="ml-2 h-4 w-4" />
              رفع صورة
            </Button>
          </div>
          {error ? (
            <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="grid min-h-64 place-items-center">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : assets.length ? (
            <AssetBrowser
              assets={assets}
              view="grid"
              onSelectAsset={(asset) => {
                onSelect(asset);
                onOpenChange(false);
              }}
            />
          ) : (
            <AssetBrowserEmpty filtered={Boolean(query.trim())} />
          )}
          <span className="sr-only">قائمة الصور</span>
          {assets.length < total && !loading ? (
            <Button
              type="button"
              variant="outline"
              className="mx-auto"
              onClick={() => void load(assets.length)}
            >
              تحميل المزيد
            </Button>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImagePlus className="h-4 w-4" />
            لا تُنسخ الصورة داخل السجل؛ يُحفظ Asset ID فقط.
          </div>
        </DialogContent>
      </Dialog>
      <AssetUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCompleted={() => void load(0)}
      />
    </>
  );
}
