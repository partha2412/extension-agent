// utils/tools.js
// Runs inside the page (content script). No chrome.tabs here:
// navigate() lives in utils/browser.js, and trusted key presses go through
// chrome.debugger there too.

// --------------------------------
// HIGHLIGHT
// --------------------------------

export function highlightElement(element) {
  try {
    element.animate(
      [
        { outline: "3px solid red", backgroundColor: "rgba(255, 0, 0, 0.3)" },
        { outline: "3px solid transparent", backgroundColor: "transparent" },
      ],
      { duration: 2000, easing: "ease-out", fill: "none" },
    );
  } catch {
    // element may not support animate(); highlighting is cosmetic only
  }
}

// --------------------------------
// SHARED HELPERS
// --------------------------------

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "META",
  "LINK",
  "HEAD",
  "HTML",
  "BODY",
]);

const CLICKABLE =
  'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';

const INTERACTIVE = `${CLICKABLE}, input, textarea, select, [role="textbox"], [role="searchbox"], [contenteditable="true"]`;

const CHROME_AREAS =
  'nav, header, aside, footer, [role="navigation"], [role="banner"], #guide, #masthead-container';

const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "image",
  "color",
  "range",
  "hidden",
]);

// Element IDs live in memory, not in a DOM attribute. SPAs like Gmail and
// YouTube wipe unknown attributes when they re-render.
const idByElement = new WeakMap();
const elementById = new Map();
let idCounter = 0;

function ensureId(el) {
  let id = idByElement.get(el);
  if (!id) {
    id = `a${++idCounter}`;
    idByElement.set(el, id);
    elementById.set(id, new WeakRef(el));
  }
  return id;
}

function getElement(elementId) {
  if (!elementId) return null;
  const el = elementById.get(String(elementId))?.deref();
  return el && el.isConnected ? el : null;
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return (
    s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"
  );
}

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return (
    r.bottom > 0 &&
    r.top < window.innerHeight &&
    r.right > 0 &&
    r.left < window.innerWidth
  );
}

const isEditable = (el) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el.isContentEditable;

const isClickable = (el) => !!el.matches?.(CLICKABLE);

// Wrapper -> the real input inside it (or the one the click already focused)
function resolveEditable(el) {
  if (!el) return null;
  if (isEditable(el)) return el;
  if (el.control && isEditable(el.control)) return el.control;

  const inner = el.querySelector?.(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]',
  );
  if (inner) return inner;

  if (document.activeElement && isEditable(document.activeElement)) {
    return document.activeElement;
  }
  return null;
}

// Inner span/icon -> the link or button that actually handles the click
function resolveClickable(el) {
  return (
    el.closest?.(CLICKABLE) || el.querySelector?.("a[href], button") || el
  );
}

// Compact description sent to the model (undefined fields are dropped by JSON)
function describe(el, extra = {}) {
  return {
    elementId: ensureId(el),
    tag: el.tagName.toLowerCase(),
    label: (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.innerText ||
      el.value ||
      el.title ||
      ""
    )
      .trim()
      .slice(0, 60),
    type: el.getAttribute("type") || undefined,
    href: el.getAttribute("href")?.slice(0, 80) || undefined,
    editable: isEditable(el) || undefined,
    clickable: isClickable(el) || undefined,
    ...extra,
  };
}

// "ariaLabel" -> "aria-label" (the model copies camelCase from results)
const toAttr = (name) =>
  String(name ?? "")
    .trim()
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------
// PAGE INFORMATION
// --------------------------------

export function get_page_info() {
  const all = [...document.querySelectorAll(INTERACTIVE)].filter(isVisible);

  // Inputs first, then on-screen page content, then on-screen nav/header,
  // then anything off-screen. sort() is stable, so DOM order is preserved.
  const rank = (el) => {
    if (isEditable(el)) return 0;
    if (inViewport(el)) return el.closest(CHROME_AREAS) ? 2 : 1;
    return 3;
  };

  const ordered = all
    .map((el) => ({ el, r: rank(el) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 30)
    .map(({ el }) => el);

  return {
    success: true,
    url: location.href,
    title: document.title,
    elements: ordered.map((el) => describe(el)),
    text: document.body.innerText.slice(0, 2000),
  };
}

export function get_text(elementId) {
  const el = elementId
    ? getElement(elementId)
    : document.querySelector('main, [role="main"]') || document.body;

  if (!el) {
    return {
      success: false,
      error: "Element is no longer on the page. Find it again.",
    };
  }

  return { success: true, text: el.innerText.trim().slice(0, 6000) };
}

// --------------------------------
// FINDERS
// --------------------------------

export function find_by_text(text) {
  const query = String(text ?? "")
    .trim()
    .toLowerCase();

  if (!query) return { success: false, error: "Text is required" };

  const matches = [];

  for (const el of document.querySelectorAll("*")) {
    if (SKIP_TAGS.has(el.tagName) || !isVisible(el)) continue;

    const interactive = isClickable(el) || isEditable(el);

    // Inner spans/icons inside a button or link are covered by the
    // button/link itself matching on its innerText
    if (!interactive && el.closest(CLICKABLE)) continue;

    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(" ");

    const candidates = [
      interactive ? el.innerText : ownText,
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      el.getAttribute("title"),
      el.getAttribute("alt"),
    ];

    let best = 0;
    for (const candidate of candidates) {
      const s = (candidate ?? "").trim().toLowerCase();
      if (!s) continue;

      if (s === query) best = Math.max(best, 100);
      else if (s.includes(query) && s.length <= query.length * 4)
        best = Math.max(best, 60);
      else if (s.includes(query)) best = Math.max(best, 30);
    }

    if (!best) continue;

    matches.push({ el, score: best + (interactive ? 20 : 0) });
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, 5);

  if (!top.length) {
    return {
      success: false,
      error: `No element found containing text "${text}"`,
    };
  }

  top[0].el.scrollIntoView({ behavior: "smooth", block: "center" });
  top.forEach(({ el }) => highlightElement(el));

  return {
    success: true,
    count: top.length,
    elements: top.map(({ el }) => describe(el)),
  };
}

export function find_by_attribute(attribute) {
  const name = toAttr(attribute);

  if (!name) return { success: false, error: "Attribute name is required" };

  let found;
  try {
    found = [...document.querySelectorAll(`[${CSS.escape(name)}]`)];
  } catch {
    return { success: false, error: `Invalid attribute name "${attribute}"` };
  }

  const visible = found.filter(isVisible);

  if (!visible.length) {
    return {
      success: false,
      error: `No element found with attribute "${name}"`,
    };
  }

  const top = visible.slice(0, 5);
  top.forEach(highlightElement);

  return {
    success: true,
    count: top.length,
    elements: top.map((el) =>
      describe(el, { attribute: name, value: el.getAttribute(name) }),
    ),
  };
}

export function find_by_attribute_value(attribute, value) {
  const name = toAttr(attribute);
  const query = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!name || !query) {
    return { success: false, error: "Attribute and value are required" };
  }

  let found;
  try {
    found = [...document.querySelectorAll(`[${CSS.escape(name)}]`)];
  } catch {
    return { success: false, error: `Invalid attribute name "${attribute}"` };
  }

  const matches = [];

  for (const el of found) {
    if (!isVisible(el)) continue;

    const v = (el.getAttribute(name) || "").toLowerCase();
    if (!v) continue;

    if (v === query) matches.push({ el, score: 100 });
    else if (v.includes(query)) matches.push({ el, score: 50 });
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, 5);

  if (!top.length) {
    return {
      success: false,
      error: `No element found with ${name}="${value}"`,
    };
  }

  top[0].el.scrollIntoView({ behavior: "smooth", block: "center" });
  top.forEach(({ el }) => highlightElement(el));

  return {
    success: true,
    count: top.length,
    elements: top.map(({ el }) =>
      describe(el, { attribute: name, value: el.getAttribute(name) }),
    ),
  };
}

// --------------------------------
// CLICK
// --------------------------------

export function click(elementId) {
  const target = getElement(elementId);

  if (!target) {
    return {
      success: false,
      error:
        "Element is no longer on the page. Call get_page_info or a finder again to get a new elementId.",
    };
  }

  const element = resolveClickable(target);

  if (element.disabled || element.getAttribute("aria-disabled") === "true") {
    return { success: false, error: "Element is disabled" };
  }

  element.scrollIntoView({ block: "center" });
  highlightElement(element);

  element.click();

  return {
    success: true,
    element: describe(element, {
      opensNewTab:
        element.getAttribute("target") === "_blank" ? true : undefined,
    }),
  };
}

// --------------------------------
// TYPE
// --------------------------------

function getCode(char) {
  if (char === " ") return "Space";
  if (/^[a-zA-Z]$/.test(char)) return `Key${char.toUpperCase()}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  return char;
}

export async function type(elementId, text) {
  const target = getElement(elementId);

  if (!target) {
    return {
      success: false,
      error:
        "Element is no longer on the page. Call get_page_info or a finder again to get a new elementId.",
    };
  }

  // Resolve wrappers (search bars, labels) to the real input inside them
  const element = resolveEditable(target);

  if (!element) {
    return {
      success: false,
      error:
        "Not editable and contains no input. Use an element with editable:true.",
    };
  }

  if (
    element instanceof HTMLInputElement &&
    NON_TEXT_INPUTS.has(element.type)
  ) {
    return {
      success: false,
      error: `Input type "${element.type}" does not accept text`,
    };
  }

  if (element.disabled || element.readOnly) {
    return { success: false, error: "Element is disabled or read-only" };
  }

  if (!isVisible(element)) {
    return { success: false, error: "Element is not visible" };
  }

  element.scrollIntoView({ block: "center" });
  element.focus();

  const hasFocus = () =>
    document.activeElement === element ||
    element.contains(document.activeElement);

  if (!hasFocus()) {
    return { success: false, error: "Could not focus the text field" };
  }

  highlightElement(element);

  const isFormField =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement;

  // Replace whatever is already in the field
  if (isFormField) {
    element.select();
  } else {
    document.execCommand("selectAll", false);
  }

  const value = String(text ?? "");

  if (!value) {
    if (isFormField) {
      element.setRangeText("");
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
        }),
      );
    } else {
      document.execCommand("delete", false);
    }
  }

  for (const char of value) {
    if (!hasFocus()) {
      return { success: false, error: "Text field lost focus while typing" };
    }

    const eventInit = {
      key: char,
      code: getCode(char),
      bubbles: true,
      cancelable: true,
    };

    element.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    element.dispatchEvent(new KeyboardEvent("keypress", eventInit));

    if (isFormField) {
      // setRangeText bypasses React's value tracker, so onChange still fires
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;

      element.setRangeText(char, start, end, "end");

      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: char,
        }),
      );
    } else {
      // execCommand fires its own input event
      document.execCommand("insertText", false, char);
    }

    element.dispatchEvent(new KeyboardEvent("keyup", eventInit));

    await sleep(15);
  }

  if (isFormField) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return {
    success: true,
    element: describe(element, {
      value: isFormField ? element.value : element.textContent,
    }),
  };
}

// --------------------------------
// SCROLL
// --------------------------------

export function scroll(direction) {
  if (direction !== "up" && direction !== "down") {
    return {
      success: false,
      error: 'Direction must be "up" or "down"',
    };
  }

  window.scrollBy({
    top: direction === "down" ? 600 : -600,
    behavior: "instant",
  });

  const root = document.scrollingElement || document.documentElement;
  const max = Math.max(0, root.scrollHeight - window.innerHeight);

  return {
    success: true,
    direction,
    scrollY: Math.round(window.scrollY),
    atTop: window.scrollY <= 0,
    atBottom: window.scrollY >= max - 2,
  };
}

// --------------------------------
// PRESS KEY
// --------------------------------
// Synthetic events are untrusted: browsers ignore them for form submission and
// many sites ignore them entirely. Prefer routing press_key through the
// chrome.debugger version in utils/browser.js. This is the in-page fallback.

const KEYS = {
  Enter: { code: "Enter", keyCode: 13 },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
};

// export function press_key(key) {
//   const target = document.activeElement || document.body;
//   const meta = KEYS[key] ?? { code: key, keyCode: 0 };

//   const init = {
//     key,
//     code: meta.code,
//     keyCode: meta.keyCode,
//     which: meta.keyCode,
//     bubbles: true,
//     cancelable: true,
//   };

//   target.dispatchEvent(new KeyboardEvent("keydown", init));
//   target.dispatchEvent(new KeyboardEvent("keypress", init));
//   target.dispatchEvent(new KeyboardEvent("keyup", init));

//   if (key === "Enter") {
//     const form = target.closest?.("form");
//     if (form) form.requestSubmit();
//   }

//   return {
//     success: true,
//     key,
//     target: { tag: target.tagName, id: target.id || null },
//   };
// }

// --------------------------------
// WAIT
// --------------------------------

export function wait(milliseconds = 1000) {
  const duration = Math.min(Math.max(Number(milliseconds) || 1000, 100), 5000);

  return new Promise((resolve) => {
    setTimeout(() => resolve({ success: true, waited: duration }), duration);
  });
}

// --------------------------------
// VERIFY
// --------------------------------
// Pure check: no scrolling or highlighting side effects.

export function verify(expectation) {
  const query = String(expectation ?? "")
    .trim()
    .toLowerCase();

  if (!query) {
    return {
      success: false,
      matched: false,
      error: "Expectation is empty",
    };
  }

  const checks = [
    ["Page text", document.body.innerText],
    ["Current URL", location.href],
    ["Page title", document.title],
  ];

  for (const [where, haystack] of checks) {
    if (haystack.toLowerCase().includes(query)) {
      return {
        success: true,
        matched: true,
        evidence: `${where} contains "${expectation}"`,
      };
    }
  }

  return {
    success: true,
    matched: false,
    url: location.href,
    title: document.title,
    textPreview: document.body.innerText.slice(0, 400),
  };
}