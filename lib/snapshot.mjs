export const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='textbox']",
  "[role='combobox']",
  "[role='menuitem']",
  "[role='tab']"
].join(",");

function clean(value, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function fingerprint(item) {
  return `${item.tag}\0${item.role}\0${item.name}`;
}

export async function inspectInteractiveLocator(locator) {
  const value = await locator.evaluate((element) => {
    const textOfIds = (ids) => String(ids ?? "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const label = element.labels?.length ? Array.from(element.labels).map((node) => node.textContent ?? "").join(" ") : "";
    const text = element.innerText ?? element.textContent ?? "";
    const name = element.getAttribute("aria-label") || textOfIds(element.getAttribute("aria-labelledby")) || label ||
      element.getAttribute("alt") || element.getAttribute("title") || element.getAttribute("placeholder") ||
      ((element.tagName === "INPUT" || element.tagName === "BUTTON") ? element.value : "") || text;
    const explicitRole = element.getAttribute("role");
    const tag = element.tagName.toLowerCase();
    let role = explicitRole || tag;
    if (!explicitRole) {
      if (tag === "a") role = "link";
      else if (tag === "button" || tag === "summary") role = "button";
      else if (tag === "select") role = "combobox";
      else if (tag === "textarea") role = "textbox";
      else if (tag === "input") {
        const type = (element.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox") role = "checkbox";
        else if (type === "radio") role = "radio";
        else if (["button", "submit", "reset"].includes(type)) role = "button";
        else role = "textbox";
      }
    }
    return {
      tag,
      role,
      name
    };
  });
  const item = { tag: clean(value.tag, 40), role: clean(value.role, 60), name: clean(value.name) };
  return { ...item, fingerprint: fingerprint(item) };
}

export async function takePageSnapshot(page, pageId, sequence, options = {}) {
  const maxElements = Math.max(1, options.maxElements ?? 100);
  const maxTextChars = Math.max(500, options.maxTextChars ?? 12000);
  const locator = page.locator(INTERACTIVE_SELECTOR);
  const rawItems = await locator.evaluateAll((elements) => {
    const textOfIds = (ids) => String(ids ?? "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const inferRole = (element) => {
      const explicit = element.getAttribute("role");
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button" || tag === "summary") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = (element.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["button", "submit", "reset"].includes(type)) return "button";
        return "textbox";
      }
      return tag;
    };
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return null;
      const label = element.labels?.length ? Array.from(element.labels).map((node) => node.textContent ?? "").join(" ") : "";
      const text = element.innerText ?? element.textContent ?? "";
      const name = element.getAttribute("aria-label") || textOfIds(element.getAttribute("aria-labelledby")) || label ||
        element.getAttribute("alt") || element.getAttribute("title") || element.getAttribute("placeholder") ||
        ((element.tagName === "INPUT" || element.tagName === "BUTTON") ? element.value : "") || text;
      return {
        index,
        tag: element.tagName.toLowerCase(),
        role: inferRole(element),
        name,
        type: element.getAttribute("type") || "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
        checked: typeof element.checked === "boolean" ? element.checked : null
      };
    }).filter(Boolean);
  });

  const refs = new Map();
  const elements = [];
  for (const raw of rawItems.slice(0, maxElements)) {
    const item = {
      tag: clean(raw.tag, 40),
      role: clean(raw.role, 60),
      name: clean(raw.name),
      type: clean(raw.type, 40),
      ...(raw.href ? { href: clean(raw.href, 500) } : {}),
      ...(raw.disabled ? { disabled: true } : {}),
      ...(typeof raw.checked === "boolean" ? { checked: raw.checked } : {})
    };
    const ref = `${pageId}:s${sequence}:e${elements.length + 1}`;
    refs.set(ref, { index: raw.index, fingerprint: fingerprint(item) });
    elements.push({ ref, ...item });
  }

  let bodyText = "";
  try {
    bodyText = clean(await page.locator("body").innerText(), maxTextChars + 1);
  } catch {
    bodyText = "";
  }
  const textTruncated = bodyText.length > maxTextChars;
  if (textTruncated) bodyText = bodyText.slice(0, maxTextChars);

  return {
    value: {
      pageId,
      url: page.url(),
      title: await page.title(),
      snapshotId: `${pageId}:s${sequence}`,
      elements,
      elementsTruncated: rawItems.length > maxElements,
      text: bodyText,
      textTruncated
    },
    refs
  };
}

export function expectedFingerprint(entry) {
  return entry.fingerprint;
}
