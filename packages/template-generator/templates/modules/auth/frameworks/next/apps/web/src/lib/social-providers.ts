export const socialProviderLabels = {
  google: "Google",
  github: "GitHub",
} as const;

export type SocialProvider = keyof typeof socialProviderLabels;

export function isSocialProvider(value: string): value is SocialProvider {
  return value in socialProviderLabels;
}
