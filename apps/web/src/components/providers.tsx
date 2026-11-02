"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { Analytics } from "@/components/analytics";
import { Toaster } from "@/components/ui/sonner";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL?.trim() || "http://127.0.0.1:3210",
);

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConvexProvider client={convex}>
        <NuqsAdapter>{children}</NuqsAdapter>
      </ConvexProvider>
      <Analytics />
      <Toaster />
    </>
  );
}
