/**
 * The app uses `jp` as its Japanese resource key, which is not a BCP-47
 * language tag: `Intl` accepts it structurally but silently formats in the
 * runtime default. Map resource keys to tags Intl actually understands.
 */
const INTL_LOCALES: Record<string, string> = {
  jp: 'ja',
}

export const toIntlLocale = (language: string) => INTL_LOCALES[language] ?? language
