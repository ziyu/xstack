import Image from "next/image";

import { cn } from "@/lib/utils";

const lightVariants = {
  "/icons/astro.svg": "/icons/astro-light.svg",
  "/icons/drizzle.svg": "/icons/drizzle-light.svg",
  "/icons/express.svg": "/icons/express-light.svg",
  "/icons/nx.svg": "/icons/nx-light.svg",
  "/icons/planetscale.svg": "/icons/planetscale-light.svg",
  "/icons/prisma.svg": "/icons/prisma-light.svg",
  "/icons/vercel.svg": "/icons/vercel-light.svg",
} satisfies Record<string, string>;

export function TechIcon({
  icon,
  name,
  className,
}: {
  icon: string;
  name: string;
  className?: string;
}) {
  if (!icon) return null;

  if (!icon.startsWith("/") && !/^https?:\/\//.test(icon)) {
    return <span className={cn("inline-flex items-center text-lg", className)}>{icon}</span>;
  }

  const lightIcon = Object.entries(lightVariants).find(([source]) => source === icon)?.[1];
  return (
    <>
      {lightIcon && (
        <Image
          src={lightIcon}
          alt={`${name} icon`}
          width={20}
          height={20}
          className={cn("inline-block shrink-0", className, "dark:hidden")}
          unoptimized
        />
      )}
      <Image
        src={icon}
        alt={`${name} icon`}
        width={20}
        height={20}
        className={cn("inline-block shrink-0", className, lightIcon && "hidden dark:inline-block")}
        unoptimized
      />
    </>
  );
}
