import { AuthCard } from "@/components/auth/auth-card";
import { VerificationForm } from "@/components/auth/verification-form";
import { localePath } from "@/lib/i18n/paths";
import { getTranslator, resolveLocale } from "@/lib/i18n/server";
import { safeNext } from "@/lib/session";

export const metadata = { robots: { index: false, follow: false } };

export default async function VerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const locale = resolveLocale((await params).lang);
  const t = getTranslator(locale);
  const next = safeNext((await searchParams).next, localePath(locale, "/dashboard"));
  return (
    <AuthCard
      title={t("auth.verification.title")}
      description={t("auth.verification.subtitle")}
      footer={
        <a href={localePath(locale, "/login")} className="underline">
          {t("auth.forgot.back")}
        </a>
      }
    >
      <VerificationForm next={next} />
    </AuthCard>
  );
}
