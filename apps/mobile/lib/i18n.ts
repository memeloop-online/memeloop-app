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
    loadDetails: string;
    reloadDetails: string;
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
    capabilities: operations => `End-to-end encrypted, read-only access (${operations}).`,
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
    pairInstructions: "Copy the temporary pairing invitation from Desktop and paste it below. Its signature, public key, expiry and PeerId-bound addresses are verified before the pairing request is opened.",
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
    loading: "Loading a bounded conversation window…",
    user: "You",
    agent: "Agent",
    waiting: "Working…",
    loadDetails: "Load details",
    reloadDetails: "Reload details",
    noDetails: "No details available.",
    attachment: filename => `Attachment: ${filename}`,
    detailTruncated: "Only a bounded detail page is displayed.",
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
    operationFailedMessage: "The request could not be completed safely. Try again or review settings.",
    settingsAction: "Open settings",
    couldNotOpen: "Could not open agent chat",
    noReachableDevice: "No reachable agent device",
    connecting: "Connecting securely…",
    initializationFailure: "The authenticated DeviceNetwork session failed. Retry after checking the remote agent and network.",
    noTarget: "Pair a trusted Desktop or CLI with Agent capability, then bring it online.",
    discovering: "Discovering a trusted Agent-capable peer and loading only the latest bounded page.",
    manageDevices: "Manage devices",
    retry: "Retry",
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
    capabilities: operations => `端到端加密，只读访问（${operations}）。`,
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
    pairInstructions: "从桌面端复制临时配对邀请并粘贴到下方。打开配对请求前，会验证签名、公钥、有效期和绑定 PeerId 的地址。",
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
    loading: "正在加载有界对话窗口…",
    user: "你",
    agent: "智能体",
    waiting: "处理中…",
    loadDetails: "加载详情",
    reloadDetails: "重新加载详情",
    noDetails: "没有可用详情。",
    attachment: filename => `附件：${filename}`,
    detailTruncated: "这里只显示有界的详情页面。",
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
    operationFailedMessage: "请求无法安全完成。请重试或检查设置。",
    settingsAction: "打开设置",
    couldNotOpen: "无法打开智能体对话",
    noReachableDevice: "没有可访问的智能体设备",
    connecting: "正在安全连接…",
    initializationFailure: "经过认证的 DeviceNetwork 会话失败。请检查远程智能体和网络后重试。",
    noTarget: "请配对一个受信任且具备智能体能力的桌面端或 CLI，并使其上线。",
    discovering: "正在发现受信任的智能体节点，并仅加载最新的有界页面。",
    manageDevices: "管理设备",
    retry: "重试",
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
    capabilities: operations => `エンドツーエンド暗号化、読み取り専用アクセス（${operations}）。`,
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
    pairInstructions: "デスクトップから一時ペアリング招待をコピーして下に貼り付けてください。ペアリング要求を開く前に、署名・公開鍵・有効期限・PeerId に紐づくアドレスを検証します。",
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
    loading: "有界の会話ウィンドウを読み込み中…",
    user: "あなた",
    agent: "エージェント",
    waiting: "処理中…",
    loadDetails: "詳細を読み込む",
    reloadDetails: "詳細を再読み込み",
    noDetails: "詳細はありません。",
    attachment: filename => `添付：${filename}`,
    detailTruncated: "有界の詳細ページのみ表示しています。",
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
    operationFailedMessage: "要求を安全に完了できませんでした。再試行するか設定を確認してください。",
    settingsAction: "設定を開く",
    couldNotOpen: "エージェントチャットを開けませんでした",
    noReachableDevice: "到達可能なエージェントデバイスがありません",
    connecting: "安全に接続中…",
    initializationFailure: "認証済み DeviceNetwork セッションに失敗しました。リモートエージェントとネットワークを確認して再試行してください。",
    noTarget: "信頼済みでエージェント機能を持つ Desktop または CLI をペアリングしてオンラインにしてください。",
    discovering: "信頼済みのエージェント対応ピアを検出し、最新の有界ページのみを読み込み中です。",
    manageDevices: "デバイスを管理",
    retry: "再試行",
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
