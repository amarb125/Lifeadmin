"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full animate-rise flex-col rounded-t-3xl bg-bg shadow-2xl sm:max-w-xl sm:rounded-3xl">
        <header className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="font-display text-2xl">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-line/50">
            <X size={20} />
          </button>
        </header>
        <div className="overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-line")}
    >
      <span className={clsx("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-6" : "left-1")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx("rounded-full px-3 py-1.5 text-xs font-medium transition", value === o.value ? "bg-ink text-bg" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
