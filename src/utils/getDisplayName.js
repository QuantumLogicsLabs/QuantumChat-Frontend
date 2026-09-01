/**
 * Utility to retrieve the appropriate display name for a user given the active i18n language.
 *
 * For non-Latin scripts (Urdu, Arabic, Persian, Hindi, Chinese, Russian), if a transliteration
 * is available in user.transliteratedNames, it is returned. Otherwise, it falls back to
 * the user's displayName, username, or name.
 *
 * For Latin-script languages (English, Spanish, French, German, Turkish, etc.), the original
 * Latin name is always used.
 *
 * @param {object|string|null} user - The user object or name string
 * @param {string} [currentLang='en'] - The active i18n language code
 * @returns {string} The localized display name
 */

export const NON_LATIN_SCRIPT_LANGS = new Set(['ur', 'ar', 'fa', 'hi', 'zh', 'ru']);

export function getDisplayName(user, currentLang = 'en') {
  if (!user) return '';

  // If user is already a string
  if (typeof user === 'string') {
    return user;
  }

  const langCode = String(currentLang || 'en').trim().toLowerCase().split('-')[0];

  // If active language is a non-Latin script, check for transliterated name
  if (NON_LATIN_SCRIPT_LANGS.has(langCode)) {
    const transliterated = user?.transliteratedNames?.[langCode];
    if (transliterated && typeof transliterated === 'string' && transliterated.trim()) {
      return transliterated.trim();
    }
  }

  // Fallback to original Latin name
  return (
    user.displayName?.trim() ||
    user.username?.trim() ||
    user.name?.trim() ||
    user.title?.trim() ||
    ''
  );
}

export default getDisplayName;
