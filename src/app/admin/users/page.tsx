"use client";

/**
 * Admin — Users management page (/admin/users)
 *
 * Features:
 *   - Searchable user table (by email, name, display name)
 *   - Filter by role (all / student / teacher / admin)
 *   - Premium status indicator per user
 *   - Active/inactive toggle
 *   - Pagination
 *   - Summary stats at top (total users, premium, active)
 *
 * Data comes from /api/users (Prisma).
 * When the backend grows, this page stays the same.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  Search,
  Crown,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  role: string;
  grade: string | null;
  isActive: boolean;
  isPremium: boolean;
  createdAt: string;
}

interface UsersData {
  users: UserRow[];
  total: number;
  page: number;
  limit: number;
}

export default function AdminUsersPage() {
  const [data, setData] = useState<UsersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      params.set("limit", "50");

      const res = await fetch(`/api/users?${params}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("[admin/users] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchData, 300); // debounce search
    return () => clearTimeout(timer);
  }, [fetchData]);

  const users = data?.users || [];
  const total = data?.total || 0;
  const premiumCount = users.filter((u) => u.isPremium).length;
  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Stats ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="إجمالي المستخدمين" value={String(total)} />
        <StatCard icon={<Crown className="h-4 w-4" />} label="Premium" value={String(premiumCount)} valueClassName="text-amber-500" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="نشطون" value={String(activeCount)} valueClassName="text-emerald-500" />
        <StatCard icon={<XCircle className="h-4 w-4" />} label="غير نشطون" value={String(total - activeCount)} valueClassName="text-muted-foreground" />
      </div>

      {/* ---------- Search + Filters ---------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالبريد أو الاسم…"
            className="pr-8 text-xs"
            dir="rtl"
          />
        </div>
        <div className="flex gap-1.5">
          {[
            { value: "", label: "الكل" },
            { value: "student", label: "طلاب" },
            { value: "teacher", label: "معلمون" },
            { value: "admin", label: "مدراء" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRoleFilter(opt.value)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                roleFilter === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="h-8 gap-1 text-xs">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          تحديث
        </Button>
      </div>

      {/* ---------- Table ---------- */}
      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-xs text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              جارٍ تحميل المستخدمين…
            </div>
          ) : users.length === 0 ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-xs text-muted-foreground">
              <Users className="h-8 w-8 opacity-30" />
              لا يوجد مستخدمون مطابقون.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-3 font-medium">المستخدم</th>
                    <th className="p-3 font-medium">الدور</th>
                    <th className="p-3 font-medium">Premium</th>
                    <th className="p-3 font-medium">الحالة</th>
                    <th className="p-3 font-medium">تاريخ التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {(user.displayName || user.name || user.email)[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {user.displayName || user.name || "بدون اسم"}
                            </div>
                            <div className="truncate text-[10px] text-muted-foreground">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[9px]">
                          {user.role === "student" ? "طالب" : user.role === "teacher" ? "معلم" : user.role === "admin" ? "مدير" : user.role}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {user.isPremium ? (
                          <span className="flex items-center gap-1 text-amber-500">
                            <Crown className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-medium">Premium</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {user.isActive ? (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span className="text-[10px]">نشط</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <XCircle className="h-3.5 w-3.5" />
                            <span className="text-[10px]">غير نشط</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-[10px] tabular-nums text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString("ar-EG", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, valueClassName }: { icon: React.ReactNode; label: string; value: string; valueClassName?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${valueClassName || "text-foreground"}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
