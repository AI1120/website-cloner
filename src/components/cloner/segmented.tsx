"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Show only the icon; the label is still announced to screen readers. */
  iconOnly?: boolean;
  className?: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** On narrow screens show only the icons of options that have one. */
  collapseLabels?: boolean;
  className?: string;
}

/** A compact group of mutually exclusive toggle buttons. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  collapseLabels = false,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex shrink-0 rounded-lg bg-muted p-0.5", className)}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, iconOnly, className: optionClass }) => (
        <button
          key={optionValue}
          type="button"
          aria-pressed={value === optionValue}
          aria-label={iconOnly || collapseLabels ? optionLabel : undefined}
          title={iconOnly ? optionLabel : undefined}
          onClick={() => onChange(optionValue)}
          className={cn(
            "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            value === optionValue
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            optionClass,
          )}
        >
          {Icon && <Icon className="size-4" aria-hidden="true" />}
          {!iconOnly && (
            <span className={cn(collapseLabels && Icon && "hidden sm:inline")}>{optionLabel}</span>
          )}
        </button>
      ))}
    </div>
  );
}
