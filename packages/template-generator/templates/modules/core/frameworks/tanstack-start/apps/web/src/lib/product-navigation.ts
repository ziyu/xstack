import { useRouter } from "@tanstack/react-router";
/** Navigation effects shared UI delegates to the hosting framework. */
export function useProductNavigation() {
  const router = useRouter();
  return {
    navigate: (href: string) => {
      void router.navigate({ href });
    },
    refresh: () => {
      void router.invalidate();
    },
  };
}
