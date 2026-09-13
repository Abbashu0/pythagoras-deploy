"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "../../primitives/button";
import { Tooltip } from "../../primitives/tooltip";
import { Panel } from "../../primitives/surface";

/* ============================================================================
   ReorderableList
   ---------------------------------------------------------------------------
   Ordering is a first-class operation in Pythagoras: banners, materials and the
   student app's navigation tools all have a deliberate sequence that the
   operator controls.

   Accessibility is the reason this is a shared component rather than three
   ad-hoc drag implementations:

   - Drag works with a pointer via a dedicated handle, so the row itself stays
     clickable and text stays selectable.
   - Every row also carries "move up" / "move down" buttons. Drag-and-drop is
     not keyboard-operable in any way most people will discover, and an ordering
     UI that only works with a mouse is not finished.
   - dnd-kit's keyboard sensor is wired too, so the handle is focusable and
     Space/Arrow keys work for operators who do find it.
   - The list announces the new position after each move.

   Motion: rows translate, they do not fade. A reorder is a movement, and the
   eye should be able to follow the row it just moved.
   ========================================================================== */

export interface ReorderableItem {
  id: string;
}

export interface ReorderableListProps<T extends ReorderableItem> {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Disable reordering (e.g. while a filter is applied — order is ambiguous). */
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  className?: string;
  itemClassName?: string;
  /** Bordered panel around the list. */
  bordered?: boolean;
  /** Human label for the announcement, e.g. "بانر". */
  itemLabel?: string;
  /** Rendered when the list is empty. */
  emptyState?: React.ReactNode;
  /** Show the numeric position before the handle. */
  showPosition?: boolean;
}

export function ReorderableList<T extends ReorderableItem>({
  items,
  onReorder,
  renderItem,
  disabled = false,
  disabledReason,
  className,
  itemClassName,
  bordered = true,
  itemLabel = "عنصر",
  emptyState,
  showPosition = true,
}: ReorderableListProps<T>) {
  const [announcement, setAnnouncement] = React.useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small distance threshold keeps clicks on row content working.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = React.useMemo(() => items.map((i) => i.id), [items]);

  const move = React.useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= items.length || from === to) return;
      onReorder(arrayMove(items, from, to));
      setAnnouncement(
        `نُقل ${itemLabel} إلى الموضع ${to + 1} من ${items.length}`,
      );
    },
    [items, onReorder, itemLabel],
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    move(from, to);
  };

  if (items.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  const list = (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="min-w-0 divide-y divide-border-subtle">
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              id={item.id}
              index={index}
              total={items.length}
              disabled={disabled}
              disabledReason={disabledReason}
              itemLabel={itemLabel}
              showPosition={showPosition}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              className={itemClassName}
            >
              {renderItem(item, index)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );

  return (
    <div className={cn("min-w-0", className)}>
      {bordered ? (
        <Panel padding="none" clip>
          {list}
        </Panel>
      ) : (
        list
      )}
      {/* Screen-reader feedback for both drag and button-driven moves. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Row
   ------------------------------------------------------------------------ */

function SortableRow({
  id,
  index,
  total,
  children,
  disabled,
  disabledReason,
  itemLabel,
  showPosition,
  onMoveUp,
  onMoveDown,
  className,
}: {
  id: string;
  index: number;
  total: number;
  children: React.ReactNode;
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  itemLabel: string;
  showPosition: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  className?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group/row relative flex min-w-0 items-center gap-2 bg-surface",
        isDragging && "z-10 shadow-lg",
        className,
      )}
    >
      {/* Handle + position + keyboard fallback */}
      <div className="flex shrink-0 flex-col items-center gap-0.5 self-stretch border-e border-border-subtle bg-surface-secondary px-1.5 py-2">
        <Tooltip content={disabled ? disabledReason : "اسحب لإعادة الترتيب"}>
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`إعادة ترتيب ${itemLabel} — الموضع ${index + 1}`}
            disabled={disabled}
            {...attributes}
            {...listeners}
            className={cn(
              "flex size-5 items-center justify-center rounded-[4px] text-fg-quaternary",
              "transition-colors hover:bg-hover hover:text-fg-secondary",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
              disabled ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing",
            )}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        </Tooltip>

        {showPosition ? (
          <span className="text-[10px] font-medium text-fg-quaternary tnum">
            {index + 1}
          </span>
        ) : null}

        <div className="flex flex-col">
          <IconButton
            label={`تحريك ${itemLabel} للأعلى`}
            size="xs"
            variant="ghost"
            disabled={disabled || index === 0}
            onClick={onMoveUp}
            className="size-4 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
          >
            <ChevronUp aria-hidden />
          </IconButton>
          <IconButton
            label={`تحريك ${itemLabel} للأسفل`}
            size="xs"
            variant="ghost"
            disabled={disabled || index === total - 1}
            onClick={onMoveDown}
            className="size-4 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
          >
            <ChevronDown aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="min-w-0 flex-1 py-2.5 pe-3">{children}</div>
    </li>
  );
}

/* ---------------------------------------------------------------------------
   OrderingNotice — shown when reordering is temporarily unavailable, so a
   greyed handle is never unexplained.
   ------------------------------------------------------------------------ */

export function OrderingNotice({
  reason,
  onClear,
  clearLabel = "مسح المرشّحات",
  className,
}: {
  reason: React.ReactNode;
  onClear?: () => void;
  clearLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-inset px-3.5 py-2.5",
        className,
      )}
    >
      <p className="text-xs text-fg-tertiary">{reason}</p>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-accent-text hover:underline"
        >
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
