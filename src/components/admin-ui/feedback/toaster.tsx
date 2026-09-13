"use client";

import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Undo2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "../primitives/button";

/* ============================================================================
   Toasts
   ---------------------------------------------------------------------------
   What a toast is for: confirming that something the operator just did
   succeeded, and offering an undo when the action is reversible.

   What a toast is *not* for: anything the operator must act on. Blocking
   problems belong in an AttentionBanner or inline next to the control that
   caused them, because a toast disappears and an unresolved problem does not.

   Position: bottom inline-start. In RTL that is bottom-left, away from the
   sidebar and away from the primary action cluster at the bottom-end.
   ========================================================================== */

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-left"
      dir="rtl"
      gap={10}
      offset={20}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        duration: 4200,
        classNames: {
          toast: cn(
            "group flex w-[min(24rem,calc(100vw-2.5rem))] items-start gap-3",
            "rounded-lg border border-border bg-elevated p-3 shadow-lg",
            "font-sans text-sm text-fg",
          ),
          title: "font-medium leading-snug",
          description: "mt-0.5 text-xs leading-[1.6] text-fg-secondary",
          actionButton: "shrink-0",
          cancelButton: "shrink-0",
          closeButton:
            "border-border bg-elevated text-fg-tertiary hover:text-fg",
        },
      }}
      icons={{
        success: <CheckCircle2 className="size-4 text-success-text" aria-hidden />,
        error: <XCircle className="size-4 text-danger-text" aria-hidden />,
        warning: (
          <AlertTriangle className="size-4 text-warning-text" aria-hidden />
        ),
        info: <Info className="size-4 text-info-text" aria-hidden />,
        loading: (
          <Loader2
            className="size-4 animate-spin text-accent-text motion-reduce:animate-none"
            aria-hidden
          />
        ),
      }}
    />
  );
}

/* ---------------------------------------------------------------------------
   Typed helpers so pages never call sonner directly and every toast in the
   product looks and behaves the same.
   ------------------------------------------------------------------------ */

type ToastAction = { label: string; onClick: () => void };

interface ToastOptions {
  description?: string;
  action?: ToastAction;
  duration?: number;
  id?: string | number;
}

function actionNode(action?: ToastAction) {
  if (!action) return undefined;
  return {
    label: action.label,
    onClick: action.onClick,
  };
}

export const toast = {
  success(message: string, options: ToastOptions = {}) {
    return sonnerToast.success(message, {
      description: options.description,
      duration: options.duration,
      id: options.id,
      action: actionNode(options.action),
    });
  },

  error(message: string, options: ToastOptions = {}) {
    return sonnerToast.error(message, {
      description: options.description,
      duration: options.duration ?? 6500,
      id: options.id,
      action: actionNode(options.action),
    });
  },

  warning(message: string, options: ToastOptions = {}) {
    return sonnerToast.warning(message, {
      description: options.description,
      duration: options.duration ?? 5500,
      id: options.id,
      action: actionNode(options.action),
    });
  },

  info(message: string, options: ToastOptions = {}) {
    return sonnerToast.info(message, {
      description: options.description,
      duration: options.duration,
      id: options.id,
      action: actionNode(options.action),
    });
  },

  loading(message: string, options: Omit<ToastOptions, "action"> = {}) {
    return sonnerToast.loading(message, {
      description: options.description,
      id: options.id,
      duration: options.duration ?? Number.POSITIVE_INFINITY,
    });
  },

  /**
   * Undo toast. The reversible-action pattern: apply optimistically, tell the
   * operator, and give them a window to take it back. Preferred over a
   * confirmation dialog for anything genuinely reversible.
   */
  undo(
    message: string,
    onUndo: () => void,
    options: { description?: string; duration?: number } = {},
  ) {
    return sonnerToast.custom(
      (id) => (
        <div className="flex w-[min(24rem,calc(100vw-2.5rem))] items-start gap-3 rounded-lg border border-border bg-elevated p-3 shadow-lg">
          <CheckCircle2
            className="mt-0.5 size-4 shrink-0 text-success-text"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug text-fg">{message}</p>
            {options.description ? (
              <p className="mt-0.5 text-xs leading-[1.6] text-fg-secondary">
                {options.description}
              </p>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="quiet"
            icon={<Undo2 aria-hidden />}
            onClick={() => {
              onUndo();
              sonnerToast.dismiss(id);
            }}
            className="shrink-0"
          >
            تراجع
          </Button>
        </div>
      ),
      { duration: options.duration ?? 7000 },
    );
  },

  /**
   * Background operation: a single toast that transitions
   * pending → success/failure without stacking three separate toasts.
   */
  promise<T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: unknown) => string);
      description?: string;
    },
  ) {
    return sonnerToast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
      description: messages.description,
    });
  },

  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },

  /** Fully custom content — use sparingly, prefer the typed helpers. */
  custom: sonnerToast.custom,
};
