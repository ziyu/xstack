import type { Metadata } from "next";

import { localePath } from "@/lib/i18n/paths";
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
      <dl className="grid max-w-xl gap-4 rounded-lg border p-6">
        <div>
          <dt className="text-sm text-muted-foreground">{t("auth.fields.name")}</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("auth.fields.email")}</dt>
          <dd>{user.email}</dd>
        </div>
      </dl>
      <a href={localePath(locale, "/dashboard/settings")} className="text-sm underline">
        {t("auth.settings.title")}
      </a>
    </div>
  );
}
