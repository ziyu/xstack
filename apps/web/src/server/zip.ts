import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Forward-slash relative path. Directories end with a slash. */
  path: string;
  data: Uint8Array;
  directory?: boolean;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
/** Bit 11: entry names are UTF-8. */
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const STORE_METHOD = 0;
const UNIX_VERSION_MADE_BY = 0x0314;
const FILE_MODE = (0o100644 << 16) >>> 0;
const DIRECTORY_MODE = ((0o40755 << 16) | 0x10) >>> 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
/** Fixed 2020-01-01 00:00:00 so identical stacks produce identical archives. */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const EMPTY = new Uint8Array(0);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`Invalid archive path: ${path}`);
  }
  return normalized;
}

/**
 * Build a ZIP archive in memory. Entries are deflated unless compression would grow them.
 * Stored timestamps are fixed, so the same entries always produce the same bytes.
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > MAX_UINT16) {
    throw new Error("Archive has too many entries for a non-ZIP64 archive.");
  }

  const seen = new Set<string>();
  const sorted = [...entries]
    .map((entry) => ({ ...entry, path: normalizePath(entry.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of sorted) {
    if (seen.has(entry.path)) throw new Error(`Duplicate archive path: ${entry.path}`);
    seen.add(entry.path);

    const name = Buffer.from(entry.path, "utf8");
    const raw = entry.directory ? EMPTY : entry.data;
    const checksum = entry.directory ? 0 : crc32(raw);
    const deflated =
      entry.directory || raw.length === 0 ? EMPTY : deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length > 0 && deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? DEFLATE_METHOD : STORE_METHOD;

    if (offset > MAX_UINT32) throw new Error("Archive exceeds the non-ZIP64 size limit.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(UNIX_VERSION_MADE_BY, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.directory ? DIRECTORY_MODE : FILE_MODE, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const parts = [...localParts, centralDirectory, end];
  const archive = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let position = 0;
  for (const part of parts) {
    archive.set(part, position);
    position += part.length;
  }
  return archive;
}
