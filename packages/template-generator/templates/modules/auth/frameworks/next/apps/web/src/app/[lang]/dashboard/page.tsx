import type { Metadata } from "next";

import { getTranslator, resolveLocale } from "@/lib/i18n/server";
import { requireUser } from "@/lib/session";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTranslator(resolveLocale((await params).lang));
  return { title: t("auth.dashboard.title") };
}

export default async function DashboardPage({ params }: Props) {
  const locale = resolveLocale((await params).lang);
  const t = getTranslator(locale);
  const user = await requireUser(locale);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-2xl">{t("auth.dashboard.welcome", { name: user.name })}</h1>
      <p className="text-muted-foreground text-sm">{t("auth.dashboard.empty")}</p>
    </div>
  );
}
