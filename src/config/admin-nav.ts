import { Archive, BookOpen, BrainCircuit, Images } from "lucide-react";
import type { NavSection } from "@/components/admin-ui/navigation/nav-config";

export const ADMIN_NAV: NavSection[] = [
  {
    key: "ads",
    label: "الإعلانات",
    collapsible: true,
    defaultCollapsed: false,
    items: [
      {
        key: "ads-banners",
        label: "بانرات الصفحة الرئيسية",
        href: "/admin/ads/banners",
        icon: Images,
      },
    ],
  },
  {
    key: "content",
    label: "إدارة المحتوى",
    collapsible: true,
    defaultCollapsed: false,
    items: [
      {
        key: "content-storage",
        label: "مخزن صفحة الأدمن",
        href: "/admin/content/storage",
        icon: Archive,
      },
      {
        key: "content-materials",
        label: "إدارة المواد",
        href: "/admin/content/materials",
        icon: BookOpen,
      },
    ],
  },
  {
    key: "ai",
    label: "الذكاء الاصطناعي",
    collapsible: true,
    defaultCollapsed: false,
    items: [
      {
        key: "ai-models",
        label: "النماذج والمزوّدون",
        href: "/admin/ai/models",
        icon: BrainCircuit,
      },
    ],
  },
];
