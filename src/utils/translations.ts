/**
 * Translation utility functions for React Native
 * Handles parsing and displaying translations in the format: "Main Text {Translation}"
 */

/**
 * Parse text with translation format: "Main Text {Translation}"
 * Returns an object with mainText and translation
 * @param text - Text that may contain translation in curly braces
 * @returns Object with mainText and translation
 */
export const parseTranslation = (text: string | null | undefined): { mainText: string; translation: string | null } => {
  if (!text || typeof text !== 'string') {
    return { mainText: text || '', translation: null };
  }

  // Match pattern: text {translation}
  const translationRegex = /^(.+?)\s*\{([^}]+)\}\s*$/;
  const match = text.match(translationRegex);

  if (match) {
    return {
      mainText: match[1].trim(),
      translation: match[2].trim()
    };
  }

  return {
    mainText: text.trim(),
    translation: null
  };
};

/**
 * Get main text without translation (for exports, etc.)
 * @param text - Text that may contain translation
 * @returns Main text without translation
 */
export const getMainText = (text: string | null | undefined): string => {
  const parsed = parseTranslation(text);
  return parsed.mainText;
};

/**
 * Format text with translation for display
 * Returns formatted string showing main text and translation if available
 * @param text - Text that may contain translation
 * @param separator - Separator between main and translation (default: " / ")
 * @returns Formatted string
 */
export const formatWithTranslation = (text: string | null | undefined, separator: string = ' / '): string => {
  const { mainText, translation } = parseTranslation(text);
  
  if (!translation) {
    return mainText;
  }
  
  return `${mainText}${separator}${translation}`;
};

