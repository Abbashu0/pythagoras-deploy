"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { AdminShell } from "@/components/admin-ui/layout/admin-shell";
import { Breadcrumbs, type Crumb } from "@/components/admin-ui/navigation/breadcrumbs";
import { SidebarBrand } from "@/components/admin-ui/navigation/sidebar";
import {
  DensityToggle,
  TopBar,
} from "@/components/admin-ui/navigation/topbar";
import { AppProviders } from "@/components/providers/app-providers";
import { resolveNavTrail } from "@/components/admin-ui/navigation/nav-config";
import { ADMIN_NAV } from "@/config/admin-nav";

export function AdminFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const trail = React.useMemo(
    () => resolveNavTrail(ADMIN_NAV, pathname),
    [pathname],
  );

  const crumbs = React.useMemo<Crumb[]>(() => {
    const items: Crumb[] = [];
    if (trail?.section.label) items.push({ label: trail.section.label });
    for (const item of trail?.trail ?? []) {
      items.push({ label: item.label, href: item.href });
    }
    return items;
  }, [trail]);

  return (
    <AppProviders>
      <div lang="ar" dir="rtl" className="h-dvh font-sans">
        <AdminShell
          sections={ADMIN_NAV}
          pathname={pathname}
          pinnable={false}
          sidebarHeader={
            <SidebarBrand
              name="فيثاغورس"
              subtitle="لوحة الإدارة"
              href="/admin"
            />
          }
          topBar={
            <TopBar
              location={<Breadcrumbs items={crumbs} maxVisible={4} />}
            >
              <DensityToggle />
            </TopBar>
          }
        >
          {children}
        </AdminShell>
      </div>
    </AppProviders>
  );
}
