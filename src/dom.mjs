// Building the page: elements, links that are safe to follow, numbers that are safe to put in a
// style. Nothing here knows about Atlas's data or keeps any state, and nothing runs on import,
// which is what lets Node load this file and test safeHref directly.

// Links whose address comes from atlas.yaml: only an https address, or one that stays on this
// site. bin/validate-atlas.mjs already refuses anything else in the file, so this is the second
// line rather than the first. It is here because the content security policy does not stop a
// javascript: address in every engine, and because the next person adding a link should not
// have to remember any of that.
export function safeHref(value) {
  const href = String(value).trim();
  if (/^https:\/\/[^\s]+$/i.test(href)) return href;
  if (/^(?:\.{1,2}\/|\/(?!\/)|[#?])/.test(href)) return href; // relative, in-page, or a query
  return null;
}

// A percentage on its way into a style attribute. Anything that is not a finite number becomes
// zero, and the result is held between 0 and 100, so a stray value in the data cannot widen a
// bar past its track or inject anything into the declaration.
export const pct = (n) => Math.max(0, Math.min(100, Number(n) || 0));

// An explicit behavior option beats the scroll-behavior rule in the stylesheet, so the
// preference has to be read here too. Checked at the moment of scrolling, because someone can
// change the setting without reloading the page.
const wantsLessMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const scrollTo = (node, options = {}) => node && node.scrollIntoView({ ...options, behavior: wantsLessMotion() ? "auto" : "smooth" });

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "style") for (const decl of String(value).split(";")) { const i = decl.indexOf(":"); if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim()); }
      else if (key === "href" || key === "src") { const safe = safeHref(value); if (safe) node.setAttribute(key, safe); }
      else node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// The same helper for SVG, which needs its own namespace and takes every attribute through
// setAttribute. Charts are built with this rather than assembled as markup, so no string from
// the data is ever parsed as HTML and no escaping has to be remembered.
const SVG_NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      // Styles go through the property, never the attribute. The content security policy has
      // no 'unsafe-inline' for styles, so a style attribute is dropped silently: the element
      // still appears, just with no colour. Setting each declaration is not blocked, which is
      // how el() has always done it.
      if (key === "style") {
        for (const decl of String(value).split(";")) {
          const i = decl.indexOf(":");
          if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
        }
        continue;
      }
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat(2)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// A value with more behind it (`valueTitle`, one line per item) gets a CSS tooltip that opens on hover and on
// keyboard focus at once; a native title needs a still pointer for a second and never shows on touch.
export const tipAttrs = (tip, text) => (tip ? { class: "has-tip", "data-tip": tip, tabindex: "0", "aria-label": `${text}: ${tip.split("\n").join(", ")}` } : {});

// Merge a tip into attributes that already carry classes. Spreading tipAttrs directly would
// replace the class list rather than add to it, which silently strips an element's styling.
export const withTip = (attrs, tip, text) => {
  const extra = tipAttrs(tip, text);
  if (!extra.class) return attrs;
  return { ...attrs, ...extra, class: [attrs.class, extra.class].filter(Boolean).join(" ") };
};
