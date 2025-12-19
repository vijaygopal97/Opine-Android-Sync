/**
 * Translation utility functions for React Native
 * Handles parsing and displaying translations in formats:
 * - Single: "Main Text {Translation}"
 * - Multiple: "Main Text {Translation1{Translation2{Translation3}}}"
 */

/**
 * Parse text with nested translation format: "Main Text {Translation1{Translation2{Translation3}}}"
 * Returns an array of languages extracted from nested braces
 * @param text - Text that may contain nested translations in curly braces
 * @returns Array of language texts, first is main text
 */
export const parseMultiTranslation = (text: string | null | undefined): string[] => {
  // Handle null, undefined, or non-string values
  if (!text) {
    return [''];
  }
  
  if (typeof text !== 'string') {
    // Convert to string if it's not already
    try {
      text = String(text);
    } catch (error) {
      return [''];
    }
  }

  // Handle empty string
  if (text.trim().length === 0) {
    return [''];
  }

  const languages: string[] = [];
  let remaining = text.trim();
  
  // Recursively extract languages from nested braces
  while (remaining.length > 0) {
    // Find the first opening brace
    const openBraceIndex = remaining.indexOf('{');
    
    if (openBraceIndex === -1) {
      // No more braces, add remaining text as a language
      if (remaining.trim()) {
        languages.push(remaining.trim());
      }
      break;
    }
    
    // Extract text before the brace as a language
    const beforeBrace = remaining.substring(0, openBraceIndex).trim();
    if (beforeBrace) {
      languages.push(beforeBrace);
    }
    
    // Find matching closing brace (handle nested braces)
    let braceCount = 0;
    let closeBraceIndex = -1;
    
    for (let i = openBraceIndex; i < remaining.length; i++) {
      if (remaining[i] === '{') {
        braceCount++;
      } else if (remaining[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          closeBraceIndex = i;
          break;
        }
      }
    }
    
    if (closeBraceIndex === -1) {
      // No matching closing brace, treat rest as text
      const restText = remaining.substring(openBraceIndex + 1).trim();
      if (restText) {
        languages.push(restText);
      }
      break;
    }
    
    // Extract content inside braces (may contain nested translations)
    const insideBraces = remaining.substring(openBraceIndex + 1, closeBraceIndex);
    
    // Recursively parse nested translations
    const nestedLanguages = parseMultiTranslation(insideBraces);
    if (nestedLanguages && Array.isArray(nestedLanguages) && nestedLanguages.length > 0) {
      languages.push(...nestedLanguages);
    }
    
    // Continue with text after closing brace
    remaining = remaining.substring(closeBraceIndex + 1).trim();
  }
  
  // If no languages found, return original text
  if (languages.length === 0) {
    return [text.trim()];
  }
  
  return languages;
};

/**
 * Parse text with translation format: "Main Text {Translation}"
 * Returns an object with mainText and translation (for backward compatibility)
 * @param text - Text that may contain translation in curly braces
 * @returns Object with mainText and translation
 */
export const parseTranslation = (text: string | null | undefined): { mainText: string; translation: string | null } => {
  const languages = parseMultiTranslation(text);

  return {
    mainText: languages[0] || '',
    translation: languages.length > 1 ? languages[1] : null
  };
};

/**
 * Get main text without translation (for exports, conditional logic, etc.)
 * Always returns the first language (main text)
 * @param text - Text that may contain translation
 * @returns Main text without translation
 */
export const getMainText = (text: string | null | undefined): string => {
  const languages = parseMultiTranslation(text);
  return languages[0] || '';
};

/**
 * Get text for a specific language index
 * @param text - Text that may contain multiple translations
 * @param languageIndex - Index of language (0 = main, 1 = first translation, etc.)
 * @returns Text for the specified language, or main text if index out of range
 */
export const getLanguageText = (text: string | null | undefined, languageIndex: number = 0): string => {
  try {
    if (languageIndex < 0) {
      languageIndex = 0;
    }
    const languages = parseMultiTranslation(text);
    if (languages && Array.isArray(languages) && languages.length > 0) {
      if (languageIndex >= 0 && languageIndex < languages.length) {
        return languages[languageIndex] || '';
      }
      return languages[0] || '';
    }
    return '';
  } catch (error) {
    console.warn('Error getting language text:', error);
    return text || '';
  }
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



