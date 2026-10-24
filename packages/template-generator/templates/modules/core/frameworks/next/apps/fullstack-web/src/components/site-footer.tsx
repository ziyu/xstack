"use client";

import Link from "next/link";

import { navigation } from "@/config/navigation";
import { site } from "@/config/site";
import { localePath } from "@/lib/i18n/paths";

import { useLocale, useT } from "./i18n-provider";

export default function SiteFooter() {
  const locale = useLocale();
  const t = useT();

  return (
    <footer className="border-t">
      <div className="container mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
        <p>{t("core.footer.rights", { year: new Date().getFullYear(), name: site.name })}</p>
        {navigation.footer.length > 0 && (
          <nav className="flex flex-wrap gap-4">
            {navigation.footer.map((item) => (
              <Link
                key={item.href}
                href={localePath(locale, item.href)}
                className="hover:text-foreground"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}
