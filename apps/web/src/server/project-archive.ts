import type { VirtualDirectory, VirtualFile, VirtualNode } from "@xstack/template-generator";
import { EMBEDDED_BINARY_TEMPLATES } from "@xstack/template-generator/templates-binary";

import { createZip, type ZipEntry } from "./zip";

/** Written by the generator for binary templates; the preview shows this instead of the bytes. */
const BINARY_FILE_MARKER = "[Binary file]";

function fileBytes(file: VirtualFile): Uint8Array | null {
  if (file.content !== BINARY_FILE_MARKER) return Buffer.from(file.content, "utf8");
  if (!file.sourcePath) return null;
  const encoded = EMBEDDED_BINARY_TEMPLATES.get(file.sourcePath);
  if (!encoded) {
    throw new Error(`Missing binary template asset for ${file.path} (${file.sourcePath}).`);
  }
  return Buffer.from(encoded, "base64");
}

/**
 * Package a generated tree as a ZIP archive rooted at `folderName`.
 * Binary template assets are restored from their embedded bytes, matching `writeTree` output.
 */
export function createProjectArchive(
  root: VirtualDirectory,
  folderName: string,
): Uint8Array<ArrayBuffer> {
  const entries: ZipEntry[] = [
    { path: `${folderName}/`, data: new Uint8Array(0), directory: true },
  ];

  const walk = (node: VirtualNode, parent: string) => {
    const path = `${parent}/${node.name}`;
    if (node.type === "directory") {
      entries.push({ path: `${path}/`, data: new Uint8Array(0), directory: true });
      for (const child of node.children) walk(child, path);
      return;
    }
    const data = fileBytes(node);
    if (data) entries.push({ path, data });
  };

  for (const child of root.children) walk(child, folderName);
  return createZip(entries);
}
