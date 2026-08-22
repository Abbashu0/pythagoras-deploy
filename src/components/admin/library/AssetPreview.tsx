import Image from "next/image";
import { File, FileAudio, FileJson, FileText, FileVideo, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryAsset } from "./library-types";

const icons = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  json: FileJson,
  "other-safe-file": File,
};

export function AssetPreview({
  asset,
  className,
  sizes = "(max-width: 768px) 50vw, 240px",
}: {
  asset: LibraryAsset;
  className?: string;
  sizes?: string;
}) {
  if (asset.mediaKind === "image") {
    return (
      <div className={cn("relative overflow-hidden bg-muted", className)}>
        <Image
          src={`/api/admin/assets/${asset.id}/content`}
          alt={asset.displayName}
          fill
          unoptimized
          loading="lazy"
          sizes={sizes}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
    );
  }

  const Icon = icons[asset.mediaKind];
  return (
    <div className={cn("grid place-items-center bg-gradient-to-br from-primary/10 via-muted to-muted/50", className)}>
      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-primary/15 bg-background/70 text-primary shadow-sm">
        <Icon className="h-8 w-8" aria-hidden="true" />
      </div>
    </div>
  );
}
