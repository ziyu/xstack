"use client";

import { Check, Copy, Download, Loader2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { BundledLanguage } from "@/components/ui/kibo-ui/code-block";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
} from "@/components/ui/kibo-ui/code-block";
import { track } from "@/lib/analytics";

interface CodeViewerProps {
  filePath: string;
  content: string;
  extension: string;
}

function hasOwnKey<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(object, key);
}

// Map file extensions to Shiki language IDs
function getLanguage(extension: string): BundledLanguage | null {
  const languageMap = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    mdx: "mdx",
    css: "css",
    scss: "scss",
    html: "html",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    prisma: "prisma",
    graphql: "graphql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    dockerfile: "dockerfile",
    env: "shellscript",
    hbs: "handlebars",
  } satisfies Record<string, BundledLanguage>;
  const normalizedExtension = extension.toLowerCase();
  return hasOwnKey(languageMap, normalizedExtension) ? languageMap[normalizedExtension] : null;
}

export const CodeViewer = memo(function CodeViewer({
  filePath,
  content,
  extension,
}: CodeViewerProps) {
  const language = useMemo(() => getLanguage(extension), [extension]);
  const languageId = language ?? "text";
  const filename = useMemo(() => filePath.split("/").pop() || filePath, [filePath]);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const isBinary = content === "[Binary file]";
  const copyGeneration = useRef(0);

  useEffect(() => {
    setCopyState("idle");
    setActionError(null);
    return () => {
      copyGeneration.current += 1;
    };
  }, [filePath, content]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [copyState]);

  async function copyFile() {
    const generation = ++copyGeneration.current;
    setCopyState("copying");
    setActionError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(content);
      if (generation !== copyGeneration.current) return;
      setCopyState("copied");
      track("preview_file_copy", { path: filePath });
    } catch {
      if (generation !== copyGeneration.current) return;
      setCopyState("idle");
      setActionError(
        "Unable to copy this file. Select and copy its contents manually, or download it.",
      );
    }
  }

  function downloadFile() {
    setActionError(null);
    let url: string | null = null;
    const link = document.createElement("a");
    try {
      url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
    } catch {
      setActionError("Unable to download this file. Copy its contents instead.");
    } finally {
      link.remove();
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }

  const codeData = useMemo(
    () => [
      {
        language: languageId,
        filename,
        code: content,
      },
    ],
    [languageId, filename, content],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-fd-background">
      <CodeBlock
        key={filePath}
        data={codeData}
        defaultValue={languageId}
        className="flex h-full flex-col rounded-[4px] bg-fd-background"
      >
        <CodeBlockHeader>
          <CodeBlockFiles>
            {(item) => (
              <CodeBlockFilename key={item.language} value={item.language}>
                {filePath}
              </CodeBlockFilename>
            )}
          </CodeBlockFiles>
          <button
            type="button"
            aria-label={copyState === "copied" ? "File copied" : "Copy file"}
            title={copyState === "copied" ? "File copied" : "Copy file"}
            disabled={isBinary || copyState === "copying"}
            onClick={copyFile}
            className="builder-focus-ring shrink-0 rounded p-2 text-fd-muted-foreground hover:text-fd-foreground disabled:opacity-50"
          >
            {copyState === "copying" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : copyState === "copied" ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </button>
          <button
            type="button"
            aria-label="Download file"
            title="Download file"
            disabled={isBinary}
            onClick={downloadFile}
            className="builder-focus-ring shrink-0 rounded p-2 text-fd-muted-foreground hover:text-fd-foreground disabled:opacity-50"
          >
            <Download className="size-4" />
          </button>
        </CodeBlockHeader>
        {actionError && (
          <p role="alert" className="border-b px-3 py-2 font-mono text-xs text-destructive">
            {actionError}
          </p>
        )}
        {isBinary && (
          <p className="border-b px-3 py-2 font-mono text-xs text-fd-muted-foreground">
            Binary asset. Run the CLI to generate the original file; this preview only shows its
            location.
          </p>
        )}
        <CodeBlockBody className="flex-1 overflow-auto [&_.shiki]:bg-fd-background! dark:[&_.shiki]:bg-fd-background! bg-fd-background">
          {(item) => (
            <CodeBlockItem key={item.language} value={item.language}>
              <CodeBlockContent
                language={language ?? undefined}
                syntaxHighlighting={language !== null}
                themes={{
                  light: "catppuccin-latte",
                  dark: "catppuccin-mocha",
                }}
                className="bg-fd-background"
              >
                {item.code}
              </CodeBlockContent>
            </CodeBlockItem>
          )}
        </CodeBlockBody>
      </CodeBlock>
    </div>
  );
});

interface EmptyStateProps {
  message?: string;
}

export function CodeViewerEmpty({
  message = "Select a file to view its content",
}: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center text-fd-muted-foreground">
      <p className="font-mono text-[13px] leading-[1.55]">{message}</p>
    </div>
  );
}
