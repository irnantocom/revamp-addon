# Design

UI and interaction conventions for the Revamp panel. Technical structure is in [ARCHITECTURE.md](ARCHITECTURE.md); product intent is in [PRD.md](PRD.md).

## 1. Principles

1. **Never surprise the page.** Overlays, pins and the panel sit above the site and do not alter its own styles or attributes (except `data-revamp-hidden` / `data-revamp-display` on elements the user hid).
2. **Preview before apply.** AI changes are shown and selectable; nothing changes until the user applies.
3. **Everything reversible.** Each change can be undone alone, and the whole demo can be reset.
4. **Say what happened.** Every action reports success, partial success or why it failed in plain words (for example "not found on the page", "screenshots were skipped").
5. **Built for non-developers.** Labels describe outcomes (Hide, Move up, Present), not DOM jargon; selectors appear only as secondary detail.

## 2. Layout

### Floating panel
- Opened and closed from the toolbar icon; injected into the page as a fixed container holding the React app in an iframe.
- Drag by the header, resize from the bottom corner handle. Position is remembered in the page's `localStorage` (`revamp-panel-position`).
- The container stops event propagation so clicks inside never reach the page, and it is tagged `data-revamp-ui` so it is excluded from indexing, screenshots and export.

### Panel structure
```
┌─────────────────────────────────┐
│ Revamp · AI Page Editor    [x]  │  blue header, drag handle
├─────────────────────────────────┤
│ Inspector Editor AI Demo        │  scrollable tab bar
│ Export Settings                 │  Editor disabled until an element is selected
├─────────────────────────────────┤
│                                 │
│          active tab             │  scrolls independently
│                                 │
├─────────────────────────────────┤
│ footer                          │
└─────────────────────────────────┘
```

Selecting an element does not switch tabs; the user stays where they are. A note's "ask AI" action hands a prompt to the AI tab and switches to it.

## 3. Tabs

| Tab | Purpose | Key elements |
|-----|---------|--------------|
| **Inspector** | Choose an element | Start/stop button, status text, short instructions. Hover shows a blue overlay with a label; click selects. |
| **Editor** | Manual edits to the selection | Element summary (tag, selector, selector type), text editor, attribute picker and value, CSS fields, undo. |
| **AI Chat** | Natural-language changes | Provider/model picker, scope badge (whole page or selected element, with clear button), message list, input, change preview list. |
| **Demo** | Manage the demo | Demo name and on/off switch, Sections, Changes, Notes, Versions, Share, Present, Handoff. |
| **Export** | Static copy | Option checkboxes, Export button, progress text, report of downloaded, failed and skipped assets. |
| **Settings** | Providers | API key per provider (masked, show/hide), Azure endpoint, API version, deployment, key validation, model list. |

### AI change preview
Each proposed operation is a row: checkbox, description, the AI's short reason, eye icon.
- Checked rows are applied by "Apply selected".
- The eye icon scrolls to the target and outlines it with the preview overlay, or reports "not found".
- Warnings from the AI (missing image URL, truncated text) appear above the list.
- After applying, rows show success or the error for that operation; each applied change can be reverted.

### Demo tab sections
- **Sections:** one row per top-level block with a visibility toggle (eye) and up/down buttons; rows that cannot move are disabled.
- **Changes:** list of applied operations with revert; pending ones (element not located yet) are marked as such.
- **Notes:** add from the inspector, edit, resolve, delete; pins are numbered on the page. "Ask AI to apply open notes" sends each note with the full text of its element.
- **Present:** hides the extension UI and pins; screenshot of the viewport or the full page.

## 4. Page overlays

| Overlay | Colour | Behaviour |
|---------|--------|-----------|
| Hover highlight | Blue border, light blue fill, label with tag and selector | Follows the pointer in inspect mode; crosshair cursor |
| Pick highlight | Amber border and fill | Used when choosing a target such as a note's element |
| Preview outline | Dashed outline | Added by the eye icon; cleared on the next preview or on demand |
| Note pins | Numbered markers at document coordinates | Re-positioned when edits move or hide elements; hidden in presentation mode |

Overlays are separate elements, not styles on the target, so they cannot damage the site's own `outline` or `title`.

## 5. Visual conventions

- **Stack:** Tailwind utility classes, system font, gray-50 background, white cards with gray-200 borders.
- **Accent:** blue-600 for the header, active tab underline and primary buttons.
- **State colours:** green for success, amber for warnings and pending states, red for errors and destructive actions (Reset, Remove).
- **Type scale:** text-xs for tabs and hints, text-sm for body, text-lg for panel titles.
- **Buttons:** one primary action per card; destructive actions need a confirmation or are revertible.
- **Disabled states:** tabs and buttons that need a selection or a connection are disabled with an explanation nearby, not hidden.
- **Language:** all UI strings are English and sentence case.

## 6. Interaction details

- **Inspector active:** page clicks are intercepted so links and buttons do not fire; pressing stop or selecting an element restores normal behaviour.
- **Errors on the page side:** if the content script is not reachable (old tab, unsupported page) the panel says to reload the tab or use a regular http(s) page.
- **Long operations** (export, handoff, full-page screenshot) show progress text and disable their button until done.
- **Import:** shared JSON or code is validated; invalid operations are skipped and the result states how many were applied.
- **Accessibility baseline:** controls are real buttons and inputs with text labels; colour is never the only signal (status text accompanies colour). Keyboard coverage and focus order inside the panel have not been audited.

## 7. Open design questions

- Drag-and-drop reordering for sections (today up/down buttons).
- Dark mode for the panel.
- A light onboarding flow for first-time use (API key missing, no element selected).
- Focus management and screen-reader labels inside the iframe panel.
