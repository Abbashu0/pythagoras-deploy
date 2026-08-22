import Link from "next/link";
import { BookOpen, ImagePlus, Compass, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const areas = [
  { href: "/admin/banners", label: "البانرات", description: "إدارة البانرات المخزنة محليًا على هذا المتصفح.", icon: ImagePlus },
  { href: "/admin/materials", label: "المواد الدراسية", description: "إدارة بطاقات المواد المحلية.", icon: BookOpen },
  { href: "/admin/navigation", label: "التنقل", description: "ترتيب عناصر تنقل الطالب المحلية.", icon: Compass },
  { href: "/admin/tools", label: "الأدوات", description: "إدارة الأدوات المتاحة محليًا.", icon: Wrench },
];

export function DashboardView() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8" dir="rtl">
      <section>
        <p className="text-sm text-muted-foreground">إدارة محلية</p>
        <h1 className="mt-1 text-2xl font-bold">لوحة تحكم فيثاغورس</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          لوحة الإدارة محمية بهوية محلية وجلسة خادمية. وحدات المحتوى الحالية ما زالت محفوظة في هذا المتصفح إلى أن تبدأ مرحلة ترحيلها المعتمدة.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {areas.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <Icon className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{label}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
