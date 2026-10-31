/**
 * Small, dependency-free label catalogue for the Expo companion screens.
 *
 * The mobile package intentionally does not pull in a second i18n runtime. The
 * active device locale selects one of the shipped dictionaries and every
 * screen consumes this typed catalogue instead of embedding user-facing text.
 */

export const MOBILE_LOCALES = ["en", "zh-Hans", "ja"] as const;
export type MobileLocale = (typeof MOBILE_LOCALES)[number];

export interface MobileLabels {
  locale: string;
  home: {
    title: string;
    subtitle: string;
    chatTitle: string;
    chatSubtitle: string;
    chatDescription: string;
    nodesTitle: string;
    nodesSubtitle: string;
    nodesDescription: string;
    settingsTitle: string;
    settingsSubtitle: string;
    settingsDescription: string;
  };
  nodes: {
    title: string;
    capabilities: (operations: string) => string;
    statusStarting: string;
    statusError: string;
    verifyDevice: (deviceName: string) => string;
    compareCode: string;
    reject: string;
    codesMatch: string;
    trusted: string;
    untrusted: string;
    online: string;
    nearby: string;
    offline: string;
    unknownReachability: string;
    verifyAccess: string;
    resourceKinds: (count: number) => string;
    forget: string;
    noPairedDesktop: string;
    pairDesktop: string;
    pairDialogTitle: string;
    pairInstructions: string;
    pairingInvitation: string;
    cancel: string;
    connect: string;
    pairFailure: string;
    orchestrationFailure: string;
    deviceActionFailure: string;
  };
  chat: {
    placeholder: string;
    empty: string;
    loading: string;
    user: string;
    agent: string;
    waiting: string;
    completedWork: (steps: number) => string;
    toolGroup: (steps: number) => string;
    toolInput: string;
    toolResult: string;
    toolInputTruncated: string;
    loadDetails: string;
    reloadDetails: string;
    loadMoreDetails: string;
    noDetails: string;
    attachment: (filename: string) => string;
    detailTruncated: string;
    exportFullMessage: string;
    close: string;
    truncatedMessage: (characters: number) => string;
    diagnosticId: (id: string) => string;
    timeline: string;
    turn: (index: number, total: number) => string;
    compacted: (count: number) => string;
    loadEarlier: string;
    loadLater: string;
    seek: string;
    closeTimeline: string;
    newMessages: (count: number) => string;
    moreResponses: (count: number) => string;
    operationFailedTitle: string;
    operationFailedMessage: string;
    settingsAction: string;
    couldNotOpen: string;
    noReachableDevice: string;
    connecting: string;
    initializationFailure: string;
    noTarget: string;
    discovering: string;
    manageDevices: string;
    retry: string;
    chooseConversation: string;
    useAsMain: string;
    prompt: string;
    parameters: string;
    actions: string;
    save: string;
    inspection: {
      tree: string; flat: string; request: string; back: string; earlier: string; later: string;
      loading: string; error: string; empty: string; editSource: string;
      source: (source: 'prompt' | 'system' | 'tool' | 'conversation-message' | 'context-compaction-summary' | 'preview-input') => string;
      role: (role: string) => string;
    };
    copyMessage: string;
    editing: { edit: string; input: string; send: string; discard: string; saveDraft: string; reloadDraft: string; conflict: string; previousBranch: string; nextBranch: string };
    modelParameters: {
      reasoningEffort: string; temperature: string; maxOutputTokens: string; defaultValue: string; unavailable: string;
    };
  };
  settings: {
    title: string;
    deviceNetwork: string;
    deviceIdentity: string;
    deviceIdentityDescription: string;
    nearbyDiscovery: string;
    nearbyDiscoveryDescription: string;
    cloud: string;
    cloudUrl: string;
    notConfigured: string;
    login: string;
    loginDescription: string;
    about: string;
    version: string;
    networkAddress: string;
    peerIdOnly: string;
  };
}

const ENGLISH_LABELS: MobileLabels = {
  locale: "en-US",
  home: {
    title: "MemeLoop Mobile",
    subtitle: "Distributed AI Agent Companion",
    chatTitle: "Agent Chat",
    chatSubtitle: "Start a conversation",
    chatDescription: "Chat with AI agents running on your local network",
    nodesTitle: "Connected Nodes",
    nodesSubtitle: "Manage MemeLoop nodes",
    nodesDescription: "View and connect to MemeLoop nodes on your network",
    settingsTitle: "Settings",
    settingsSubtitle: "Configure your agent",
    settingsDescription: "Provider settings, cloud auth, and node management",
  },
  nodes: {
    title: "Connected Nodes",
    capabilities: () => "Encrypted connections to your paired devices.",
    statusStarting: "Starting secure device network…",
    statusError: "The secure device network is unavailable.",
    verifyDevice: deviceName => `Verify ${deviceName}`,
    compareCode: "Compare this code on both devices",
    reject: "Reject",
    codesMatch: "Codes match",
    trusted: "Trusted",
    untrusted: "Untrusted",
    online: "Online",
    nearby: "Nearby",
    offline: "Offline",
    unknownReachability: "Unknown",
    verifyAccess: "Verify access",
    resourceKinds: count => `${count} resource kinds`,
    forget: "Forget",
    noPairedDesktop: "No paired desktop yet.",
    pairDesktop: "Pair desktop",
    pairDialogTitle: "Pair a desktop",
    pairInstructions: "Copy the pairing invitation from Desktop and paste it below.",
    pairingInvitation: "Pairing invitation",
    cancel: "Cancel",
    connect: "Connect",
    pairFailure: "Could not pair this device.",
    orchestrationFailure: "Secure orchestration check failed.",
    deviceActionFailure: "Device action failed.",
  },
  chat: {
    placeholder: "Message the remote agent",
    empty: "Start a conversation with this agent.",
    loading: "Loading conversation…",
    user: "You",
    agent: "Agent",
    waiting: "Working…",
    completedWork: steps => `Completed work · ${steps} steps`,
    toolGroup: steps => `${steps} tool calls`,
    toolInput: "Command / arguments",
    toolResult: "Result",
    toolInputTruncated: "Arguments exceed the preview limit. Open details for more.",
    loadDetails: "Load details",
    reloadDetails: "Reload details",
    loadMoreDetails: "Load more details",
    noDetails: "No details available.",
    attachment: filename => `Attachment: ${filename}`,
    detailTruncated: "Load more to see the rest.",
    exportFullMessage: "Export complete message",
    close: "Close",
    truncatedMessage: characters => `Message shortened for display (${characters} characters).`,
    diagnosticId: id => `Diagnostic ID: ${id}`,
    timeline: "Conversation timeline",
    turn: (index, total) => `Turn ${index} of ${total}`,
    compacted: count => `${count} compacted messages`,
    loadEarlier: "Load earlier",
    loadLater: "Load later",
    seek: "Open this turn",
    closeTimeline: "Close timeline",
    newMessages: count => `${count} new messages`,
    moreResponses: count => `${count} more responses`,
    operationFailedTitle: "Agent operation failed",
    operationFailedMessage: "The request could not be completed. Try again or review settings.",
    settingsAction: "Open settings",
    couldNotOpen: "Could not open agent chat",
    noReachableDevice: "No reachable agent device",
    connecting: "Connecting securely…",
    initializationFailure: "Check the remote agent and network, or choose a conversation.",
    noTarget: "Pair a trusted Desktop or CLI with Agent capability, then bring it online.",
    discovering: "Finding your agent and loading the conversation.",
    manageDevices: "Manage devices",
    retry: "Retry",
    chooseConversation: "Choose conversation",
    useAsMain: "Use as main conversation",
    prompt: "Prompt",
    parameters: "Model parameters",
    actions: "Conversation actions",
    save: "Save",
    inspection: {
      tree: "Tree", flat: "Messages", request: "Model request", back: "Back", earlier: "Previous", later: "Next",
      loading: "Loading…", error: "Could not load this content. Try again.", empty: "No messages", editSource: "Edit source",
      source: source => ({ prompt: "Instructions", system: "System", tool: "Tools", "conversation-message": "Conversation", "context-compaction-summary": "Conversation summary", "preview-input": "Current message" })[source],
      role: role => ({ user: "You", assistant: "Agent", agent: "Agent", system: "System", tool: "Tool" })[role] ?? role,
    },
    copyMessage: "Copy message",
    editing: { edit: "Edit and branch", input: "Edit message", send: "Send", discard: "Discard", saveDraft: "Save draft", reloadDraft: "Load saved draft", conflict: "This draft changed in another window. Load the saved draft to resolve the conflict.", previousBranch: "Previous history", nextBranch: "Next history" },
    modelParameters: { reasoningEffort: "Reasoning effort", temperature: "Temperature", maxOutputTokens: "Maximum output tokens", defaultValue: "Model default", unavailable: "No adjustable parameters available for this model." },
  },
  settings: {
    title: "Settings",
    deviceNetwork: "Device network",
    deviceIdentity: "Device identity",
    deviceIdentityDescription: "Managed in encrypted device storage",
    nearbyDiscovery: "Nearby discovery",
    nearbyDiscoveryDescription: "Uses authenticated PeerId connections",
    cloud: "Cloud",
    cloudUrl: "Cloud URL",
    notConfigured: "Not configured",
    login: "Login",
    loginDescription: "Sign in to MemeLoop Cloud",
    about: "About",
    version: "Version",
    networkAddress: "Network address",
    peerIdOnly: "PeerId only",
  },
};

const CHINESE_LABELS: MobileLabels = {
  locale: "zh-Hans-CN",
  home: {
    title: "MemeLoop 移动端",
    subtitle: "分布式 AI 智能体伴侣",
    chatTitle: "智能体对话",
    chatSubtitle: "开始对话",
    chatDescription: "与本地网络上运行的 AI 智能体对话",
    nodesTitle: "已连接节点",
    nodesSubtitle: "管理 MemeLoop 节点",
    nodesDescription: "查看并连接网络中的 MemeLoop 节点",
    settingsTitle: "设置",
    settingsSubtitle: "配置智能体",
    settingsDescription: "提供商设置、云端认证和节点管理",
  },
  nodes: {
    title: "已连接节点",
    capabilities: () => "与已配对设备建立加密连接。",
    statusStarting: "正在启动安全设备网络…",
    statusError: "安全设备网络不可用。",
    verifyDevice: deviceName => `验证 ${deviceName}`,
    compareCode: "请在两台设备上比较此验证码",
    reject: "拒绝",
    codesMatch: "验证码匹配",
    trusted: "已信任",
    untrusted: "未信任",
    online: "在线",
    nearby: "附近",
    offline: "离线",
    unknownReachability: "未知",
    verifyAccess: "验证访问权限",
    resourceKinds: count => `${count} 种资源类型`,
    forget: "忘记设备",
    noPairedDesktop: "尚未配对桌面端。",
    pairDesktop: "配对桌面端",
    pairDialogTitle: "配对桌面端",
    pairInstructions: "从桌面端复制配对邀请并粘贴到下方。",
    pairingInvitation: "配对邀请",
    cancel: "取消",
    connect: "连接",
    pairFailure: "无法配对此设备。",
    orchestrationFailure: "安全编排检查失败。",
    deviceActionFailure: "设备操作失败。",
  },
  chat: {
    placeholder: "向远程智能体发送消息",
    empty: "开始与此智能体对话。",
    loading: "正在加载对话…",
    user: "你",
    agent: "智能体",
    waiting: "处理中…",
    completedWork: steps => `已完成 · ${steps} 步`,
    toolGroup: steps => `${steps} 次工具调用`,
    toolInput: "命令 / 参数",
    toolResult: "结果",
    toolInputTruncated: "参数超出预览范围，请打开详情查看。",
    loadDetails: "加载详情",
    reloadDetails: "重新加载详情",
    loadMoreDetails: "加载更多详情",
    noDetails: "没有可用详情。",
    attachment: filename => `附件：${filename}`,
    detailTruncated: "加载更多以查看剩余内容。",
    exportFullMessage: "导出完整消息",
    close: "关闭",
    truncatedMessage: characters => `消息已缩短显示（${characters} 个字符）。`,
    diagnosticId: id => `诊断 ID：${id}`,
    timeline: "对话时间线",
    turn: (index, total) => `第 ${index} / ${total} 轮`,
    compacted: count => `${count} 条已压缩消息`,
    loadEarlier: "加载更早消息",
    loadLater: "加载更晚消息",
    seek: "打开此轮",
    closeTimeline: "关闭时间线",
    newMessages: count => `${count} 条新消息`,
    moreResponses: count => `${count} 条更多回复`,
    operationFailedTitle: "智能体操作失败",
    operationFailedMessage: "请求未能完成。请重试或检查设置。",
    settingsAction: "打开设置",
    couldNotOpen: "无法打开智能体对话",
    noReachableDevice: "没有可访问的智能体设备",
    connecting: "正在安全连接…",
    initializationFailure: "请检查远程智能体和网络，或选择一个对话。",
    noTarget: "请配对一个受信任且具备智能体能力的桌面端或 CLI，并使其上线。",
    discovering: "正在寻找你的智能体并加载对话。",
    manageDevices: "管理设备",
    retry: "重试",
    chooseConversation: "选择对话",
    useAsMain: "设为主对话",
    prompt: "提示词",
    parameters: "模型参数",
    actions: "对话操作",
    save: "保存",
    inspection: {
      tree: "树形视图", flat: "消息列表", request: "模型请求", back: "返回", earlier: "上一页", later: "下一页",
      loading: "加载中…", error: "无法加载此内容，请重试。", empty: "暂无消息", editSource: "编辑来源",
      source: source => ({ prompt: "指令", system: "系统", tool: "工具", "conversation-message": "对话", "context-compaction-summary": "对话摘要", "preview-input": "当前消息" })[source],
      role: role => ({ user: "你", assistant: "智能体", agent: "智能体", system: "系统", tool: "工具" })[role] ?? role,
    },
    copyMessage: "复制消息",
    editing: { edit: "编辑并创建分支", input: "编辑消息", send: "发送", discard: "放弃", saveDraft: "保存草稿", reloadDraft: "载入已保存的草稿", conflict: "草稿已在另一窗口更改。请载入已保存的草稿以解决冲突。", previousBranch: "上一条历史", nextBranch: "下一条历史" },
    modelParameters: { reasoningEffort: "推理强度", temperature: "温度", maxOutputTokens: "最大输出词元数", defaultValue: "模型默认值", unavailable: "此模型没有可调整的参数。" },
  },
  settings: {
    title: "设置",
    deviceNetwork: "设备网络",
    deviceIdentity: "设备身份",
    deviceIdentityDescription: "由加密设备存储管理",
    nearbyDiscovery: "附近发现",
    nearbyDiscoveryDescription: "使用经过认证的 PeerId 连接",
    cloud: "云端",
    cloudUrl: "云端 URL",
    notConfigured: "未配置",
    login: "登录",
    loginDescription: "登录 MemeLoop 云端",
    about: "关于",
    version: "版本",
    networkAddress: "网络地址",
    peerIdOnly: "仅 PeerId",
  },
};

const JAPANESE_LABELS: MobileLabels = {
  locale: "ja-JP",
  home: {
    title: "MemeLoop モバイル",
    subtitle: "分散型 AI エージェントコンパニオン",
    chatTitle: "エージェントチャット",
    chatSubtitle: "会話を開始",
    chatDescription: "ローカルネットワークで動作する AI エージェントと会話",
    nodesTitle: "接続済みノード",
    nodesSubtitle: "MemeLoop ノードを管理",
    nodesDescription: "ネットワーク上の MemeLoop ノードを表示・接続",
    settingsTitle: "設定",
    settingsSubtitle: "エージェントを設定",
    settingsDescription: "プロバイダー設定、クラウド認証、ノード管理",
  },
  nodes: {
    title: "接続済みノード",
    capabilities: () => "ペアリングしたデバイスへの暗号化接続。",
    statusStarting: "安全なデバイスネットワークを起動中…",
    statusError: "安全なデバイスネットワークを利用できません。",
    verifyDevice: deviceName => `${deviceName} を確認`,
    compareCode: "両方のデバイスでこのコードを比較してください",
    reject: "拒否",
    codesMatch: "コードが一致",
    trusted: "信頼済み",
    untrusted: "未信頼",
    online: "オンライン",
    nearby: "近接",
    offline: "オフライン",
    unknownReachability: "不明",
    verifyAccess: "アクセスを確認",
    resourceKinds: count => `${count} 種類のリソース`,
    forget: "削除",
    noPairedDesktop: "ペアリング済みのデスクトップはありません。",
    pairDesktop: "デスクトップをペアリング",
    pairDialogTitle: "デスクトップをペアリング",
    pairInstructions: "デスクトップからペアリング招待をコピーして下に貼り付けてください。",
    pairingInvitation: "ペアリング招待",
    cancel: "キャンセル",
    connect: "接続",
    pairFailure: "このデバイスをペアリングできませんでした。",
    orchestrationFailure: "安全なオーケストレーション確認に失敗しました。",
    deviceActionFailure: "デバイス操作に失敗しました。",
  },
  chat: {
    placeholder: "リモートエージェントにメッセージを送信",
    empty: "このエージェントとの会話を開始します。",
    loading: "会話を読み込み中…",
    user: "あなた",
    agent: "エージェント",
    waiting: "処理中…",
    completedWork: steps => `完了 · ${steps} ステップ`,
    toolGroup: steps => `${steps} 回のツール呼び出し`,
    toolInput: "コマンド / 引数",
    toolResult: "結果",
    toolInputTruncated: "引数がプレビューの上限を超えています。詳細を開いて確認してください。",
    loadDetails: "詳細を読み込む",
    reloadDetails: "詳細を再読み込み",
    loadMoreDetails: "詳細をさらに読み込む",
    noDetails: "詳細はありません。",
    attachment: filename => `添付：${filename}`,
    detailTruncated: "続きを読み込んで残りを表示できます。",
    exportFullMessage: "完全なメッセージをエクスポート",
    close: "閉じる",
    truncatedMessage: characters => `表示用にメッセージを短縮しました（${characters} 文字）。`,
    diagnosticId: id => `診断 ID：${id}`,
    timeline: "会話タイムライン",
    turn: (index, total) => `${index} / ${total} ターン`,
    compacted: count => `${count} 件の圧縮済みメッセージ`,
    loadEarlier: "前のメッセージを読み込む",
    loadLater: "後のメッセージを読み込む",
    seek: "このターンを開く",
    closeTimeline: "タイムラインを閉じる",
    newMessages: count => `${count} 件の新しいメッセージ`,
    moreResponses: count => `${count} 件の追加応答`,
    operationFailedTitle: "エージェント操作に失敗しました",
    operationFailedMessage: "要求を完了できませんでした。再試行するか設定を確認してください。",
    settingsAction: "設定を開く",
    couldNotOpen: "エージェントチャットを開けませんでした",
    noReachableDevice: "到達可能なエージェントデバイスがありません",
    connecting: "安全に接続中…",
    initializationFailure: "リモートエージェントとネットワークを確認するか、会話を選択してください。",
    noTarget: "信頼済みでエージェント機能を持つ Desktop または CLI をペアリングしてオンラインにしてください。",
    discovering: "エージェントを探して会話を読み込み中です。",
    manageDevices: "デバイスを管理",
    retry: "再試行",
    chooseConversation: "会話を選択",
    useAsMain: "メインの会話に設定",
    prompt: "プロンプト",
    parameters: "モデル設定",
    actions: "会話の操作",
    save: "保存",
    inspection: {
      tree: "ツリー", flat: "メッセージ", request: "モデルへのリクエスト", back: "戻る", earlier: "前へ", later: "次へ",
      loading: "読み込み中…", error: "内容を読み込めません。再試行してください。", empty: "メッセージはありません", editSource: "ソースを編集",
      source: source => ({ prompt: "指示", system: "システム", tool: "ツール", "conversation-message": "会話", "context-compaction-summary": "会話の要約", "preview-input": "現在のメッセージ" })[source],
      role: role => ({ user: "あなた", assistant: "エージェント", agent: "エージェント", system: "システム", tool: "ツール" })[role] ?? role,
    },
    copyMessage: "メッセージをコピー",
    editing: { edit: "編集して分岐", input: "メッセージを編集", send: "送信", discard: "破棄", saveDraft: "下書きを保存", reloadDraft: "保存した下書きを読み込む", conflict: "別のウィンドウで下書きが変更されました。保存した下書きを読み込んでください。", previousBranch: "前の履歴", nextBranch: "次の履歴" },
    modelParameters: { reasoningEffort: "推論の強度", temperature: "温度", maxOutputTokens: "最大出力トークン数", defaultValue: "モデルの既定値", unavailable: "このモデルには調整可能なパラメーターがありません。" },
  },
  settings: {
    title: "設定",
    deviceNetwork: "デバイスネットワーク",
    deviceIdentity: "デバイス ID",
    deviceIdentityDescription: "暗号化されたデバイスストレージで管理",
    nearbyDiscovery: "近接検出",
    nearbyDiscoveryDescription: "認証済み PeerId 接続を使用",
    cloud: "クラウド",
    cloudUrl: "クラウド URL",
    notConfigured: "未設定",
    login: "ログイン",
    loginDescription: "MemeLoop クラウドにサインイン",
    about: "情報",
    version: "バージョン",
    networkAddress: "ネットワークアドレス",
    peerIdOnly: "PeerId のみ",
  },
};

export const MOBILE_LABELS: Readonly<Record<MobileLocale, MobileLabels>> = Object.freeze({
  en: ENGLISH_LABELS,
  "zh-Hans": CHINESE_LABELS,
  ja: JAPANESE_LABELS,
});

function deviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

export function resolveMobileLocale(locale = deviceLocale()): MobileLocale {
  const normalized = locale.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-Hans";
  if (normalized.startsWith("ja")) return "ja";
  return "en";
}

export function getMobileLabels(locale?: string): MobileLabels {
  return MOBILE_LABELS[resolveMobileLocale(locale)];
}
