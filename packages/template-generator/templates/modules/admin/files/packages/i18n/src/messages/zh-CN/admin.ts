export default {
  nav: {
    admin: "后台",
    overview: "概览",
    users: "用户",
  },
  overview: {
    title: "后台概览",
    users: "用户数",
    admins: "管理员",
    recent: "最近注册",
  },
  users: {
    title: "用户管理",
    search: "搜索",
    searchPlaceholder: "按邮箱搜索",
    empty: "没有找到用户。",
    columns: {
      name: "姓名",
      email: "邮箱",
      role: "角色",
      status: "状态",
      joined: "注册时间",
    },
    status: {
      active: "正常",
      banned: "已封禁",
    },
    actions: {
      makeAdmin: "设为管理员",
      removeAdmin: "取消管理员",
      ban: "封禁",
      unban: "解封",
    },
    banReason: "已被管理员封禁",
  },
  pagination: {
    previous: "上一页",
    next: "下一页",
    page: "第 {page} / {pages} 页",
  },
} as const;
