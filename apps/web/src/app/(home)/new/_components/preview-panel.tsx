"use client";

import { Loader2, FolderTree, FileCode2, Info, ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { scrubMessage, track } from "@/lib/analytics";
import type { StackState } from "@/lib/constant";
import { orpc } from "@/lib/orpc";
import { productPlan } from "@/lib/stack-features";
import { StackStateSchema } from "@/lib/stack-schema";
import { formatProjectName } from "@/lib/stack-utils";
import { validateProjectName } from "@/lib/stack-validation";
import { cn } from "@/lib/utils";

import { CodeViewer, CodeViewerEmpty } from "./code-viewer";
import { FileExplorer, type VirtualFile, type VirtualDirectory } from "./file-explorer";

type Preview = Awaited<ReturnType<typeof orpc.preview>>;

export function useStackPreview(stack: StackState, enabled: boolean) {
  const [result, setResult] = useState<{
    key: string;
    attempt: number;
    data: Preview | null;
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const nameError =
    validateProjectName(formatProjectName(stack.projectName)) ||
    productPlan(stack)
      .issues.filter((issue) => issue.level === "error")
      .map((issue) => issue.message)
      .join("\n") ||
    null;
  const requestKey = !nameError ? JSON.stringify(stack) : null;
  const currentResult = result?.key === requestKey && result.attempt === attempt ? result : null;

  useEffect(() => {
    if (!enabled || !requestKey) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const input = StackStateSchema.parse(JSON.parse(requestKey));
        const preview = await orpc.preview(input, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, attempt, data: preview, error: null });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : "Unable to load preview";
        setResult({ key: requestKey, attempt, data: null, error: message });
        track("preview_error", { message: scrubMessage(message) });
      }
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, requestKey, attempt]);

  return {
    data: currentResult?.data ?? null,
    isLoading: enabled && !!requestKey && !currentResult,
    error: nameError ?? currentResult?.error ?? null,
    canRetry: !nameError,
    retry: () => setAttempt((value) => value + 1),
  };
}

interface PreviewPanelProps {
  preview: ReturnType<typeof useStackPreview>;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string | null) => void;
}

function findFileByPath(node: VirtualDirectory, path: string): VirtualFile | null {
  for (const child of node.children) {
    if (child.type === "file" && child.path === path) return child;
    if (child.type === "directory") {
      const found = findFileByPath(child, path);
      if (found) return found;
    }
  }
  return null;
}

function documentationFiles(node: VirtualDirectory): VirtualFile[] {
  return node.children.flatMap((child) => {
    if (child.type === "directory") return documentationFiles(child);
    return child.name === "AGENTS.md" ||
      (child.path.startsWith(".agents/skills/") && child.name === "SKILL.md") ||
      (child.path.startsWith("docs/modules/") && child.extension === "md") ||
      child.path === "docs/cloudflare.md"
      ? [child]
      : [];
  });
}

export function PreviewPanel({ preview, selectedFilePath, onSelectFile }: PreviewPanelProps) {
  const { data, isLoading, error, canRetry, retry } = preview;
  const tree = data?.root ?? null;
  const fileCount = data?.fileCount ?? 0;
  const directoryCount = data?.directoryCount ?? 0;
  const selectedFile = tree && selectedFilePath ? findFileByPath(tree, selectedFilePath) : null;
  const [mobileView, setMobileView] = useState<"tree" | "code">("tree");
  const documentationId = useId();
  const documentation = useMemo(() => (tree ? documentationFiles(tree) : []), [tree]);

  useEffect(() => {
    setMobileView(selectedFilePath ? "code" : "tree");
  }, [selectedFilePath]);

  useEffect(() => {
    if (tree && !isLoading && !error && selectedFilePath && !selectedFile) {
      onSelectFile(null);
    }
  }, [tree, isLoading, error, selectedFilePath, selectedFile, onSelectFile]);

  const handleSelectFile = (file: VirtualFile) => {
    track("preview_file_open", { path: file.path, extension: file.extension });
    onSelectFile(file.path);
    setMobileView("code");
  };

  const handleBackToTree = () => setMobileView("tree");

  if (isLoading && !tree) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex h-full items-center justify-center rounded-[4px] border bg-fd-background"
      >
        <div className="flex items-center gap-2 rounded-[4px] border px-3 py-2 font-mono text-[11px] text-fd-muted-foreground uppercase tracking-[0.08em]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating files for current configuration
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[4px] border bg-fd-background p-4">
        <p
          role="alert"
          className="rounded-[4px] border border-destructive px-3 py-2 font-mono text-[13px] text-destructive"
        >
          {error}
        </p>
        {canRetry && (
          <button
            type="button"
            onClick={retry}
            className="builder-focus-ring rounded border px-3 py-2 text-sm"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="flex h-full items-center justify-center rounded-[4px] border bg-fd-background text-fd-muted-foreground">
        <p className="font-mono text-[13px]">Generating preview...</p>
      </div>
    );
  }

  return (
    <div
      aria-busy={isLoading}
      className="@container flex h-full flex-col overflow-hidden rounded-[4px] border bg-fd-background"
    >
      {/* Stats bar */}
      <div className="@lg:gap-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        {/* Back button when the panel is too narrow for the split view */}
        {mobileView === "code" && selectedFile && (
          <button
            type="button"
            onClick={handleBackToTree}
            className="builder-focus-ring pointer-coarse:py-2 @lg:hidden flex items-center gap-1 py-0.5 font-mono text-[10px] text-fd-muted-foreground uppercase tracking-[0.10em] transition-colors duration-150 hover:text-fd-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Files</span>
          </button>
        )}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-fd-muted-foreground uppercase tracking-[0.10em] tabular-nums",
            mobileView === "code" && "@lg:flex hidden",
          )}
        >
          <FolderTree className="h-3.5 w-3.5" />
          <span>{directoryCount} folders</span>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-fd-muted-foreground uppercase tracking-[0.10em] tabular-nums",
            mobileView === "code" && "@lg:flex hidden",
          )}
        >
          <FileCode2 className="h-3.5 w-3.5" />
          <span>{fileCount} files</span>
        </div>
        <span
          className={cn(
            "@lg:inline-flex hidden font-mono text-[10px] text-fd-muted-foreground uppercase tracking-[0.10em]",
          )}
        >
          Generated from current configuration
        </span>
        {/* Current file name, shown when the tree is hidden */}
        {mobileView === "code" && selectedFile && (
          <span className="@lg:hidden min-w-0 truncate font-mono text-[11px] text-fd-foreground">
            {selectedFile.path.split("/").pop()}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger className="pointer-coarse:py-2 flex items-center gap-1 font-mono text-[10px] text-fd-muted-foreground uppercase tracking-[0.10em] transition-colors duration-150 hover:text-fd-foreground">
              <Info className="h-3.5 w-3.5" />
              <span className="@lg:inline hidden">Preview info</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p>
                Generated by the same template engine as the CLI, including module files, dotfiles
                and agent guidance. Files are not formatted. Database provisioning and addons that
                run external CLIs require CLI execution and are not shown here.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {documentation.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 font-mono text-[11px]">
          <label htmlFor={documentationId} className="shrink-0 text-fd-muted-foreground">
            Guidance & module docs
          </label>
          <select
            id={documentationId}
            className="builder-focus-ring min-w-0 flex-1 rounded border border-fd-border bg-fd-background px-2 py-1"
            value={
              documentation.some((file) => file.path === selectedFilePath)
                ? (selectedFilePath ?? "")
                : ""
            }
            onChange={(event) => {
              const file = documentation.find((file) => file.path === event.target.value);
              if (file) handleSelectFile(file);
            }}
          >
            <option value="" disabled>
              Open generated documentation…
            </option>
            {documentation.map((file) => (
              <option key={file.path} value={file.path}>
                {file.path}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Split view once the panel is wide enough, toggle while it is narrow */}
      <div className="flex flex-1 overflow-hidden">
        {/* File explorer - full width while narrow, fixed rail once split */}
        <div
          className={cn(
            "@lg:border-r shrink-0 overflow-hidden",
            "@lg:w-48 @xl:w-56 @3xl:w-64 w-full",
            mobileView === "code" ? "@lg:block hidden" : "block",
          )}
        >
          <FileExplorer
            root={tree}
            selectedPath={selectedFile?.path || selectedFilePath || null}
            onSelectFile={handleSelectFile}
          />
        </div>

        {/* Code viewer - full width while narrow, right pane once split */}
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden bg-fd-background",
            mobileView === "tree" ? "@lg:block hidden" : "block",
          )}
        >
          {selectedFile ? (
            <CodeViewer
              key={selectedFile.path}
              filePath={selectedFile.path}
              content={selectedFile.content}
              extension={selectedFile.extension}
            />
          ) : (
            <CodeViewerEmpty />
          )}
        </div>
      </div>
    </div>
  );
}
