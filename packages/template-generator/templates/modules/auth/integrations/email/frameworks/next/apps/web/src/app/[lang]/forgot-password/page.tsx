import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";
import { localePath } from "@/lib/i18n/paths";
import { getTranslator, resolveLocale } from "@/lib/i18n/server";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTranslator(resolveLocale((await params).lang));
  return { title: t("auth.forgot.title") };
}

export default async function ForgotPasswordPage({ params }: Props) {
  const locale = resolveLocale((await params).lang);
  const t = getTranslator(locale);

  return (
    <AuthCard
      title={t("auth.forgot.title")}
      description={t("auth.forgot.subtitle")}
      footer={
        <Link href={localePath(locale, "/login")} className="hover:text-foreground">
          {t("auth.forgot.back")}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
