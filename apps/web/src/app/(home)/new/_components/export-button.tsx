"use client";

import { Download, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { scrubMessage, track } from "@/lib/analytics";
import type { StackState } from "@/lib/constant";
import { projectFolderName } from "@/lib/stack-utils";
import { cn } from "@/lib/utils";

type ExportButtonProps = {
  stack: StackState;
  disabled?: boolean;
  variant: "action" | "toolbar";
};

const variantClasses = {
  action:
    "builder-focus-ring pointer-coarse:min-h-8 flex flex-1 items-center justify-center gap-1.5 rounded-[4px] border px-2 py-1.5 font-mono text-[10px] text-primary uppercase tracking-[0.10em] transition-colors duration-150 hover:border-primary disabled:cursor-not-allowed disabled:opacity-50",
  toolbar:
    "builder-focus-ring pointer-coarse:py-2 flex items-center gap-1 font-mono text-[10px] text-fd-muted-foreground uppercase tracking-[0.10em] transition-colors duration-150 hover:text-fd-foreground disabled:cursor-not-allowed disabled:opacity-50",
} as const;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the generated project source as a ZIP archive built by the same generator as the CLI. */
export function ExportButton({ stack, disabled, variant }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const generation = useRef(0);

  async function exportSource() {
    if (exporting || disabled) return;
    const current = ++generation.current;
    setExporting(true);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(stack),
      });
      if (!response.ok) {
        const failure: { message?: string } | null = await response.json().catch(() => null);
        throw new Error(failure?.message ?? "Unable to export this configuration.");
      }
      const blob = await response.blob();
      if (current !== generation.current) return;
      triggerDownload(blob, `${projectFolderName(stack.projectName)}.zip`);
      track("preview_export", {
        files: Number(response.headers.get("x-file-count") ?? 0),
        bytes: blob.size,
      });
    } catch (cause) {
      if (current !== generation.current) return;
      const message =
        cause instanceof Error ? cause.message : "Unable to export this configuration.";
      toast.error(message);
      track("preview_export_error", { message: scrubMessage(message) });
    } finally {
      if (current === generation.current) setExporting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={exportSource}
      disabled={disabled || exporting}
      aria-busy={exporting}
      title={
        exporting
          ? "Preparing source archive"
          : "Download the generated project source as a ZIP archive"
      }
      className={cn(variantClasses[variant])}
    >
      {exporting ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Download className="h-3 w-3 shrink-0" />
      )}
      {exporting ? "Exporting" : "Export"}
    </button>
  );
}
