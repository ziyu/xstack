export default {
  nav: {
    pricing: "定价",
    billing: "账单",
    orders: "订单",
  },
  plans: {
    starter: {
      name: "入门包",
      description: "一次性购买，快速上手。",
    },
    pro: {
      name: "专业版",
      description: "适合每周都在交付的团队。",
    },
  },
  pricing: {
    title: "简单透明的价格",
    subtitle: "从小规模开始，需要时再升级。",
    per: {
      month: "/ 月",
      year: "/ 年",
    },
    oneTime: "一次性",
    credits: "包含 {credits} 积分",
    subscribe: "订阅",
    buy: "立即购买",
  },
  errors: {
    alreadySubscribed: "你已有生效中的订阅，可在账单页管理。",
    checkout: "暂时无法结账，请稍后再试。",
  },
  billing: {
    title: "账单",
    success: "支付成功，感谢你的支持！",
    subscription: "订阅",
    none: "你还没有生效中的订阅。",
    viewPlans: "查看套餐",
    manage: "管理订阅",
    renewsOn: "将于 {date} 续费",
    endsOn: "将于 {date} 结束",
    history: "支付记录",
    noOrders: "还没有支付记录。",
    status: {
      active: "生效中",
      trialing: "试用中",
      past_due: "逾期",
      canceled: "已取消",
      incomplete: "未完成",
      unpaid: "未支付",
    },
  },
  admin: {
    title: "订单",
    empty: "还没有订单。",
    columns: {
      date: "时间",
      customer: "客户",
      plan: "套餐",
      provider: "渠道",
      status: "状态",
      amount: "金额",
    },
    status: {
      pending: "待支付",
      paid: "已支付",
      failed: "失败",
      refunded: "已退款",
    },
  },
} as const;
