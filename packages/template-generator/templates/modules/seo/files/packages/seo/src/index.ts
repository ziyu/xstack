export type SitemapEntry = { url: string; lastModified?: Date; alternates?: { languages: Record<string, string> } };
export type MetadataInput = { title: string; description: string; locale: string; path: `/${string}`; translations?: Record<string, string>; image?: string; type?: "website" | "article" };

export function createSeo(config: { origin: string; locales: readonly string[]; defaultLocale: string }) {
  const origin = new URL(config.origin).origin;
  const contributors = new Map<string, () => Promise<SitemapEntry[]>>();
  function url(path: string) {
    const result = new URL(path, origin);
    if (!["http:", "https:"].includes(result.protocol) || result.username || result.password) throw new Error("SEO URLs must be public HTTP(S) URLs without credentials");
    return result.href;
  }
  function metadata(input: MetadataInput) {
    const canonical = url(`/${input.locale}${input.path === "/" ? "" : input.path}`);
    const translations = input.translations ?? Object.fromEntries(config.locales.map((locale) => [locale, `/${locale}${input.path === "/" ? "" : input.path}`]));
    const languages = Object.fromEntries(Object.entries(translations).map(([locale, path]) => [locale, url(path)]));
    if (languages[config.defaultLocale]) languages["x-default"] = languages[config.defaultLocale]!;
    const images = input.image ? [url(input.image)] : undefined;
    return { title: input.title, description: input.description, alternates: { canonical, languages }, openGraph: { title: input.title, description: input.description, url: canonical, locale: input.locale.replaceAll("-", "_"), alternateLocale: Object.keys(translations).filter((locale) => locale !== input.locale).map((locale) => locale.replaceAll("-", "_")), type: input.type ?? "website", images }, twitter: { card: images ? "summary_large_image" as const : "summary" as const, title: input.title, description: input.description, images } };
  }
  return {
    origin, url, metadata,
    registerSitemap(name: string, contributor: () => Promise<SitemapEntry[]>) {
      if (contributors.has(name)) throw new Error(`Duplicate sitemap contributor: ${name}`);
      contributors.set(name, contributor);
    },
    async sitemap(): Promise<SitemapEntry[]> {
      const languages = Object.fromEntries(config.locales.map((locale) => [locale, url(`/${locale}`)]));
      languages["x-default"] = url(`/${config.defaultLocale}`);
      const home = config.locales.map((locale) => ({ url: url(`/${locale}`), alternates: { languages } }));
      return [...home, ...(await Promise.all([...contributors.values()].map((load) => load()))).flat()];
    },
  };
}
export type Seo = ReturnType<typeof createSeo>;
