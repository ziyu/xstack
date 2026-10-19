import type { Metadata } from "next";

import { PasswordForm, ProfileForm } from "@/components/auth/account-forms";
import { getTranslator, resolveLocale } from "@/lib/i18n/server";
import { requireUser } from "@/lib/session";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTranslator(resolveLocale((await params).lang));
  return { title: t("auth.settings.title") };
}

export default async function SettingsPage({ params }: Props) {
  const locale = resolveLocale((await params).lang);
  const t = getTranslator(locale);
  const user = await requireUser(locale);

  return (
    <div className="flex max-w-md flex-col gap-8">
      <h1 className="font-semibold text-2xl">{t("auth.settings.title")}</h1>
      <section className="flex flex-col gap-4">
        <h2 className="font-medium">{t("auth.settings.profile")}</h2>
        <ProfileForm name={user.name} email={user.email} />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="font-medium">{t("auth.settings.password")}</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
