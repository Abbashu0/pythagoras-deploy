import "@/styles/globals.css";
import { IBM_Plex_Sans_Arabic, JetBrains_Mono } from "next/font/google";

import { AdminFrame } from "./admin-frame";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex-arabic",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono-stack",
});

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${plexArabic.variable} ${jetbrainsMono.variable}`}>
      <AdminFrame>{children}</AdminFrame>
    </div>
  );
}
