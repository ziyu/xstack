export default {
  nav: {
    pricing: "Pricing",
    billing: "Billing",
    orders: "Orders",
  },
  plans: {
    starter: {
      name: "Starter pack",
      description: "A one-time purchase to get going.",
    },
    pro: {
      name: "Pro",
      description: "For teams shipping every week.",
    },
  },
  pricing: {
    title: "Simple, transparent pricing",
    subtitle: "Start small and upgrade when you need more.",
    per: {
      month: "/ month",
      year: "/ year",
    },
    oneTime: "one-time",
    credits: "Includes {credits} credits",
    subscribe: "Subscribe",
    buy: "Buy now",
  },
  errors: {
    alreadySubscribed: "You already have an active subscription. Manage it from Billing.",
    checkout: "Checkout is unavailable right now. Please try again later.",
  },
  billing: {
    title: "Billing",
    success: "Payment received. Thank you!",
    subscription: "Subscription",
    none: "You don't have an active subscription.",
    viewPlans: "View plans",
    manage: "Manage subscription",
    renewsOn: "Renews on {date}",
    endsOn: "Ends on {date}",
    history: "Payment history",
    noOrders: "No payments yet.",
    status: {
      active: "Active",
      trialing: "Trial",
      past_due: "Past due",
      canceled: "Canceled",
      incomplete: "Incomplete",
      unpaid: "Unpaid",
    },
  },
  admin: {
    title: "Orders",
    empty: "No orders yet.",
    columns: {
      date: "Date",
      customer: "Customer",
      plan: "Plan",
      provider: "Provider",
      status: "Status",
      amount: "Amount",
    },
    status: {
      pending: "Pending",
      paid: "Paid",
      failed: "Failed",
      refunded: "Refunded",
    },
  },
} as const;
