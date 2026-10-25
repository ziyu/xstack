import type { Dirent } from "node:fs";

import { memfs } from "memfs";
import { dirname, extname, normalize, join } from "pathe";

import {
  GeneratorError,
  type GenerationSource,
  type GenerationWrite,
  type VirtualDirectory,
  type VirtualFile,
} from "../types";
import type { JsonValue } from "./json-types";

export interface VirtualFileSystemScope {
  ownsPath: (path: string) => boolean;
  /** Read-only dependencies; never enumerated or returned as generated output. */
  inheritedFiles?: ReadonlyMap<string, string>;
}

export interface VirtualFileSystemOptions {
  trace?: boolean;
  source?: GenerationSource;
}

const UNATTRIBUTED_SOURCE: GenerationSource = { kind: "processor", name: "unattributed" };

function copySource(source: GenerationSource): GenerationSource {
  const result: GenerationSource = { kind: source.kind, name: source.name };
  if (source.app !== undefined) result.app = source.app;
  if (source.owner !== undefined) result.owner = source.owner;
  return result;
}

function copyWrite(write: GenerationWrite): GenerationWrite {
  const result: GenerationWrite = {
    path: write.path,
    operation: write.operation,
    source: copySource(write.source),
  };
  if (write.previousSource) result.previousSource = copySource(write.previousSource);
  return result;
}

export class VirtualFileSystem {
  private _fs: ReturnType<typeof memfs>["fs"];
  private _vol: ReturnType<typeof memfs>["vol"];
  private _sourcePathMap: Map<string, string> = new Map();
  private readonly provenance?: {
    writes: GenerationWrite[];
    latestSources: Map<string, GenerationSource>;
  };
  private source: GenerationSource = UNATTRIBUTED_SOURCE;
  private tracingSuppressed = false;

  constructor(
    private readonly applicationPaths: Readonly<Record<string, string>> = {},
    private readonly scope?: VirtualFileSystemScope,
    options: VirtualFileSystemOptions = {},
  ) {
    const { fs, vol } = memfs();
    this._fs = fs;
    this._vol = vol;
    if (options.trace) {
      this.provenance = { writes: [], latestSources: new Map() };
      if (options.source) this.source = copySource(options.source);
    }
  }

  /** Scopes synchronous writes; nested scopes inherit the current app and owner. */
  withSource<T>(source: GenerationSource, fn: () => T): T {
    if (!this.provenance) return fn();
    const previous = this.source;
    this.source = copySource({ ...previous, ...source });
    try {
      return fn();
    } catch (cause) {
      throw this.sourceError(cause);
    } finally {
      this.source = previous;
    }
  }

  /** Await each scope before starting another independent scope on this filesystem. */
  async withSourceAsync<T>(source: GenerationSource, fn: () => Promise<T>): Promise<T> {
    if (!this.provenance) return fn();
    const previous = this.source;
    this.source = copySource({ ...previous, ...source });
    try {
      return await fn();
    } catch (cause) {
      throw this.sourceError(cause);
    } finally {
      this.source = previous;
    }
  }

  /** Copy an already traced tree without creating synthetic write records. */
  withoutTracing<T>(fn: () => T): T {
    const previous = this.tracingSuppressed;
    this.tracingSuppressed = true;
    try {
      return fn();
    } finally {
      this.tracingSuppressed = previous;
    }
  }

  /** Import physical-path records after copying their files with withoutTracing. */
  importProvenance(records: readonly GenerationWrite[]): void {
    if (!this.provenance) return;
    for (const record of records) {
      const write = copyWrite(record);
      this.provenance.writes.push(write);
      this.provenance.latestSources.set(write.path, write.source);
    }
  }

  getProvenance(): GenerationWrite[] {
    return this.provenance?.writes.map(copyWrite) ?? [];
  }

  private sourceError(cause: unknown): GeneratorError {
    if (GeneratorError.is(cause)) {
      if (cause.source) return cause;
      return new GeneratorError({
        message: cause.message,
        phase: cause.phase,
        cause: cause.cause,
        source: copySource(this.source),
      });
    }
    return new GeneratorError({
      message: cause instanceof Error ? cause.message : String(cause),
      phase: this.source.kind,
      cause,
      source: copySource(this.source),
    });
  }

  private recordWrite(path: string, operation: GenerationWrite["operation"]): void {
    if (!this.provenance || this.tracingSuppressed) return;
    const relativePath = path.replace(/^\/+/, "");
    const previousSource = this.provenance.latestSources.get(relativePath);
    const source = copySource(this.source);
    const write: GenerationWrite = { path: relativePath, operation, source };
    if (previousSource) write.previousSource = previousSource;
    this.provenance.writes.push(write);
    this.provenance.latestSources.set(relativePath, source);
  }

  writeFile(filePath: string, content: string, sourcePath?: string): void {
    this.assertOwnsPath(filePath);
    const path = this.normalizePath(filePath);
    const existed = this.provenance && !this.tracingSuppressed && this._fs.existsSync(path);
    const dir = dirname(path);
    if (dir && dir !== "/" && dir !== ".") {
      this._fs.mkdirSync(dir, { recursive: true });
    }
    this._fs.writeFileSync(path, content, { encoding: "utf-8" });
    if (sourcePath) {
      this._sourcePathMap.set(path, sourcePath);
    } else {
      this._sourcePathMap.delete(path);
    }
    this.recordWrite(path, existed ? "update" : "create");
  }

  readFile(filePath: string): string | undefined {
    try {
      return this._fs.readFileSync(this.normalizePath(filePath), "utf-8") as string;
    } catch {
      return this.scope?.inheritedFiles?.get(this.resolvePath(filePath));
    }
  }

  exists(path: string): boolean {
    try {
      this._fs.statSync(this.normalizePath(path));
      return true;
    } catch {
      return this.scope?.inheritedFiles?.has(this.resolvePath(path)) ?? false;
    }
  }

  fileExists(filePath: string): boolean {
    try {
      return this._fs.statSync(this.normalizePath(filePath)).isFile();
    } catch {
      return this.scope?.inheritedFiles?.has(this.resolvePath(filePath)) ?? false;
    }
  }

  directoryExists(dirPath: string): boolean {
    try {
      return this._fs.statSync(this.normalizePath(dirPath)).isDirectory();
    } catch {
      return false;
    }
  }

  mkdir(dirPath: string): void {
    this.assertOwnsPath(dirPath);
    this._fs.mkdirSync(this.normalizePath(dirPath), { recursive: true });
  }

  deleteFile(filePath: string): boolean {
    this.assertOwnsPath(filePath);
    try {
      const path = this.normalizePath(filePath);
      this._fs.unlinkSync(path);
      this._sourcePathMap.delete(path);
      this.recordWrite(path, "delete");
      return true;
    } catch {
      return false;
    }
  }

  deleteDirectory(dirPath: string): boolean {
    this.assertOwnsPath(dirPath);
    try {
      this._fs.rmdirSync(this.normalizePath(dirPath));
      return true;
    } catch {
      return false;
    }
  }

  listDir(dirPath: string): string[] {
    try {
      return (this._fs.readdirSync(this.normalizePath(dirPath) || "/") as string[]).sort();
    } catch {
      return [];
    }
  }

  readJson<T = unknown>(filePath: string): T | undefined {
    const content = this.readFile(filePath);
    if (!content) return undefined;
    try {
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  writeJson(filePath: string, data: JsonValue, spaces = 2): void {
    this.writeFile(filePath, JSON.stringify(data, null, spaces));
  }

  getAllFiles(): string[] {
    const files: string[] = [];
    this.walkDir("/", files, true);
    return files.sort();
  }

  getAllDirectories(): string[] {
    const dirs: string[] = [];
    this.walkDir("/", dirs, false);
    return dirs.filter((d) => d !== "/").sort();
  }

  getFileCount(): number {
    return this.getAllFiles().length;
  }

  getDirectoryCount(): number {
    return this.getAllDirectories().length;
  }

  toTree(rootName = "project"): VirtualDirectory {
    const root: VirtualDirectory = { type: "directory", path: "", name: rootName, children: [] };
    this.buildTree("/", root);
    this.sortChildren(root);
    return root;
  }

  clear(): void {
    const { fs, vol } = memfs();
    this._fs = fs;
    this._vol = vol;
    this._sourcePathMap.clear();
    this.provenance?.writes.splice(0);
    this.provenance?.latestSources.clear();
  }

  getVolume() {
    return this._vol;
  }
  getFs() {
    return this._fs;
  }

  private walkDir(dir: string, results: string[], filesOnly: boolean): void {
    try {
      for (const entry of this._fs.readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.replace(/^\//, "");
        if (entry.isDirectory()) {
          if (!filesOnly) results.push(relativePath);
          this.walkDir(fullPath, results, filesOnly);
        } else if (entry.isFile() && filesOnly) {
          results.push(relativePath);
        }
      }
    } catch {}
  }

  private buildTree(dir: string, parent: VirtualDirectory): void {
    try {
      for (const entry of this._fs.readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.replace(/^\//, "");
        if (entry.isDirectory()) {
          const dirNode: VirtualDirectory = {
            type: "directory",
            path: relativePath,
            name: entry.name,
            children: [],
          };
          parent.children.push(dirNode);
          this.buildTree(fullPath, dirNode);
        } else if (entry.isFile()) {
          const content = this._fs.readFileSync(fullPath, "utf-8") as string;
          const sourcePath = this._sourcePathMap.get(fullPath);
          const fileNode: VirtualFile = {
            type: "file",
            path: relativePath,
            name: entry.name,
            content,
            extension: extname(entry.name).slice(1),
          };
          if (sourcePath) {
            fileNode.sourcePath = sourcePath;
          }
          parent.children.push(fileNode);
        }
      }
    } catch {}
  }

  private sortChildren(node: VirtualDirectory): void {
    node.children.sort((a, b) => {
      if (a.type === "directory" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.type === "directory") this.sortChildren(child);
    }
  }

  ownsPath(path: string): boolean {
    return this.scope?.ownsPath(this.resolvePath(path)) ?? true;
  }

  private assertOwnsPath(path: string): void {
    if (!this.ownsPath(path)) {
      throw new GeneratorError({
        phase: "ownership",
        message: `Unplanned write to ${this.resolvePath(path)}: this renderer does not own the path`,
        source: this.provenance ? copySource(this.source) : undefined,
      });
    }
  }

  /** Resolve logical contribution paths before filesystem access; enumeration returns physical paths. */
  resolvePath(path: string): string {
    const normalized = normalize(path).replace(/^\/+/, "");
    for (const [logical, actual] of Object.entries(this.applicationPaths)) {
      if (normalized === logical || normalized.startsWith(`${logical}/`)) {
        return actual + normalized.slice(logical.length);
      }
    }
    return normalized;
  }

  private normalizePath(p: string): string {
    return "/" + this.resolvePath(p);
  }
}
