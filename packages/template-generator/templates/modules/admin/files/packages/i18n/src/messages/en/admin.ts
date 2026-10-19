export default {
  nav: {
    admin: "Admin",
    overview: "Overview",
    users: "Users",
  },
  overview: {
    title: "Admin overview",
    users: "Users",
    admins: "Admins",
    recent: "Recent sign-ups",
  },
  users: {
    title: "Users",
    search: "Search",
    searchPlaceholder: "Search by email",
    empty: "No users found.",
    columns: {
      name: "Name",
      email: "Email",
      role: "Role",
      status: "Status",
      joined: "Joined",
    },
    status: {
      active: "Active",
      banned: "Banned",
    },
    actions: {
      makeAdmin: "Make admin",
      removeAdmin: "Remove admin",
      ban: "Ban",
      unban: "Unban",
    },
    banReason: "Banned by an administrator",
  },
  pagination: {
    previous: "Previous",
    next: "Next",
    page: "Page {page} of {pages}",
  },
} as const;
