"use client";

import { useRouter } from "next/navigation";

/** Framework adapter consumed by shared product React components. */
export function useProductNavigation() {
  const router = useRouter();
  return {
    navigate: (href: string) => window.location.assign(href),
    refresh: () => router.refresh(),
  };
}
