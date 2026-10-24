import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { localePath } from "@/lib/i18n/paths";
import { getTranslator, resolveLocale } from "@/lib/i18n/server";

type Props = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTranslator(resolveLocale((await params).lang));
  return { title: t("auth.reset.title") };
}

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).lang);
  const t = getTranslator(locale);
  const { token, error } = await searchParams;

  return (
    <AuthCard title={t("auth.reset.title")}>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <p className="text-sm">{t("auth.reset.invalidToken")}</p>
          <Link href={localePath(locale, "/forgot-password")} className="text-sm underline">
            {t("auth.forgot.submit")}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
