import { Operation, OperationResult } from '../types/operations';
import { PageIndex } from './page-index';

type Revert = () => void;

export interface AppliedOperation {
  revert: Revert;
  /** Elements this operation created (e.g. a duplicate), for dependency tracking */
  created?: Element[];
}

const FORBIDDEN_HTML_TAGS = 'script,style,iframe,object,embed,link,meta,base,form';
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'xlink:href']);

function isSafeUrl(value: string): boolean {
  return !/^\s*(javascript|vbscript|data:text\/html)/i.test(value);
}

/**
 * Parse HTML from the AI into a fragment with active content stripped
 */
export function sanitizeHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;

  fragment.querySelectorAll(FORBIDDEN_HTML_TAGS).forEach((el) => el.remove());
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
      return setAttribute(el, op.name, op.value);

    case 'set_link':
      return setAttribute(el, 'href', op.href);

    case 'replace_image': {
      if (!(el instanceof HTMLImageElement)) {
        throw new Error(`Element [${op.target}] is <${el.tagName.toLowerCase()}>, not an image.`);
      }
      const reverts = [
        setAttribute(el, 'src', op.src),
        // srcset/sizes would override the new src
        setAttribute(el, 'srcset', null),
      ];
      if (op.alt !== undefined) reverts.push(setAttribute(el, 'alt', op.alt));
      // <picture><source> would also take priority over img src
      const picture = el.parentElement?.tagName === 'PICTURE' ? el.parentElement : null;
      if (picture) {
        picture.querySelectorAll('source').forEach((source) => {
          reverts.push(setAttribute(source as HTMLElement, 'srcset', null));
        });
      }
      return () => reverts.reverse().forEach((revert) => revert());
    }

    case 'set_style': {
      const previous = new Map<string, { value: string; priority: string }>();
      Object.entries(op.styles).forEach(([prop, val]) => {
        const cssProp = prop.startsWith('--') ? prop : prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (!previous.has(cssProp)) {
          previous.set(cssProp, {
            value: el.style.getPropertyValue(cssProp),
            priority: el.style.getPropertyPriority(cssProp),
          });
        }
        el.style.setProperty(cssProp, String(val));
      });
      return () => {
        previous.forEach((old, prop) => {
          if (old.value) el.style.setProperty(prop, old.value, old.priority);
          else el.style.removeProperty(prop);
        });
      };
    }

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

function setAttribute(el: Element, name: string, value: string | null): Revert {
  if (/^on/i.test(name)) throw new Error(`Refusing to set event handler attribute: ${name}`);
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

export type { OperationResult };
