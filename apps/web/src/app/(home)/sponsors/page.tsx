export const dynamic = "force-static";

import { api } from "@xstack/backend/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";

import { SITE_URL } from "@/lib/site";
import { fetchSponsors } from "@/lib/sponsors";

import { SponsorsPage } from "./_components/sponsors-page";

export const metadata: Metadata = {
  title: "Sponsors - xstack",
  description: "The companies and developers funding xstack development",
  alternates: {
    canonical: "/sponsors",
  },
  openGraph: {
    title: "Sponsors - xstack",
    description: "The companies and developers funding xstack development",
    url: `${SITE_URL}/sponsors`,
    images: [
      {
        url: `${SITE_URL}/og/site/sponsors.png`,
        width: 1200,
        height: 630,
        alt: "xstack Sponsors",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sponsors - xstack",
    description: "The companies and developers funding xstack development",
    images: [`${SITE_URL}/og/site/sponsors.png`],
  },
};

export default async function Sponsors() {
  const [sponsorsData, stats] = await Promise.all([
    fetchSponsors(),
    fetchQuery(api.analytics.getStats, {}),
  ]);
  return <SponsorsPage sponsorsData={sponsorsData} totalProjects={stats?.totalProjects ?? 0} />;
}
