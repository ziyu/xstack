/** Catalog declarations are not generated application files. */
export function isApplicationMetadataPath(path: string): boolean {
  return /(?:^|\/)(?:app|adapter)\.json$/.test(path);
}
