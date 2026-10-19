export default {
  site: {
    description: "Ship your product faster.",
  },
  nav: {
    home: "Home",
  },
  landing: {
    title: "Build and launch your product in days",
    subtitle:
      "A production-ready foundation: authentication, payments, emails and more, composed from the modules you picked.",
    cta: "Get started",
    secondary: "Go to dashboard",
    features: {
      title: "What's inside",
      modular: {
        title: "Modular by design",
        body: "Every feature lives in its own package and talks to others through typed events.",
      },
      portable: {
        title: "No vendor lock-in",
        body: "Providers sit behind small interfaces. Swap them through configuration.",
      },
      deploy: {
        title: "Deploy anywhere",
        body: "Run it on Vercel, in Docker or on your own servers.",
      },
    },
  },
  footer: {
    rights: "© {year} {name}. All rights reserved.",
  },
} as const;
