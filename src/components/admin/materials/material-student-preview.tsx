"use client";

import * as React from "react";
import { LibraryBig, LayoutGrid } from "lucide-react";
import { type Asset } from "@/components/admin-ui/domain/content/assets";
import { Panel, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { cn } from "@/lib/cn";

/**
 * The Student app lays a MaterialCard out in the portrait iPhone 17 Pro Max
 * development viewport. The Admin preview keeps this logical frame fixed and
 * only scales the complete frame for the available rail width.
 */
export const NATIVE_MATERIAL_LOGICAL_DEVICE_WIDTH = 440;
export const NATIVE_MATERIAL_HORIZONTAL_INSET = 18;
export const NATIVE_MATERIAL_LOGICAL_CARD_WIDTH =
  NATIVE_MATERIAL_LOGICAL_DEVICE_WIDTH - NATIVE_MATERIAL_HORIZONTAL_INSET * 2;
export const NATIVE_MATERIAL_MIN_CARD_HEIGHT = 160;
export const NATIVE_MATERIAL_MAX_CARD_HEIGHT = 340;
export const NATIVE_MATERIAL_DEFAULT_CARD_HEIGHT = 213;
export const NATIVE_MATERIAL_MIN_SCALE = 0.5;
export const NATIVE_MATERIAL_MAX_SCALE = 3;

const NATIVE_MATERIAL_FALLBACK_BACKGROUND = "light-dark(#E8E6DC, #131313)";

export interface MaterialPreviewModel {
  id: string;
  label: string;
  englishTitle: string;
  gradient: string;
  asset: Asset | null;
  available: boolean;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface MaterialPreviewSettings {
  fadeIntensity: number;
  textVerticalPosition: number;
  textScale: number;
  cardHeight: number;
}

export interface NativeMaterialImageTransform {
  translateX: number;
  translateY: number;
  scale: number;
}

export interface NativeMaterialImageDimensions {
  width: number;
  height: number;
}

export interface NativeMaterialPointerOffsets {
  startOffsetX: number;
  startOffsetY: number;
  displayedDeltaX: number;
  displayedDeltaY: number;
  displayScale: number;
  frameHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Mirrors the native card's first-six-digit-hex fallback extraction. */
export function getNativeMaterialFallbackColor(gradient: string): string | null {
  return gradient.match(/#[0-9a-f]{6}/i)?.[0] ?? null;
}

/** Mirrors mobile/src/materials/material-dimensions.ts. */
export function getNativeMaterialCardHeight(cardHeight: number): number {
  const safeHeight = Number.isFinite(cardHeight) && cardHeight > 0
    ? cardHeight
    : NATIVE_MATERIAL_DEFAULT_CARD_HEIGHT;

  return clamp(
    Math.round(safeHeight),
    NATIVE_MATERIAL_MIN_CARD_HEIGHT,
    NATIVE_MATERIAL_MAX_CARD_HEIGHT,
  );
}

/**
 * Translates artwork relative to the final native card frame, before the
 * image's centered contain surface is scaled.
 */
export function getNativeMaterialImageTransform(
  material: Pick<MaterialPreviewModel, "offsetX" | "offsetY" | "scale">,
  frameWidth: number,
  frameHeight: number,
): NativeMaterialImageTransform {
  return {
    translateX: (material.offsetX / 100) * frameWidth,
    translateY: (material.offsetY / 100) * frameHeight,
    scale: material.scale > 0 ? material.scale : 1,
  };
}

export function getNativeMaterialTextBottom(textVerticalPosition: number): number {
  return 20 + textVerticalPosition * 0.8;
}

export function getNativeMaterialDisplayScale(displayWidth: number): number {
  if (!Number.isFinite(displayWidth) || displayWidth <= 0) return 1;
  return Math.min(1, displayWidth / NATIVE_MATERIAL_LOGICAL_CARD_WIDTH);
}

/**
 * Returns the smallest canonical scale that makes a contained image cover the
 * final card frame, without inventing an offset or focal point.
 */
export function getNativeMaterialCenterFillScale({
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
}: {
  sourceWidth: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
}): number | null {
  if (
    !Number.isFinite(sourceWidth) || sourceWidth <= 0 ||
    !Number.isFinite(sourceHeight) || sourceHeight <= 0 ||
    !Number.isFinite(frameWidth) || frameWidth <= 0 ||
    !Number.isFinite(frameHeight) || frameHeight <= 0
  ) {
    return null;
  }

  const containScale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const containedWidth = sourceWidth * containScale;
  const containedHeight = sourceHeight * containScale;
  const fillScale = Math.max(
    frameWidth / containedWidth,
    frameHeight / containedHeight,
  );

  return clamp(fillScale, NATIVE_MATERIAL_MIN_SCALE, NATIVE_MATERIAL_MAX_SCALE);
}

/** Converts displayed pointer movement back into the native logical frame. */
export function getNativeMaterialPointerOffsets({
  startOffsetX,
  startOffsetY,
  displayedDeltaX,
  displayedDeltaY,
  displayScale,
  frameHeight,
}: NativeMaterialPointerOffsets): { offsetX: number; offsetY: number } {
  const safeDisplayScale = Number.isFinite(displayScale) && displayScale > 0
    ? displayScale
    : 1;

  return {
    offsetX: startOffsetX +
      (displayedDeltaX / safeDisplayScale / NATIVE_MATERIAL_LOGICAL_CARD_WIDTH) * 100,
    offsetY: startOffsetY +
      (displayedDeltaY / safeDisplayScale / frameHeight) * 100,
  };
}

function usePreviewDisplayWidth(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [displayWidth, setDisplayWidth] = React.useState<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const width = container.getBoundingClientRect().width;
      setDisplayWidth((current) => current === width ? current : width);
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  return displayWidth;
}

function NativeMaterialCardFrame({
  material,
  settings,
  onImageDimensionsChange,
}: {
  material: MaterialPreviewModel;
  settings: MaterialPreviewSettings;
  onImageDimensionsChange?: (dimensions: NativeMaterialImageDimensions) => void;
}) {
  const imageUrl = material.asset?.previewUrl && material.asset.integrity === "ok"
    ? material.asset.previewUrl
    : null;
  const [imageFailed, setImageFailed] = React.useState(false);
  const cardHeight = getNativeMaterialCardHeight(settings.cardHeight);
  const intensity = clamp(settings.fadeIntensity, 0, 1);
  const textScale = settings.textScale > 0 ? settings.textScale : 1;
  const fallbackColor = getNativeMaterialFallbackColor(material.gradient);
  const imageTransform = getNativeMaterialImageTransform(
    material,
    NATIVE_MATERIAL_LOGICAL_CARD_WIDTH,
    cardHeight,
  );

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <div
      className="relative size-full overflow-hidden rounded-[28px]"
      style={{
        backgroundColor: fallbackColor ?? NATIVE_MATERIAL_FALLBACK_BACKGROUND,
      }}
      data-native-material-card="true"
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" data-native-artwork-layer="true">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 size-full"
            draggable={false}
            onError={() => setImageFailed(true)}
            onLoad={(event) => {
              const { naturalHeight, naturalWidth } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                onImageDimensionsChange?.({ height: naturalHeight, width: naturalWidth });
              }
            }}
            style={{
              objectFit: "contain",
              objectPosition: "center center",
              transform: `translate3d(${imageTransform.translateX}px, ${imageTransform.translateY}px, 0) scale(${imageTransform.scale})`,
              transformOrigin: "center center",
            }}
          />
        ) : (
          <div className="grid size-full place-items-center text-white/70">
            <LibraryBig className="size-16" strokeWidth={1.5} aria-hidden />
          </div>
        )}
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        data-native-fade-layer="true"
        style={{
          background: `linear-gradient(to top, rgba(0,0,0,${intensity}), rgba(0,0,0,0))`,
        }}
      />

      <div
        className="pointer-events-none absolute z-[2] text-center text-white"
        style={{
          bottom: getNativeMaterialTextBottom(settings.textVerticalPosition),
          left: 18,
          right: 18,
        }}
        data-student-text-overlay="true"
      >
        <p
          className="m-0 font-bold"
          dir="rtl"
          style={{
            color: "#FFFFFF",
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
            fontSize: 24 * textScale,
            fontWeight: 700,
            lineHeight: 1.3,
            textAlign: "center",
          }}
          data-student-arabic-title="true"
        >
          {material.label}
        </p>
        <p
          className="m-0"
          dir="ltr"
          style={{
            color: "rgba(255,255,255,0.72)",
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
            fontSize: 12 * textScale,
            letterSpacing: 1.2,
            lineHeight: 1.3,
            marginTop: 4,
            textAlign: "center",
          }}
          data-student-english-title="true"
        >
          {material.englishTitle}
        </p>
      </div>
    </div>
  );
}

/** One native-equivalent renderer shared by every Admin Material preview. */
export function NativeMaterialCardPreview({
  material,
  settings,
  onImageDimensionsChange,
  className,
}: {
  material: MaterialPreviewModel;
  settings: MaterialPreviewSettings;
  onImageDimensionsChange?: (dimensions: NativeMaterialImageDimensions) => void;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const displayWidth = usePreviewDisplayWidth(containerRef);
  const cardHeight = getNativeMaterialCardHeight(settings.cardHeight);
  const displayScale = getNativeMaterialDisplayScale(
    displayWidth ?? NATIVE_MATERIAL_LOGICAL_CARD_WIDTH,
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full", className)}
      dir="ltr"
      style={{ height: cardHeight * displayScale }}
      data-native-material-preview="true"
    >
      <div
        className="absolute top-0"
        style={{
          height: cardHeight,
          left: "50%",
          marginLeft: -NATIVE_MATERIAL_LOGICAL_CARD_WIDTH / 2,
          transform: `scale(${displayScale})`,
          transformOrigin: "top center",
          width: NATIVE_MATERIAL_LOGICAL_CARD_WIDTH,
        }}
      >
        <NativeMaterialCardFrame
          material={material}
          onImageDimensionsChange={onImageDimensionsChange}
          settings={settings}
        />
      </div>
    </div>
  );
}

export function MaterialStudentPreview({
  materials,
  settings,
  className,
}: {
  materials: MaterialPreviewModel[];
  settings: MaterialPreviewSettings;
  className?: string;
}) {
  const visible = materials.filter((material) => material.available);
  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title="كما يراه الطالب"
        description="معاينة حقيقية لبطاقات المواد بنفس حسابات الصورة والنص في التطبيق."
        density="compact"
        icon={<LayoutGrid aria-hidden />}
      />
      <div className="p-4">
        {visible.length ? (
          <div className="mx-auto flex w-full max-w-[19rem] flex-col gap-4">
            {visible.map((material) => (
              <NativeMaterialCardPreview
                key={material.id}
                material={material}
                settings={settings}
              />
            ))}
          </div>
        ) : (
          <Well padding="md">
            <p className="text-center text-xs text-fg-tertiary">
              لا توجد مادة متاحة للطالب حاليًا.
            </p>
          </Well>
        )}
      </div>
    </Panel>
  );
}
