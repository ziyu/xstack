export default {
  nav: { ai: "AI 工作室" },
  title: "AI 工作室", subtitle: "思考、想象与创作的私有空间。",
  provider: "服务商", kind: "创作类型", prompt: "提示词", generate: "开始生成", working: "处理中…", history: "生成记录", empty: "从你的第一个想法开始。", notConfigured: "请在服务端配置服务商 API 密钥后开始生成。", cost: "积分", model: "模型", cancel: "取消生成", refresh: "刷新", download: "下载", continue: "继续此对话", newChat: "新建对话", reply: "正在回复所选对话", retry: "重试相同请求", error: "请求暂未完成，请先刷新确认已保存的状态后再重试。",
  kinds: { chat: "对话", image: "图片", video: "视频" },
  statuses: { queued: "排队中", starting: "提交中", running: "生成中", saving: "保存媒体中，可刷新重试", unknown: "服务商结果未知，请联系客服，勿重复提交", completed: "已完成", failed: "失败，已扣积分已退回", cancelled: "已取消，积分已退回" },
  errors: { insufficient_credits: "积分不足，未向服务商提交生成请求。", provider_error: "服务商或存储暂时不可用。", unknown: "服务商可能已接受请求，需客服核对后才能重试或退款。", invalid_request: "请检查提示词与请求。", unsupported: "此服务商不支持该操作。", not_configured: "此服务商未配置。", conflict: "此请求编号已用于其他提示词。", not_found: "未找到生成记录。", busy: "该任务正在处理中。", cancelled: "已取消生成。" },
} as const;
