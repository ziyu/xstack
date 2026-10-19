import type { ReactNode } from "react";

export function GroupHeader({ label, count }: { label: string; count?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="font-mono text-[10px] text-fd-muted-foreground/70 uppercase tracking-[0.10em]">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-fd-border" />
      {count !== undefined && (
        <span className="font-mono text-[10px] text-fd-muted-foreground/50 tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="font-mono text-[11px] text-fd-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </span>
      <span className="font-mono text-[13px] tabular-nums">{value}</span>
    </div>
  );
}
