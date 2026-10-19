import type { Metadata } from "next";
import { Suspense } from "react";

import { SITE_URL } from "@/lib/site";

import { StackBuilder } from "./_components/stack-builder";

export const metadata: Metadata = {
  title: "Template Builder - xstack",
  description:
    "Compose a product template with feature modules, providers, and deployment options.",
  alternates: {
    canonical: "/new",
  },
  openGraph: {
    title: "Template Builder - xstack",
    description:
      "Compose a product template with feature modules, providers, and deployment options.",
    url: `${SITE_URL}/new`,
    images: [
      {
        url: `${SITE_URL}/og/site/new.png`,
        width: 1200,
        height: 630,
        alt: "xstack Template Builder",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Template Builder - xstack",
    description:
      "Compose a product template with feature modules, providers, and deployment options.",
    images: [`${SITE_URL}/og/site/new.png`],
  },
};

export default function FullScreenStackBuilder() {
  return (
    <Suspense>
      <div className="grid h-[calc(100svh-64px)] w-full flex-1 grid-cols-1 overflow-hidden">
        <StackBuilder />
      </div>
    </Suspense>
  );
}
