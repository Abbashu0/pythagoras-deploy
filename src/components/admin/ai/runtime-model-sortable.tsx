"use client";

import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { reorderFallbacks } from "./agent-1-route-draft";

export function RuntimeModelOrder({ ids, disabled, onReorder, children }: {
  ids: string[]; disabled: boolean; onReorder: (ids: string[]) => void; children: React.ReactNode;
}) {
  const [announcement, setAnnouncement] = React.useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext id="agent1-route-order" sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: "اضغط مسافة لبدء ترتيب الاحتياطي، ثم الأسهم للنقل، ومسافة للتأكيد أو Escape للإلغاء." },
      announcements: { onDragStart: () => "بدأ ترتيب الاحتياطي.", onDragOver: () => undefined,
        onDragEnd: () => "انتهى ترتيب الاحتياطي.", onDragCancel: () => "أُلغي الترتيب." } }}
    onDragEnd={({ active, over }) => {
      if (disabled || !over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id)); const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      onReorder(reorderFallbacks(ids, from, to)); setAnnouncement("نُقل الاحتياطي إلى الموضع " + (to + 1));
    }}>
    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>{children}</SortableContext>
    <span role="status" className="sr-only">{announcement}</span>
  </DndContext>;
}

export function SortableRuntimeModel({ id, position, disabled, children }: {
  id: string; position: number; disabled: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  const reduced = useReducedMotion();
  return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition }}
    className={cn("relative flex min-w-0 flex-col items-center gap-2", isDragging && "z-10 rounded-lg bg-surface shadow-lg")}>
    {children}
    {!id.startsWith("empty-") ? <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
      aria-label={"سحب وترتيب الاحتياطي " + position} title="اسحب للترتيب، أو استخدم أزرار التقديم والتأخير"
      className="focus-ring flex min-h-7 touch-none items-center gap-1 rounded px-2 text-2xs text-fg-tertiary hover:bg-hover disabled:opacity-45">
      <GripVertical className="size-3" aria-hidden />ترتيب
    </button> : null}
  </div>;
}
