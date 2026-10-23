export default {
  nav: { affiliate: "Referrals" },
  title: "Share the product. Earn credits.",
  policy: "Earn {percent}% of the purchased plan's credits, rounded down, on each referred account's paid checkout. Renewals and free orders are excluded. Rewards are app credits only, never cash.",
  link: "Your personal referral link",
  linkHint: "Share this link. The visitor must accept the invitation before creating a new account. The first valid invitation wins.",
  stats: { signups: "Referred signups", conversions: "Paid conversions", earned: "Credits earned", pending: "Credits pending" },
  history: "Latest 50 conversions",
  empty: "No paid referrals yet. Your completed referrals will appear here.",
  creditUnit: "credits",
  status: { pending: "Awaiting fulfillment", granted: "Credited" },
  refundPolicy: "Refunds and chargebacks do not automatically reverse referral credits. Administrators review them and make an audited credit adjustment. Multi-account abuse is prohibited.",
  invite: {
    eyebrow: "You're invited",
    title: "A personal introduction.",
    description: "Accept this invitation to associate your new account with the person who shared this link. Your inviter may receive app credits if you make a purchase.",
    accept: "Accept invitation and sign up",
  },
  admin: {
    title: "Referral commissions", total: "Recorded conversions: {total}",
    order: "Order", referrer: "Inviter account", customer: "Referred account", credits: "Credits", status: "Status", date: "Created",
    empty: "No referral commissions recorded.",
  },
} as const;
