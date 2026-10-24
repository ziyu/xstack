"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { type NavArea, navigation } from "@/config/navigation";
import { localePath } from "@/lib/i18n/paths";

import { useLocale, useT } from "./i18n-provider";

export default function SideNav({ area }: { area: Exclude<NavArea, "main" | "footer"> }) {
  const locale = useLocale();
  const t = useT();
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {navigation[area].map((item) => {
        const href = localePath(locale, item.href);
        const active = pathname === href;
        return (
          <Link
            key={item.href}
            href={href}
            className={`px-3 py-2 text-sm transition-colors ${active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
