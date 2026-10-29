import { createMetadata } from "./metadata";
export type { MetadataInput } from "./metadata";

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  alternates?: { languages: Record<string, string> };
};

export function createSeo(config: {
  origin: string;
  locales: readonly string[];
  defaultLocale: string;
}) {
  const { origin, url, metadata } = createMetadata(config);
  const contributors = new Map<string, () => Promise<SitemapEntry[]>>();
  return {
    origin,
    url,
    metadata,
    registerSitemap(name: string, contributor: () => Promise<SitemapEntry[]>) {
      if (contributors.has(name)) throw new Error(`Duplicate sitemap contributor: ${name}`);
      contributors.set(name, contributor);
    },
    async sitemap(): Promise<SitemapEntry[]> {
      const languages = Object.fromEntries(
        config.locales.map((locale) => [locale, url(`/${locale}`)]),
      );
      languages["x-default"] = url(`/${config.defaultLocale}`);
      const home = config.locales.map((locale) => ({
        url: url(`/${locale}`),
        alternates: { languages },
      }));
      return [
        ...home,
        ...(await Promise.all([...contributors.values()].map((load) => load()))).flat(),
      ];
    },
  };
}
export type Seo = ReturnType<typeof createSeo>;
