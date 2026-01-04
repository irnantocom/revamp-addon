# ⚠️ Experimental Models Issue (Gemini 2.5)

## Problem: `gemini-2.5-flash-preview-09-2025` Truncation

### What Happened
```json
{
  "finishReason": "MAX_TOKENS",
  "usageMetadata": {
    "promptTokenCount": 1879,
    "candidatesTokenCount": 80,      // ❌ Only 80 tokens!
    "totalTokenCount": 3875,
    "thoughtsTokenCount": 1916        // ⚠️ Model used 1916 tokens for "thinking"
  }
}
```

**Issue:** 
- Gemini 2.5 experimental models use **internal "thoughts"** (1916 tokens)
- Only 80 tokens left for actual JSON output
- Response truncated mid-word: `"action` (incomplete)

### Root Cause
`maxTokens: 4096` includes:
- Thoughts tokens: 1916
- Output tokens: 80
- Total: ~2000 tokens used, but output severely limited

---

## ✅ Fixes Applied

### 1. **Dynamic maxTokens**
**File:** `src/popup/components/AIChatBox.tsx`

```typescript
options: {
  maxTokens: model.includes('2.5') || model.includes('2.0') ? 8192 : 4096,
  temperature: 0.7,
}
```

- Experimental models (2.0, 2.5): **8192 tokens**
- Stable models (1.5): **4096 tokens**

### 2. **Enhanced Truncation Recovery**
**File:** `src/utils/ai-response-parser.ts`

```typescript
// NEW: Handle truncation in middle of property name (not just strings)
// Example: {"action" → finds last complete object before truncation
if (!inString && jsonString.length > 10) {
  const lastObjectEnd = Math.max(
    jsonString.lastIndexOf('}'),
    jsonString.lastIndexOf(']')
  );
  
  // Truncate at last complete object
  // Recount braces/brackets
  // Close arrays and objects properly
}
```

**Improvement:** Can recover from truncation like:
- `"action` (mid-property)
- `"value": "New` (mid-string)
- `}, {` (mid-array)

### 3. **Better Logging**
**File:** `src/ai/gemini-provider.ts`

```typescript
if (candidate.finishReason === 'MAX_TOKENS') {
  console.warn('[Gemini] Token usage:', data.usageMetadata);
  
  if (data.usageMetadata?.thoughtsTokenCount) {
    console.warn(`Model used ${thoughtsTokenCount} tokens for internal reasoning`);
    console.warn(`Only ${candidatesTokenCount} tokens for output`);
    console.warn('Try using a non-experimental model or increase maxTokens');
  }
}
```

### 4. **User Warning**
**File:** `src/popup/components/AIChatBox.tsx`

```typescript
if (usage.completionTokens < 100) {
  truncationWarning = '\n\n⚠️ Warning: Response may be incomplete (very short output). Try using a non-experimental model.';
}
```

User sees warning in chat if output suspiciously short.

---

## 📊 Token Comparison

| Model | thoughtsTokenCount | candidatesTokenCount | Recommended maxTokens |
|-------|-------------------|---------------------|----------------------|
| `gemini-1.5-flash` | 0 | 2000+ | 4096 ✅ |
| `gemini-1.5-pro` | 0 | 2000+ | 4096 ✅ |
| `gemini-2.0-flash-exp` | ~500 | 1500+ | 8192 ⚠️ |
| `gemini-2.5-flash-preview` | **1916** | **80** | 8192+ ⚠️ |

---

## 🎯 Recommendations

### For Users:
1. **Prefer stable models:**
   - ✅ `gemini-1.5-flash` (fastest, most reliable)
   - ✅ `gemini-1.5-pro` (best for complex tasks)

2. **If using experimental models:**
   - Expect longer response times
   - Check console for `[Gemini] Model used X tokens for internal reasoning`
   - Use simpler prompts (fewer images, shorter descriptions)

3. **If you see truncation:**
   - Switch to `gemini-1.5-flash`
   - Or break request into smaller chunks

### For Developers:
```typescript
// Check for experimental model
if (model.includes('2.5') || model.includes('preview')) {
  maxTokens = 8192;  // Double the tokens
  // Consider warning user about experimental status
}
```

---

## 🧪 Testing

### Test 1: Experimental Model
1. Select `gemini-2.5-flash-preview-09-2025`
2. Send complex request (4+ images)
3. Check console:
   ```
   [Gemini] Token usage: {...}
   [Gemini] Model used 1916 tokens for internal reasoning
   [Gemini] Only 80 tokens for output
   ```
4. ✅ Should see warning in chat
5. ✅ Parser should recover truncated JSON

### Test 2: Stable Model
1. Switch to `gemini-1.5-flash`
2. Same complex request
3. Check console:
   ```
   [Gemini] Token usage: {
     thoughtsTokenCount: undefined,
     candidatesTokenCount: 2500+
   }
   ```
4. ✅ No truncation warning
5. ✅ Complete JSON response

---

## Console Output Examples

### ✅ Success (Stable Model)
```
[Gemini] Extracted text from parts array
[Gemini] Successfully extracted text, length: 3200
[Parser] Parsed successfully
```

### ⚠️ Experimental Model (Recovered)
```
[Gemini] Response truncated at MAX_TOKENS
[Gemini] Model used 1916 tokens for internal reasoning
[Gemini] Only 80 tokens for output
[Gemini] Try using a non-experimental model
[Parser] Truncated outside string context
[Parser] Truncating after last complete object
[Parser] Parsed successfully (recovered)
⚠️ Warning: Response may be incomplete
```

### ❌ Truncation Failed
```
[Parser] All parse attempts failed
Error: Unexpected token } in JSON
```
**Fix:** Reload extension, use stable model

---

## Summary

| Issue | Solution | Impact |
|-------|----------|--------|
| Thoughts consume tokens | Double maxTokens for experimental | ✅ More output space |
| JSON truncated mid-word | Enhanced recovery logic | ✅ Parse partial responses |
| No user feedback | Add warning message | ✅ Better UX |
| Unclear cause | Detailed console logs | ✅ Easier debugging |

**Bottom Line:** Extension now handles experimental models gracefully, but **stable models recommended for production use**.
