export default {
  nav: { affiliate: "邀请奖励" },
  title: "分享产品，赚取积分。",
  policy: "受邀账户每次完成付费购买，可获得套餐积分的 {percent}%（向下取整）。续订与免费订单不计奖励。奖励仅为应用积分，不可兑换现金。",
  link: "您的专属邀请链接",
  linkHint: "分享此链接，访客须先接受邀请，再注册新账户。首次有效邀请优先。",
  stats: { signups: "受邀注册", conversions: "付费转化", earned: "已获积分", pending: "待发积分" },
  history: "最近 50 笔转化",
  empty: "暂无付费邀请，完成后的奖励将显示在此处。",
  creditUnit: "积分",
  status: { pending: "待发放", granted: "已入账" },
  refundPolicy: "退款与拒付不会自动撤回邀请积分，管理员须审核并通过可审计的积分调整处理。禁止多账户套利。",
  invite: {
    eyebrow: "您收到一份邀请",
    title: "来自朋友的推荐。",
    description: "接受邀请后，新注册账户将关联此链接的分享者。如果您付费购买，邀请人可能获得应用积分。",
    accept: "接受邀请并注册",
  },
  admin: {
    title: "邀请奖励报表", total: "转化记录：{total}",
    order: "订单", referrer: "邀请人账户", customer: "受邀账户", credits: "积分", status: "状态", date: "创建时间",
    empty: "暂无邀请奖励记录。",
  },
} as const;
