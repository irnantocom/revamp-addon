/**
 * The page's theme: CSS custom properties declared on :root, html or body. A theme usually keeps its
 * brand colours in a few of them (--accent, --primary) that links, borders and icons all read, so
 * changing the variable recolours elements the page index never lists.
 */
export interface ThemeVariable {
  name: string;
  value: string;
}

const ROOT_SELECTOR = /^(:root|html|body)$/i;
const COLOR_VALUE = /^(#[0-9a-f]{3,8}\b|(rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(|color(-mix)?\(|(repeating-)?(linear|radial|conic)-gradient\()/i;
const WP_PRESET = /^--wp--(preset|style)--/;
const MAX_VARIABLES = 80;
const MAX_VALUE = 80;

/**
 * Custom properties declared on :root, html or body in these rules, with the value written there.
 * @supports and @layer blocks are always read. @media blocks are read for the page itself, where the
 * computed value says which branch applies, and skipped for a stylesheet read from another site, where
 * nothing says so.
 */
export function rootVariablesFrom(
  rules: CSSRuleList,
  { includeMedia = true, found = new Map<string, string>() }: { includeMedia?: boolean; found?: Map<string, string> } = {}
): Map<string, string> {
  for (const rule of Array.from(rules)) {
    if ('selectorText' in rule && 'style' in rule) {
      const { selectorText, style } = rule as CSSStyleRule;
      if (!selectorText.split(',').some((selector) => ROOT_SELECTOR.test(selector.trim()))) continue;
      for (let i = 0; i < style.length; i++) {
        const name = style.item(i);
        if (name.startsWith('--')) found.set(name, style.getPropertyValue(name).trim());
      }
    } else if ('cssRules' in rule && (includeMedia || !('media' in rule))) {
      rootVariablesFrom((rule as CSSGroupingRule).cssRules, { includeMedia, found });
    }
  }
  return found;
}

/** Names declared in the page's stylesheets, with the value written there (used when no computed value is available) */
function declaredVariables(doc: Document): Map<string, string> {
  const found = new Map<string, string>();
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      rootVariablesFrom(sheet.cssRules, { found });
    } catch {
      // A stylesheet from another origin cannot be read; the rest still can
    }
  }
  return found;
}

/** Colours first, then the rest; a theme's own names before WordPress's generated presets */
const rank = ({ name, value }: ThemeVariable): number => (COLOR_VALUE.test(value) ? 0 : 2) + (WP_PRESET.test(name) ? 1 : 0);

/** The most useful `limit` variables, in that order; each group keeps the order of the stylesheet */
export function prioritiseVariables(variables: ThemeVariable[], limit = MAX_VARIABLES): ThemeVariable[] {
  return variables.slice().sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

export function collectThemeVariables(doc: Document = document, limit = MAX_VARIABLES): ThemeVariable[] {
  const declared = declaredVariables(doc);
  const computed = doc.body ? doc.defaultView?.getComputedStyle(doc.body) : undefined;

  const variables: ThemeVariable[] = [];
  declared.forEach((written, name) => {
    // The computed value is what the page shows now, including media queries and earlier edits
    const value = (computed?.getPropertyValue(name).trim() || written).replace(/\s+/g, ' ');
    if (!value) return;
    variables.push({ name, value: value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value });
  });

  return prioritiseVariables(variables, limit);
}
