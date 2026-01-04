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
      // Pattern 1: ```json ... ```
      const jsonBlockMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        return this.validateAndParse(jsonBlockMatch[1]);
      }

      // Pattern 2: ``` ... ``` (without json label)
      const codeBlockMatch = rawResponse.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        const content = codeBlockMatch[1].trim();
        if (content.startsWith('{')) {
          return this.validateAndParse(content);
        }
      }

      // Pattern 3: Direct JSON object
      const directJsonMatch = rawResponse.match(/\{[\s\S]*"changes"[\s\S]*\}/);
      if (directJsonMatch) {
        return this.validateAndParse(directJsonMatch[0]);
      }

      // Pattern 4: Legacy single action format (backward compatibility)
      const legacyMatch = rawResponse.match(/\{\s*"action"\s*:/);
      if (legacyMatch) {
        return this.parseLegacyFormat(rawResponse);
      }

      console.warn('[Parser] No valid JSON structure found');
      return null;

    } catch (error) {
      console.error('[Parser] Failed to parse AI response:', error);
      return null;
    }
  }

  /**
   * Validate dan parse JSON string
   */
  private static validateAndParse(jsonString: string): AIRevampResponse | null {
    try {
      // Step 1: Basic cleanup
      let cleaned = jsonString
        // Remove comments
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Remove BOM and zero-width characters
        .replace(/^\uFEFF/, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();

      // Step 2: Fix common structural issues
      cleaned = cleaned
        // Remove trailing commas before closing braces/brackets
        .replace(/,(\s*[}\]])/g, '$1')
        // Fix multiple consecutive commas
        .replace(/,+/g, ',')
        // Remove trailing comma at end
        .replace(/,\s*$/, '');

      // Step 3: Try to parse with progressive fixes
      let parsed;
      
      // Attempt 1: Direct parse
      try {
        parsed = JSON.parse(cleaned);
      } catch (firstError) {
        console.warn('[Parser] First attempt failed, applying string fixes');
        
        // Attempt 2: Fix string values with unescaped characters
        cleaned = this.fixStringValues(cleaned);
        
        try {
          parsed = JSON.parse(cleaned);
        } catch (secondError) {
          console.warn('[Parser] Second attempt failed, trying truncation recovery');
          
          // Attempt 3: Try to find and fix truncated JSON
          cleaned = this.recoverTruncatedJson(cleaned);
          
          try {
            parsed = JSON.parse(cleaned);
          } catch (thirdError) {
            console.error('[Parser] All parse attempts failed');
            throw thirdError;
          }
        }
      }

      // Validate structure
      if (!parsed.changes || !Array.isArray(parsed.changes)) {
        console.warn('[Parser] Missing or invalid "changes" array');
        return null;
      }

      // Ensure each change has required fields
      const validatedChanges: AIChange[] = parsed.changes
        .filter((change: any) => change.action && change.selector)
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
        console.warn('[Parser] No valid changes found');
        return null;
      }

      return {
        success: parsed.success !== false,
        explanation: parsed.explanation || 'AI suggested the following changes',
        changes: validatedChanges,
        warnings: parsed.warnings || [],
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
   * Attempt to recover truncated or malformed JSON
   */
  private static recoverTruncatedJson(jsonString: string): string {
    // Try to find where JSON becomes invalid and truncate there
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;
    let lastValidPos = jsonString.length;
    
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
        inString = !inString;
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
    
    // If we're in an incomplete string, try to close it
    if (inString) {
      // Find the last complete change object
      const lastChangeEnd = jsonString.lastIndexOf('}', lastValidPos);
      if (lastChangeEnd > 0) {
        let truncated = jsonString.substring(0, lastChangeEnd + 1);
        
        // Close the changes array if needed
        if (bracketCount > 0) {
          truncated += '\n]';
          bracketCount--;
        }
        
        // Close the main object if needed
        while (braceCount > 0) {
          truncated += '\n}';
          braceCount--;
        }
        
        return truncated;
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
