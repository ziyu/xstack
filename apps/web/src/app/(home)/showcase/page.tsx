export const dynamic = "force-static";

import { api } from "@xstack/backend/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";

import { SITE_URL } from "@/lib/site";

import { ShowcasePage } from "./_components/showcase-page";

export const metadata: Metadata = {
  title: "Showcase - xstack",
  description: "Projects created with xstack",
  alternates: {
    canonical: "/showcase",
  },
  openGraph: {
    title: "Showcase - xstack",
    description: "Projects created with xstack",
    url: `${SITE_URL}/showcase`,
    images: [
      {
        url: `${SITE_URL}/og/site/showcase.png`,
        width: 1200,
        height: 630,
        alt: "xstack Showcase",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Showcase - xstack",
    description: "Projects created with xstack",
    images: [`${SITE_URL}/og/site/showcase.png`],
  },
};

export default async function Showcase() {
  const showcaseProjects = await fetchQuery(api.showcase.getShowcaseProjects);
  return <ShowcasePage showcaseProjects={showcaseProjects} />;
}
