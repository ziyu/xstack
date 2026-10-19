import SideNav from "@/components/side-nav";
import { requireAdmin } from "@/lib/admin";
import { resolveLocale } from "@/lib/i18n/server";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  await requireAdmin(resolveLocale((await params).lang));

  return (
    <div className="container mx-auto flex max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:flex-row">
      <aside className="md:w-48 md:shrink-0">
        <SideNav area="admin" />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
