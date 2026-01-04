# Page-Level Transformation Feature

## Overview

The AI Chat now supports **two modes of operation**:

1. **Element-Level Editing** - Targeted changes to a specific selected element
2. **Page-Level Transformation** - Global changes across the entire page or multiple elements

## How It Works

### MODE 1: Element-Level Editing

**When:** An element is selected using the Inspector

**Behavior:**
- AI focuses only on the selected element
- Changes are minimal and targeted
- Suggestions apply to a single element

**Example prompts:**
- "Change this heading to blue"
- "Make this button larger"
- "Change the image source to example.jpg"

**AI Output:**
```json
{"action": "css", "value": {"color": "blue"}}
```

---

### MODE 2: Page-Level Transformation

**When:** No element is selected

**Behavior:**
- AI analyzes the entire page structure
- Suggests changes that apply to multiple elements
- Can modify layout, typography, colors, spacing

**Example prompts:**
- "Make the page more modern and corporate"
- "Change all headings to use Inter font"
- "Add more spacing between sections"
- "Make all paragraphs darker"

**AI Output with custom selector:**
```json
{
  "action": "css",
  "selector": "body, p, h1, h2, h3",
  "value": {
    "font-family": "Inter, sans-serif",
    "line-height": "1.6",
    "color": "#1a1a1a"
  }
}
```

---

## Supported Actions

### 1. Text Changes (Element-level only)
```json
{"action": "text", "value": "New text content"}
```

### 2. CSS Changes (Element or Page-wide)
```json
{"action": "css", "value": {"color": "blue", "font-size": "18px"}}
```

With custom selector (page-wide):
```json
{
  "action": "css",
  "selector": "body, p, h1, h2",
  "value": {"color": "#1a1a1a"}
}
```

### 3. HTML Changes
```json
{"action": "html", "value": "<div>New HTML content</div>"}
```

### 4. Attribute Changes
```json
{"action": "attribute", "attribute": "src", "value": "new-image.jpg"}
```

### 5. Script Injection (Use sparingly)
```json
{"action": "script", "value": "console.log('Applied');"}
```

---

## Implementation Details

### Frontend (AIChatBox.tsx)

**System Prompt:**
- Adaptive based on whether an element is selected
- Instructs AI to decide between element-level and page-level mode
- Provides clear action format guidelines

**Apply Button:**
- Shows for all AI suggestions with actions (not just when element is selected)
- Indicates scope: "(Element)", "(Page)", or "(Page-wide)"
- Displays target selector in tooltip

**Element Context:**
- Only sent when element is selected
- Includes selector, tag, text, styles, attributes
- Empty when no selection

### Backend (content-script.ts)

**applyAIChange() method:**
- Supports `action: 'script'` for JavaScript execution
- Handles multiple element selection via `querySelectorAll`
- Applies changes to all matching elements
- Returns applied count in response

**Selector Resolution:**
- If selector contains `,` or type is `css-path`: uses `querySelectorAll`
- Otherwise: uses single element resolution
- Falls back gracefully if no elements found

---

## User Experience

### Visual Indicators

**Selected Element Banner:**
```
✓ Ready: <button>
.hero-cta-button
[Clear]
```

**Apply Button Labels:**
- "✓ Apply (Element)" - Single element change
- "✓ Apply (Page-wide)" - Multiple elements via selector
- "✓ Apply (Page)" - Global scope change

**Input Placeholder:**
- With selection: "Ask about button..."
- Without selection: "Ask about page styling, layout, or select an element..."

### Welcome Message

Shows two modes:
- ✓ **With element selected:** Targeted changes
- ✓ **Without selection:** Page-wide transformations

---

## Safety & Best Practices

### AI Guidelines (from system prompt)

**Element-Level:**
- Focus ONLY on selected element
- Do NOT make assumptions about rest of page
- Suggest minimal and targeted changes

**Page-Level:**
- Analyze ENTIRE visible page structure
- Treat as redesign/refactor task
- Apply changes consistently across page

### Important Rules

- Output JSON only inside code blocks
- Keep JavaScript minimal and safe
- Do NOT manipulate data outside the DOM
- Always explain reasoning before JSON
- User must click "Apply" button to execute

---

## Example Workflows

### Workflow 1: Quick Element Edit
1. Click "⊕ Inspector"
2. Select a heading
3. Type: "Make it bold and larger"
4. Click "✓ Apply (Element)"

### Workflow 2: Page-Wide Typography Update
1. Don't select any element
2. Type: "Change all text to use system fonts with better readability"
3. AI suggests CSS for `body, p, h1, h2, h3`
4. Click "✓ Apply (Page-wide)"

### Workflow 3: Layout Redesign
1. Don't select any element
2. Type: "Add more spacing and make it look more modern"
3. AI suggests multiple CSS changes with selectors
4. Click "✓ Apply (Page)" on each suggestion

---

## Technical Architecture

```
User Input
    ↓
AIChatBox (determines mode based on selectedElement)
    ↓
System Prompt (adaptive: element-level vs page-level)
    ↓
AI Provider (OpenAI/Claude/Gemini/etc.)
    ↓
JSON Action with optional `selector` field
    ↓
applyAction() (prepares payload)
    ↓
chrome.tabs.sendMessage('APPLY_AI_CHANGE')
    ↓
content-script.ts → applyAIChange()
    ↓
querySelectorAll() or single element resolution
    ↓
Apply to all matched elements
    ↓
Success (with applied count)
```

---

## Future Enhancements

- [ ] Preview mode before applying
- [ ] Batch operations (multiple actions in one go)
- [ ] CSS variable injection for theme changes
- [ ] Undo/redo for page-level changes
- [ ] Export modified page as template
- [ ] AI-suggested selector improvements
- [ ] Visual selector builder UI

---

## Troubleshooting

**Issue:** Apply button doesn't appear
- **Cause:** AI didn't format response as JSON code block
- **Fix:** Ask AI to provide JSON format explicitly

**Issue:** Changes don't apply
- **Cause:** Selector doesn't match any elements
- **Fix:** Check selector in browser console: `document.querySelectorAll('selector')`

**Issue:** Only one element changed instead of all
- **Cause:** Selector is too specific
- **Fix:** Ask AI to use broader selector (e.g., "all paragraphs")

**Issue:** Script action doesn't work
- **Cause:** CSP restrictions or syntax error
- **Fix:** Use CSS/HTML actions instead when possible

---

## Context7 Integration

All AI prompts end with "use context7" to leverage:
- Best practices for DOM manipulation
- Modern CSS techniques
- Accessibility guidelines
- Performance considerations

---

Last Updated: January 4, 2026
