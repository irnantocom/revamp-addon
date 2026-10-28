import { Operation, OperationResult } from '../types/operations';
import { PageIndex } from './page-index';

type Revert = () => void;

export interface AppliedOperation {
  revert: Revert;
  /** Elements this operation created (e.g. a duplicate), for dependency tracking */
  created?: Element[];
}

const FORBIDDEN_HTML_TAGS = 'script,style,iframe,object,embed,link,meta,base,form,foreignObject';
// SMIL animation elements; names are camelCase, which selectors match exactly for SVG elements
const SVG_ANIMATION_TAGS = 'animate,set,animateTransform,animateMotion';
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'xlink:href']);

const ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;
const IMPORTANT = /\s*!\s*important\s*$/i;

/** Browsers drop tabs, newlines and other control characters inside a URL, so "java\tscript:" still runs as javascript: */
function isSafeUrl(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  return !/^(javascript|vbscript|data:text\/html)/i.test(normalized);
}

/**
 * An SVG animation can write a value into an attribute after the static checks have run, e.g.
 * <animate attributeName="href" values="javascript:..."> on a link. Harmless animations (spinners,
 * logos) are kept; only those aimed at URL or event-handler attributes, or carrying an unsafe URL, go.
 */
function isDangerousAnimation(el: Element): boolean {
  const target = (el.getAttribute('attributeName') ?? '').trim().toLowerCase();
  if (target && (/^on/.test(target) || target === 'srcdoc' || URL_ATTRS.has(target))) return true;

  return ['values', 'to', 'from', 'by'].some((name) =>
    (el.getAttribute(name) ?? '').split(';').some((value) => !isSafeUrl(value))
  );
}

/**
 * Parse HTML from the AI into a fragment with active content stripped
 */
export function sanitizeHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;

  fragment.querySelectorAll(FORBIDDEN_HTML_TAGS).forEach((el) => el.remove());
  fragment.querySelectorAll(SVG_ANIMATION_TAGS).forEach((el) => {
    if (isDangerousAnimation(el)) el.remove();
  });
  fragment.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || (URL_ATTRS.has(attr.name.toLowerCase()) && !isSafeUrl(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return fragment;
}

/**
 * Applies one operation and returns how to revert it.
 * Targets are resolved through the PageIndex and validated first, so a stale
 * or invented id fails with a clear message instead of touching the wrong node.
 */
export function applyOperation(op: Operation, index: PageIndex): AppliedOperation {
  const created: Element[] = [];
  const revert = applyOperationInner(op, index, created);
  return { revert, created: created.length ? created : undefined };
}

function applyOperationInner(op: Operation, index: PageIndex, created: Element[]): Revert {
  const target = index.resolve(op.target);
  if (!target) {
    throw new Error(`Element [${op.target}] no longer exists on the page. Re-run the request.`);
  }
  const el = target as HTMLElement;

  switch (op.op) {
    case 'set_text': {
      const previous = Array.from(el.childNodes);
      el.textContent = op.text;
      return () => el.replaceChildren(...previous);
    }

    case 'set_html': {
      const previous = Array.from(el.childNodes);
      el.replaceChildren(sanitizeHtml(op.html));
      return () => el.replaceChildren(...previous);
    }

    case 'set_attr':
      return setSafeAttribute(el, op.name, op.value);

    case 'set_link':
      return setSafeAttribute(el, 'href', op.href);

    case 'replace_image': {
      if (!(el instanceof HTMLImageElement)) {
        throw new Error(`Element [${op.target}] is <${el.tagName.toLowerCase()}>, not an image.`);
      }
      const reverts = [
        setSafeAttribute(el, 'src', op.src),
        // srcset/sizes would override the new src
        setSafeAttribute(el, 'srcset', null),
      ];
      if (op.alt !== undefined) reverts.push(setSafeAttribute(el, 'alt', op.alt));
      // <picture><source> would also take priority over img src
      const picture = el.parentElement?.tagName === 'PICTURE' ? el.parentElement : null;
      if (picture) {
        picture.querySelectorAll('source').forEach((source) => {
          reverts.push(setSafeAttribute(source as HTMLElement, 'srcset', null));
        });
      }
      return () => reverts.reverse().forEach((revert) => revert());
    }

    case 'set_style':
      return applyStyles(el, op.styles);

    case 'set_visibility': {
      const prevValue = el.style.getPropertyValue('display');
      const prevPriority = el.style.getPropertyPriority('display');
      const wasHiddenByRevamp = el.hasAttribute('data-revamp-hidden');

      if (op.visible) {
        // Only undo what Revamp itself hid; otherwise nothing to show
        if (el.hasAttribute('data-revamp-hidden')) {
          const original = el.getAttribute('data-revamp-display') ?? '';
          if (original) el.style.setProperty('display', original);
          else el.style.removeProperty('display');
          el.removeAttribute('data-revamp-hidden');
          el.removeAttribute('data-revamp-display');
          index.markHidden(el, false);
        }
      } else {
        if (!wasHiddenByRevamp) el.setAttribute('data-revamp-display', prevValue);
        el.setAttribute('data-revamp-hidden', 'true');
        el.style.setProperty('display', 'none', 'important');
        index.markHidden(el, true);
      }

      return () => {
        if (prevValue) el.style.setProperty('display', prevValue, prevPriority);
        else el.style.removeProperty('display');
        if (wasHiddenByRevamp) {
          el.setAttribute('data-revamp-hidden', 'true');
          index.markHidden(el, true);
        } else {
          el.removeAttribute('data-revamp-hidden');
          el.removeAttribute('data-revamp-display');
          index.markHidden(el, false);
        }
      };
    }

    case 'remove': {
      const parent = el.parentNode;
      const next = el.nextSibling;
      if (!parent) throw new Error(`Element [${op.target}] has no parent.`);
      el.remove();
      return () => parent.insertBefore(el, next);
    }

    case 'duplicate': {
      const parent = el.parentNode;
      if (!parent) throw new Error(`Element [${op.target}] has no parent.`);
      const clone = el.cloneNode(true) as HTMLElement;
      // Ids must stay unique in the page
      if (clone.id) clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
      clone.removeAttribute('data-revamp-hidden');
      parent.insertBefore(clone, el.nextSibling);
      created.push(clone);
      return () => clone.remove();
    }

    case 'move': {
      const ref = index.resolve(op.ref);
      if (!ref) throw new Error(`Reference element [${op.ref}] no longer exists on the page.`);
      if (ref === el || el.contains(ref)) {
        throw new Error(`Cannot move [${op.target}] relative to itself or its own child [${op.ref}].`);
      }
      const parent = el.parentNode;
      const next = el.nextSibling;
      if (!parent) throw new Error(`Element [${op.target}] has no parent.`);

      switch (op.position) {
        case 'before':
          ref.parentNode?.insertBefore(el, ref);
          break;
        case 'after':
          ref.parentNode?.insertBefore(el, ref.nextSibling);
          break;
        case 'first':
          ref.insertBefore(el, ref.firstChild);
          break;
        case 'last':
          ref.appendChild(el);
          break;
      }
      return () => parent.insertBefore(el, next);
    }

    default:
      throw new Error(`Unknown operation: ${(op as { op: string }).op}`);
  }
}

export function setSafeAttribute(el: Element, name: string, value: string | null): Revert {
  if (!ATTRIBUTE_NAME.test(name)) {
    throw new Error(`"${name}" is not a valid attribute name. Start with a letter and use only letters, digits, "-", "_", ":" or ".".`);
  }
  if (/^on/i.test(name)) throw new Error(`Refusing to set event handler attribute: ${name}`);
  if (name.toLowerCase() === 'srcdoc') throw new Error('Refusing to set srcdoc: it embeds a whole HTML document.');
  if (/^data-revamp-/i.test(name)) throw new Error(`${name} is used by Revamp internally and cannot be edited.`);
  if (value !== null && URL_ATTRS.has(name.toLowerCase()) && !isSafeUrl(value)) {
    throw new Error(`Refusing unsafe URL for ${name}`);
  }
  const previous = el.getAttribute(name);
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
  return () => {
    if (previous === null) el.removeAttribute(name);
    else el.setAttribute(name, previous);
  };
}

/**
 * Set inline styles and return how to undo them. Browsers silently ignore a declaration they cannot
 * parse, so every one is tried on a scratch element first: a bad value then fails with a clear message
 * and nothing is half-applied. An empty value removes the property.
 */
export function applyStyles(el: HTMLElement, styles: Record<string, unknown>): Revert {
  const declarations = Object.entries(styles).map(([prop, raw]) => {
    const property = prop.startsWith('--') ? prop : prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    let value = String(raw).trim();
    const important = IMPORTANT.test(value);
    if (important) value = value.replace(IMPORTANT, '');
    return { property, value, priority: important ? 'important' : '' };
  });

  const probe = document.createElement('span');
  const invalid = declarations.filter(({ property, value, priority }) => {
    if (value === '') return false;
    probe.style.setProperty(property, value, priority);
    const accepted = probe.style.getPropertyValue(property) !== '';
    probe.style.removeProperty(property);
    return !accepted;
  });
  if (invalid.length > 0) {
    throw new Error(`Invalid CSS: ${invalid.map(({ property, value }) => `${property}: ${value}`).join('; ')}`);
  }

  const previous = new Map<string, { value: string; priority: string }>();
  declarations.forEach(({ property, value, priority }) => {
    if (!previous.has(property)) {
      previous.set(property, {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property),
      });
    }
    el.style.setProperty(property, value, priority);
  });
  return () => {
    previous.forEach((old, property) => {
      if (old.value) el.style.setProperty(property, old.value, old.priority);
      else el.style.removeProperty(property);
    });
  };
}

export type { OperationResult };
