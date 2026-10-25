import { access } from "node:fs/promises";
import path from "node:path";

import { readC2Applications } from "./c2-applications";

/** Legacy fixtures predate applications.json; malformed manifests never fall back. */
export async function productBackendDirectory(project: string): Promise<string> {
  try {
    await access(path.join(project, "applications.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "apps/web";
    throw error;
  }
  return (await readC2Applications(project)).targets.backend.directory;
}
