import { AIRevampResponse, AIChange } from '../types/ai-response';

/**
 * Parse dan validasi AI response
 * Handles berbagai format output dari AI
 */
export class AIResponseParser {
  
  /**
   * Parse raw AI response text ke structured format
   */
  static parse(rawResponse: string): AIRevampResponse | null {
    try {
      // Log first 500 chars for debugging
      console.log('[Parser] Attempting to parse response (first 500 chars):', rawResponse.substring(0, 500));
      
      // Pattern 1: ```json ... ```
      const jsonBlockMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        console.log('[Parser] Found JSON code block with ```json marker');
        return this.validateAndParse(jsonBlockMatch[1]);
      }

      // Pattern 2: ``` ... ``` (without json label)
      const codeBlockMatch = rawResponse.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        const content = codeBlockMatch[1].trim();
        if (content.startsWith('{')) {
          console.log('[Parser] Found code block with JSON content');
          return this.validateAndParse(content);
        }
      }

      // Pattern 3: Direct JSON object
      const directJsonMatch = rawResponse.match(/\{[\s\S]*"changes"[\s\S]*\}/);
      if (directJsonMatch) {
        console.log('[Parser] Found direct JSON object');
        return this.validateAndParse(directJsonMatch[0]);
      }

      // Pattern 4: Legacy single action format (backward compatibility)
      const legacyMatch = rawResponse.match(/\{\s*"action"\s*:/);
      if (legacyMatch) {
        console.log('[Parser] Found legacy single action format');
        return this.parseLegacyFormat(rawResponse);
      }

      console.warn('[Parser] No valid JSON structure found in response');
      console.warn('[Parser] Response preview:', rawResponse.substring(0, 1000));
      return null;

    } catch (error) {
      console.error('[Parser] Failed to parse AI response:', error);
      console.error('[Parser] Response was:', rawResponse.substring(0, 500));
      return null;
    }
  }

  /**
   * Parse AI-produced JSON text, tolerating comments, trailing commas,
   * unescaped characters and truncated output. Throws if unrecoverable.
   */
  static parseLooseJson(jsonString: string): { parsed: any; truncatedChangeIds: string[] } {
      // Step 1: Basic cleanup
      let cleaned = jsonString
        // Remove BOM and zero-width characters first
        .replace(/^\uFEFF/, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Remove block comments (/* ... */)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Remove line comments (//) but ONLY if not preceded by : or http/https
        // This preserves URLs like "https://example.com" while removing actual comments
        .replace(/(?<!:)\/\/(?!\/)[^\n]*/g, '')
        .trim();
      // console.log(jsonString);
      // console.log('[Parser] Cleaned JSON string :', cleaned);
      // Step 2: Aggressive trailing comma removal
      // This handles commas before }, ], or end of line that precedes closing bracket
      cleaned = cleaned
        // Remove trailing commas before } or ]
        .replace(/,(\s*[}\]])/g, '$1')
        // Remove trailing comma at end of line (common AI mistake)
        .replace(/,(\s*\n\s*[}\]])/g, '$1')
        // Remove trailing comma after string values
        .replace(/("(?:[^"\\]|\\.)*"),(\s*\n?\s*[}\]])/g, '$1$2')
        // Fix multiple consecutive commas
        .replace(/,+/g, ',')
        // Remove trailing comma at very end
        .replace(/,\s*$/, '');
      // console.log('[Parser] Cleaned JSON string :', cleaned);
      // Step 2.5: Fix truncated URLs FIRST (before string value fixes)
      // This must run early because control characters cause parse errors
      const urlFixResult = this.fixTruncatedUrls(cleaned);
      //console.log('urlFixResult:', urlFixResult);
      cleaned = urlFixResult.fixed;
      const truncatedChangeIds = urlFixResult.truncatedIds;

      // Step 3: Try to parse with progressive fixes
      let parsed;
      
      // Attempt 1: Direct parse
      try {
        parsed = JSON.parse(cleaned);
      } catch (firstError) {
        console.warn('[Parser] First attempt failed, applying string fixes');
        console.warn('[Parser] Error was:', firstError);
        
        // Attempt 2: Fix string values with unescaped characters
        cleaned = this.fixStringValues(cleaned);
        
        // Extra aggressive trailing comma removal after string fixes
        cleaned = cleaned.replace(/,(\s*\n?\s*[}\]])/g, '$1');
        
        try {
          parsed = JSON.parse(cleaned);
        } catch (secondError) {
          console.warn('[Parser] Second attempt failed, trying truncation recovery');
          console.warn('[Parser] Error was:', secondError);
          
          // Attempt 3: Try to find and fix truncated JSON
          cleaned = this.recoverTruncatedJson(cleaned);
          
          try {
            parsed = JSON.parse(cleaned);
          } catch (thirdError) {
            console.error('[Parser] All parse attempts failed');
            console.error('[Parser] Final cleaned JSON (first 1000 chars):', cleaned.substring(0, 1000));
            throw thirdError;
          }
        }
      }

    return { parsed, truncatedChangeIds: truncatedChangeIds };
  }

  /**
   * Pull the JSON text out of a raw AI response (code fence or bare object)
   */
  static extractJsonText(rawResponse: string): string | null {
    const jsonBlock = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlock) return jsonBlock[1];

    const codeBlock = rawResponse.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlock && codeBlock[1].trim().startsWith('{')) return codeBlock[1].trim();

    // Unterminated fence (truncated output): take everything after the opening fence
    const openFence = rawResponse.match(/```(?:json)?\s*(\{[\s\S]*)$/);
    if (openFence) return openFence[1];

    const firstBrace = rawResponse.indexOf('{');
    const lastBrace = rawResponse.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) return rawResponse.substring(firstBrace, lastBrace + 1);

    return null;
  }

  /**
   * Validate dan parse JSON string
   */
  private static validateAndParse(jsonString: string): AIRevampResponse | null {
    try {
      const { parsed, truncatedChangeIds } = this.parseLooseJson(jsonString);

      // Validate structure
      if (!parsed.changes || !Array.isArray(parsed.changes)) {
        console.warn('[Parser] Missing or invalid "changes" array');
        return null;
      }
      // console.log(parsed.changes);
      // Ensure each change has required fields
      const validatedChanges: AIChange[] = parsed.changes
        .filter((change: any) => {
          // Only filter out changes with severely truncated URLs (protocol only)
          if (truncatedChangeIds.includes(change.id)) {
            console.warn(`[Parser] Skipping change "${change.id}" - URL severely truncated (protocol only)`);
            return false;
          }
          
          // Filter out changes with placeholder URLs
          if (change.value === 'https://placeholder.invalid') {
            console.warn(`[Parser] Skipping change "${change.id}" - contains placeholder URL`);
            return false;
          }
          
          // Ensure minimum required fields
          if (!change.action || !change.selector) {
            console.warn(`[Parser] Skipping change "${change.id}" - missing action or selector`);
            return false;
          }
          
          return true;
        })
        .map((change: any, index: number) => ({
          id: change.id || `change-${Date.now()}-${index}`,
          action: change.action,
          selector: change.selector,
          value: change.value,
          attribute: change.attribute,
          position: change.position,
          explanation: change.explanation || 'No explanation provided',
          preview: change.preview
        }));

      if (validatedChanges.length === 0) {
        console.warn('[Parser] No valid changes found after filtering');
        return null;
      }

      const skippedCount = parsed.changes.length - validatedChanges.length;
      const warnings = parsed.warnings || [];
      
      if (skippedCount > 0) {
        warnings.push(`${skippedCount} change(s) skipped due to severely truncated URLs (protocol only). Other partial URLs are kept and may still work.`);
        console.warn(`[Parser] Skipped ${skippedCount} changes with severely truncated data`);
      }

      return {
        success: parsed.success !== false,
        explanation: parsed.explanation || 'AI suggested the following changes',
        changes: validatedChanges,
        warnings,
        estimatedImpact: parsed.estimatedImpact || 'medium'
      };

    } catch (error) {
      console.error('[Parser] JSON validation failed:', error);
      console.error('[Parser] Problematic JSON string (first 500 chars):', jsonString.substring(0, 500));
      
      // Try to provide helpful error context
      if (error instanceof SyntaxError) {
        const match = error.message.match(/position (\d+)/);
        if (match) {
          const pos = parseInt(match[1]);
          const context = jsonString.substring(Math.max(0, pos - 50), Math.min(jsonString.length, pos + 50));
          console.error('[Parser] Error context around position', pos, ':', context);
        }
      }
      
      return null;
    }
  }

  /**
   * Fix string values that may contain unescaped characters
   */
  private static fixStringValues(jsonString: string): string {
    let result = jsonString;
    
    // Fix unescaped newlines within string values
    result = result.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
      // Already properly escaped, return as is
      if (!content.includes('\n') && !content.includes('\r') && !content.includes('\t')) {
        return match;
      }
      // Escape newlines and other control chars
      const fixed = content
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `"${fixed}"`;
    });
    
    // Fix single quotes around property names and values
    result = result.replace(/:\s*'([^']*)'/g, ': "$1"');
    result = result.replace(/{\s*'([^']*)'\s*:/g, '{ "$1":');
    
    return result;
  }

  /**
   * Fix truncated URLs in JSON (common with MAX_TOKENS)
   * Pattern: "value": "https://very-long-url (no closing quote)
   * Returns: [fixed JSON string, array of severely truncated change IDs]
   */
  private static fixTruncatedUrls(jsonString: string): { fixed: string; truncatedIds: string[] } {
    console.log('[Parser] Checking for truncated URLs');
    
    let result = jsonString;
    const truncatedIds: string[] = [];
    let foundTruncated = false;
    
    // Pattern 1: VERY short truncated URLs like "https:\n or "http:\n (ONLY protocol)
    // These are severely truncated - mark for removal
    // IMPORTANT: Only match if protocol is NOT followed by // (which means URL continues)
    const veryShortUrlPattern = /"id":\s*"([^"]+)"[^}]*?"(value|src|href)":\s*"(https?:)(?!\/\/)[\s"',\n]/g;
    let match;
    while ((match = veryShortUrlPattern.exec(jsonString)) !== null) {
      const changeId = match[1];
      console.log(`[Parser] Found severely truncated URL in change "${changeId}" (only protocol) - will skip`);
      truncatedIds.push(changeId);
      foundTruncated = true;
    }
    
    // Fix syntax for very short URLs (close string properly)
    // Only fix if protocol is NOT followed by //
    // console.log(result);
    result = result.replace(/"(value|src|href)":\s*"(https?:)(?!\/\/)[\s"',\n]/g, '"$1": "https://placeholder.invalid",\n');
    
    // Pattern 2: URL ending abruptly (no closing quote at end of string)
    // Keep partial URL as-is - might still be useful
    const endUrlPattern = /"(value|src|href)":\s*"(https?:\/\/[^"\n]*?)$/gm;
    result = result.replace(endUrlPattern, (_match, prop, url) => {
      console.log(`[Parser] Fixed incomplete URL in "${prop}":`, url.substring(0, 60), '(keeping partial URL)');
      foundTruncated = true;
      return `"${prop}": "${url}"`;
    });
    
    // Pattern 3: URL with newline in middle (control character issue)
    // Keep partial URL - don't add markers
    const newlineUrlPattern = /"(value|src|href)":\s*"(https?:\/\/[^"\n]*?)\n\s*"(\w+)":/g;
    result = result.replace(newlineUrlPattern, (_match, prop, url, nextProp) => {
      console.log(`[Parser] Fixed URL with newline in "${prop}" (keeping partial URL)`);
      foundTruncated = true;
      return `"${prop}": "${url}",\n      "${nextProp}":`;
    });
    
    // Pattern 4: URL followed by unescaped newline and property name
    const controlCharPattern = /"(value|src|href)":\s*"([^"]*?)\n\s+"(\w+)":/g;
    result = result.replace(controlCharPattern, (_match, prop, partialUrl, nextProp) => {
      console.log(`[Parser] Fixed control char in "${prop}"`);
      foundTruncated = true;
      // Only use placeholder if URL is VERY short (just protocol)
      // console.log('[Parser] Partial URL was:', partialUrl);
      const fixedUrl = partialUrl.match(/^https?:$/) ? 'https://placeholder.invalid' : partialUrl;
      // console.log('[Parser] Using fixed URL:', fixedUrl);
      return `"${prop}": "${fixedUrl}",\n      "${nextProp}":`;
    });
    
    if (foundTruncated) {
      console.log('[Parser] ✓ Fixed URL syntax issues, marked', truncatedIds.length, 'severely truncated for removal');
    }
    
    return { fixed: result, truncatedIds };
  }

  /**
   * Attempt to recover truncated or malformed JSON
   */
  private static recoverTruncatedJson(jsonString: string): string {
    console.log('[Parser] Attempting recovery for truncated JSON');
    
    // Try to find where JSON becomes invalid and truncate there
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    let lastValidPos = jsonString.length;
    let lastStringStart = -1;
    
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        if (inString) {
          inString = false;
          lastStringStart = -1;
        } else {
          inString = true;
          lastStringStart = i;
        }
        continue;
      }
      
      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
        
        // If we have balanced braces and brackets, mark this as valid position
        if (braceCount === 0 && bracketCount === 0) {
          lastValidPos = i + 1;
        }
        
        // If counts go negative, JSON is malformed
        if (braceCount < 0 || bracketCount < 0) {
          break;
        }
      }
    }
    
    // If we're in an incomplete string, close it and truncate
    if (inString && lastStringStart > 0) {
      console.log('[Parser] Found incomplete string at position', lastStringStart);
      
      // Find the last comma before this incomplete string
      let truncatePos = lastStringStart;
      while (truncatePos > 0 && jsonString[truncatePos] !== ',') {
        truncatePos--;
      }
      
      // If we found a comma, truncate there
      if (truncatePos > 0) {
        let result = jsonString.substring(0, truncatePos);
        console.log('[Parser] Truncating at comma position', truncatePos);
        
        // Close the changes array if needed
        if (bracketCount > 0) {
          result += '\n]';
          bracketCount--;
        }
        
        // Close the main object if needed
        while (braceCount > 0) {
          result += '\n}';
          braceCount--;
        }
        
        return result;
      }
    }
    
    // NEW: Handle truncation in middle of property name or value (no string open)
    // This happens when response ends abruptly like: "action
    if (!inString && jsonString.length > 10) {
      console.log('[Parser] Truncated outside string context');
      
      // Find last complete object (last '}' or ']')
      const lastObjectEnd = Math.max(
        jsonString.lastIndexOf('}'),
        jsonString.lastIndexOf(']')
      );
      
      if (lastObjectEnd > 0) {
        // Check if this is inside changes array
        const beforeLastObject = jsonString.substring(0, lastObjectEnd + 1);
        const commaAfterObject = jsonString.indexOf(',', lastObjectEnd);
        
        // If there's a comma after last complete object, we're in middle of next object
        // Truncate at the last complete object
        if (commaAfterObject > lastObjectEnd || jsonString.substring(lastObjectEnd + 1).includes('{')) {
          let result = beforeLastObject;
          console.log('[Parser] Truncating after last complete object at position', lastObjectEnd);
          
          // Recount braces/brackets in truncated string
          let newBraceCount = 0;
          let newBracketCount = 0;
          let stringOpen = false;
          let escaped = false;
          
          for (let i = 0; i < result.length; i++) {
            const c = result[i];
            if (escaped) {
              escaped = false;
              continue;
            }
            if (c === '\\') {
              escaped = true;
              continue;
            }
            if (c === '"') {
              stringOpen = !stringOpen;
              continue;
            }
            if (!stringOpen) {
              if (c === '{') newBraceCount++;
              if (c === '}') newBraceCount--;
              if (c === '[') newBracketCount++;
              if (c === ']') newBracketCount--;
            }
          }
          
          // Close arrays and objects as needed
          while (newBracketCount > 0) {
            result += '\n]';
            newBracketCount--;
          }
          
          while (newBraceCount > 0) {
            result += '\n}';
            newBraceCount--;
          }
          
          return result;
        }
      }
    }
    
    // If we have unclosed braces/brackets, try to close them
    let result = jsonString.substring(0, lastValidPos);
    
    while (bracketCount > 0) {
      result += ']';
      bracketCount--;
    }
    
    while (braceCount > 0) {
      result += '}';
      braceCount--;
    }
    
    return result;
  }

  /**
   * Parse legacy single-action format untuk backward compatibility
   */
  private static parseLegacyFormat(rawResponse: string): AIRevampResponse | null {
    try {
      const actionMatch = rawResponse.match(/\{\s*"action"\s*:\s*"(\w+)"[\s\S]*?\}/);
      if (!actionMatch) return null;

      const parsed = JSON.parse(actionMatch[0]);
      
      return {
        success: true,
        explanation: 'Single change detected',
        changes: [{
          id: `legacy-${Date.now()}`,
          action: parsed.action,
          selector: parsed.selector || 'body',
          value: parsed.value,
          attribute: parsed.attribute,
          explanation: 'Legacy format change'
        }],
        warnings: ['Using legacy single-action format'],
        estimatedImpact: 'medium'
      };

    } catch {
      return null;
    }
  }

  /**
   * Extract explanation text dari response (sebelum JSON)
   */
  static extractExplanation(rawResponse: string): string {
    const beforeJson = rawResponse.split('```')[0].trim();
    return beforeJson || 'AI is processing your request...';
  }
}
