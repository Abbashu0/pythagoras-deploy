"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePenLine, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewApi } from "@/components/admin/review/types";
import type { LibraryAsset } from "./library-types";

export function AssetProposalDialog({ asset, open, onOpenChange }: { asset: LibraryAsset; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [displayName, setDisplayName] = useState(asset.displayName);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => { if (open) { setDisplayName(asset.displayName); setDescription(""); setError(null); setCreatedId(null); } }, [asset.displayName, open]);

  const create = async (submit: boolean) => {
    setBusy(true); setError(null);
    try {
      const body = await reviewApi<{ changeSet: { changeSet: { id: string } } }>("/api/admin/change-sets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `تعديل اسم الأصل: ${asset.displayName}`, description, submit, initialItem: { resourceType: "asset.metadata", resourceId: asset.id, expectedRevision: asset.revision, desired: { displayName } } }),
      });
      setCreatedId(body.changeSet.changeSet.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء المقترح."); }
    finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent dir="rtl"><DialogHeader className="text-right"><DialogTitle className="flex items-center gap-2"><FilePenLine className="h-5 w-5 text-primary" />اقتراح تعديل بيانات الأصل</DialogTitle><DialogDescription>لن يتغير الأصل الآن. سيُحفظ المقترح كمسودة، ولا يصل إلى البيانات المنشورة إلا بعد مراجعة OWNER ونشره.</DialogDescription></DialogHeader>{createdId ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"><p className="text-sm font-bold text-emerald-600">تم إنشاء المقترح بنجاح</p><Button asChild className="mt-4 w-full"><Link href={`/admin/review`}>فتح مساحة المراجعة</Link></Button></div> : <><div className="space-y-4"><div className="space-y-2"><Label htmlFor="proposal-name">اسم العرض المقترح</Label><Input id="proposal-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={200} dir="auto" /></div><div className="space-y-2"><Label htmlFor="proposal-description">ملاحظة اختيارية</Label><Textarea id="proposal-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="سبب التعديل أو سياقه…" /></div><div className="rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">الحالي:</span> <span dir="auto">{asset.displayName}</span><br /><span className="font-semibold text-foreground">المقترح:</span> <span dir="auto">{displayName || "—"}</span></div>{error && <p className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}</div><DialogFooter className="gap-2"><Button variant="outline" onClick={() => void create(false)} disabled={busy || !displayName.trim() || displayName.trim() === asset.displayName}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}حفظ كمسودة</Button><Button onClick={() => void create(true)} disabled={busy || !displayName.trim() || displayName.trim() === asset.displayName}><Send className="h-4 w-4" />حفظ وإرسال</Button></DialogFooter></>}</DialogContent></Dialog>;
}
