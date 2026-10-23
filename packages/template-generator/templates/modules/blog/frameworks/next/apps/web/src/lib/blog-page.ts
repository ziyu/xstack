import { notFound } from "next/navigation";
import { z } from "zod";
export function blogPage(value: string | string[] | undefined) {
  const result = z.coerce.number().int().min(1).max(100_000).safeParse(value ?? 1);
  if (!result.success) notFound();
  return result.data;
}
