import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Pythagoras Platform",
  description: "Internal dashboard for managing platform content.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
