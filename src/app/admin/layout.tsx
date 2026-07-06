import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Sponsored Carousel — Pythagoras Platform",
  description: "Internal dashboard for managing Home page sponsored banners.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen bg-background">
      {children}
    </div>
  );
}
