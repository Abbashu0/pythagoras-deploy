import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export function AdminAuthFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10"
      dir="rtl"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_42%)]" />
      <section className="relative w-full max-w-md rounded-3xl border bg-card p-6 shadow-2xl shadow-black/10 sm:p-8">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-[11px] font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {eyebrow}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-primary/10 text-xl font-bold text-primary ring-1 ring-primary/20">
            π
          </div>
        </div>

        {children}

        <div className="mt-7 border-t pt-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            العودة إلى تطبيق الطالب
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </main>
  );
}
