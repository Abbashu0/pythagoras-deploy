"use client";

import * as React from "react";
import * as T from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { transition } from "@/lib/motion";
import { CountBadge, StatusDot } from "../status/status-badge";
import type { StatusKey } from "../status/status-registry";

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  status?: StatusKey;
  disabled?: boolean;
  disabledReason?: string;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  appearance?: "underline" | "segmented" | "pill";
  size?: "sm" | "md";
  className?: string;
  listClassName?: string;
  children?: React.ReactNode;
  stretch?: boolean;
  trailing?: React.ReactNode;
}

const TabsIdContext = React.createContext<string>("tabs");

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  appearance = "underline",
  size = "md",
  className,
  listClassName,
  children,
  stretch = false,
  trailing,
}: TabsProps) {
  const uid = React.useId();

  return (
    <TabsIdContext.Provider value={uid}>
      <T.Root
        value={value}
        defaultValue={defaultValue ?? items[0]?.value}
        onValueChange={onValueChange}
        className={cn("flex flex-col", className)}
      >
        <div
          className={cn(
            "flex items-center gap-3",
            appearance === "underline" && "border-b border-border",
          )}
        >
          <T.List
            className={cn(
              "flex min-w-0 items-center",
              appearance === "underline" && "-mb-px gap-1 overflow-x-auto",
              appearance === "segmented" &&
                "gap-0.5 rounded-md border border-border bg-inset p-0.5",
              appearance === "pill" && "gap-1",
              stretch && "w-full",
              listClassName,
            )}
          >
            {items.map((item) => (
              <Trigger
                key={item.value}
                item={item}
                appearance={appearance}
                size={size}
                stretch={stretch}
              />
            ))}
          </T.List>
          {trailing ? <div className="ms-auto shrink-0 pb-1.5">{trailing}</div> : null}
        </div>
        {children}
      </T.Root>
    </TabsIdContext.Provider>
  );
}

function Trigger({
  item,
  appearance,
  size,
  stretch,
}: {
  item: TabItem;
  appearance: NonNullable<TabsProps["appearance"]>;
  size: "sm" | "md";
  stretch: boolean;
}) {
  const uid = React.useContext(TabsIdContext);

  return (
    <T.Trigger
      value={item.value}
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      className={cn(
        "group/tab relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium",
        "transition-colors duration-[var(--dur-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        "disabled:pointer-events-none disabled:text-disabled-fg",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        size === "sm" ? "text-xs" : "text-sm",
        stretch && "flex-1",
        appearance === "underline" && [
          size === "sm" ? "h-8 px-2.5" : "h-10 px-3",
          "rounded-t-sm text-fg-tertiary hover:text-fg",
          "data-[state=active]:text-fg",
        ],
        appearance === "segmented" && [
          size === "sm" ? "h-6 px-2.5" : "h-7 px-3",
          "rounded-[5px] text-fg-tertiary hover:text-fg-secondary",
          "data-[state=active]:text-fg",
        ],
        appearance === "pill" && [
          size === "sm" ? "h-6 px-2.5" : "h-7 px-3",
          "rounded-full text-fg-tertiary hover:bg-hover hover:text-fg",
          "data-[state=active]:bg-accent-subtle data-[state=active]:text-accent-text",
        ],
      )}
    >
      {appearance === "underline" ? (
        <span className="absolute inset-x-0 bottom-0 hidden h-[2px] group-data-[state=active]/tab:block">
          <motion.span
            layoutId={`tab-underline-${uid}`}
            className="block size-full rounded-full bg-accent"
            transition={transition.indicator}
          />
        </span>
      ) : null}
      {appearance === "segmented" ? (
        <span className="absolute inset-0 hidden group-data-[state=active]/tab:block">
          <motion.span
            layoutId={`tab-segment-${uid}`}
            className="block size-full rounded-[5px] border border-border bg-surface shadow-xs"
            transition={transition.indicator}
          />
        </span>
      ) : null}

      <span className="relative z-10 inline-flex items-center gap-2">
        {item.status ? <StatusDot status={item.status} size="sm" /> : null}
        {item.icon}
        <span>{item.label}</span>
        {item.count != null ? (
          <CountBadge
            value={item.count}
            className="group-data-[state=active]/tab:bg-accent-subtle group-data-[state=active]/tab:text-accent-text"
          />
        ) : null}
      </span>
    </T.Trigger>
  );
}

export function TabPanel({
  value,
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof T.Content>) {
  return (
    <T.Content
      value={value}
      className={cn(
        "mt-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        className,
      )}
      {...props}
    >
      {children}
    </T.Content>
  );
}

export const TabsRoot = T.Root;
export const TabsList = T.List;
export const TabsTrigger = T.Trigger;
