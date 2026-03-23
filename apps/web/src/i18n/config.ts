export const defaultLocale = "en";
export const locales = ["en", "es", "ja"] as const;
export type Locale = (typeof locales)[number];

/**
 * Load messages for a given locale.
 * Falls back to English if the requested locale is unavailable.
 */
export async function loadMessages(
  locale: Locale
): Promise<Record<string, Record<string, string>>> {
  try {
    const messages = await import(`./messages/${locale}.json`);
    return messages.default as Record<string, Record<string, string>>;
  } catch {
    const fallback = await import("./messages/en.json");
    return fallback.default as Record<string, Record<string, string>>;
  }
}

/**
 * Get a translated string by dotted key path (e.g. "common.dashboard").
 */
export function t(
  messages: Record<string, Record<string, string>>,
  key: string
): string {
  const [namespace, messageKey] = key.split(".");
  if (!(namespace && messageKey)) {
    return key;
  }
  return messages[namespace]?.[messageKey] ?? key;
}
