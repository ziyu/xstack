import { defaultLocale, type Locale, locales } from "./config";
import { catalog } from "./messages";
import type { MessageKey, MessageParams, Messages } from "./types";

export { defaultLocale, locales };
export type { Locale, MessageKey, MessageParams, Messages };

export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeNames = {
  en: "English",
  "zh-CN": "简体中文",
} as const satisfies Record<string, string>;

export function isLocale(value: string | undefined): value is Locale {
  return locales.some((locale) => locale === value);
}

export function getMessages(locale: Locale): Messages {
  return catalog[locale];
}

export type Translator = (key: MessageKey, params?: MessageParams) => string;

type MessageTree = { readonly [key: string]: string | MessageTree };

function flatten(tree: MessageTree, prefix: string, out: Map<string, string>) {
  for (const [key, value] of Object.entries(tree)) {
    if (value instanceof Object) flatten(value, `${prefix}${key}.`, out);
    else out.set(`${prefix}${key}`, value);
  }
  return out;
}

export function createTranslator(messages: Messages): Translator {
  const table = flatten(messages, "", new Map());
  return (key, params) => {
    const message = table.get(key) ?? key;
    if (!params) return message;
    return message.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}

/** Picks the best supported locale from an `Accept-Language` header. */
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const requested = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of requested) {
    const exact = locales.find((locale) => locale.toLowerCase() === tag);
    if (exact) return exact;
    const base = locales.find((locale) => locale.toLowerCase().split("-")[0] === tag.split("-")[0]);
    if (base) return base;
  }
  return defaultLocale;
}

/** Resolves the visitor's locale from the locale cookie, then `Accept-Language`. */
export function localeFromHeaders(headers: Headers | undefined): Locale {
  const cookie = headers
    ?.get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  return isLocale(cookie) ? cookie : matchLocale(headers?.get("accept-language"));
}
