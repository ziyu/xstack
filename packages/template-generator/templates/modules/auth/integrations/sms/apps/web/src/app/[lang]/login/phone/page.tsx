import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import PhoneSignInForm from "@/components/auth/phone-sign-in-form";
import { localePath } from "@/lib/i18n/paths";
import { getTranslator, resolveLocale } from "@/lib/i18n/server";
import { safeNext } from "@/lib/session";

type Props = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ next?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTranslator(resolveLocale((await params).lang));
  return { title: t("auth.phone.title") };
}

export default async function PhoneLoginPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).lang);
  const t = getTranslator(locale);
  const target = safeNext((await searchParams).next, localePath(locale, "/dashboard"));

  return (
    <AuthCard
      title={t("auth.phone.title")}
      description={t("auth.phone.subtitle")}
      footer={
        <Link
          href={{ pathname: localePath(locale, "/login"), query: { next: target } }}
          className="text-foreground underline-offset-4 hover:underline"
        >
          {t("auth.phone.emailLink")}
        </Link>
      }
    >
      <PhoneSignInForm next={target} />
    </AuthCard>
  );
}
