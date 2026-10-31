export function normalizeOpenAIBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
