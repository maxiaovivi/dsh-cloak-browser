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
  "[role='listbox']",
  "[role='option']",
  "[role='switch']",
  "[role='spinbutton']",
  "[role='slider']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='treeitem']",
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
        else if (type === "range") role = "slider";
        else if (type === "number") role = "spinbutton";
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
  const pageFrames = typeof page.frames === "function" ? page.frames() : [page];
  const mainFrame = typeof page.mainFrame === "function" ? page.mainFrame() : pageFrames[0];
  const frames = [];

  for (const [frameIndex, frame] of pageFrames.entries()) {
    const frameId = frame === mainFrame ? "f1" : `f${frameIndex + 1}`;
    try {
      const locator = frame.locator(INTERACTIVE_SELECTOR);
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
            if (type === "range") return "slider";
            if (type === "number") return "spinbutton";
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
          const ariaBoolean = (name) => {
            const value = element.getAttribute(name);
            return value === "true" ? true : value === "false" ? false : null;
          };
          return {
            index,
            tag: element.tagName.toLowerCase(),
            role: inferRole(element),
            name,
            type: element.getAttribute("type") || "",
            href: element instanceof HTMLAnchorElement ? element.href : "",
            disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
            checked: typeof element.checked === "boolean" ? element.checked : ariaBoolean("aria-checked"),
            selected: typeof element.selected === "boolean" ? element.selected : ariaBoolean("aria-selected"),
            expanded: ariaBoolean("aria-expanded"),
            pressed: ariaBoolean("aria-pressed"),
            required: Boolean(element.required) || element.getAttribute("aria-required") === "true",
            invalid: element.getAttribute("aria-invalid") === "true",
            readOnly: Boolean(element.readOnly) || element.getAttribute("aria-readonly") === "true"
          };
        }).filter(Boolean);
      });
      let frameText = "";
      try {
        frameText = clean(await frame.locator("body").innerText(), maxTextChars + 1);
      } catch {
        frameText = "";
      }
      frames.push({
        frame,
        frameId,
        url: clean(typeof frame.url === "function" ? frame.url() : page.url(), 500),
        name: clean(typeof frame.name === "function" ? frame.name() : "", 120),
        rawItems,
        text: frameText
      });
    } catch (error) {
      if (frame === mainFrame) throw error;
      // Frames can detach while a page is being observed. Keep the rest of the
      // snapshot useful instead of failing the entire Agent action.
    }
  }

  const refs = new Map();
  const elements = [];
  let totalElements = 0;
  for (const frameResult of frames) {
    totalElements += frameResult.rawItems.length;
    for (const raw of frameResult.rawItems) {
      if (elements.length >= maxElements) break;
      const item = {
        tag: clean(raw.tag, 40),
        role: clean(raw.role, 60),
        name: clean(raw.name),
        type: clean(raw.type, 40),
        ...(raw.href ? { href: clean(raw.href, 500) } : {}),
        ...(raw.disabled ? { disabled: true } : {}),
        ...(typeof raw.checked === "boolean" ? { checked: raw.checked } : {}),
        ...(typeof raw.selected === "boolean" ? { selected: raw.selected } : {}),
        ...(typeof raw.expanded === "boolean" ? { expanded: raw.expanded } : {}),
        ...(typeof raw.pressed === "boolean" ? { pressed: raw.pressed } : {}),
        ...(raw.required ? { required: true } : {}),
        ...(raw.invalid ? { invalid: true } : {}),
        ...(raw.readOnly ? { readOnly: true } : {}),
        ...(frameResult.frameId !== "f1" ? { frameId: frameResult.frameId, frameUrl: frameResult.url } : {})
      };
      const elementNumber = elements.length + 1;
      const ref = frameResult.frameId === "f1"
        ? `${pageId}:s${sequence}:e${elementNumber}`
        : `${pageId}:s${sequence}:${frameResult.frameId}:e${elementNumber}`;
      refs.set(ref, { index: raw.index, fingerprint: fingerprint(item), frame: frameResult.frame, page });
      elements.push({ ref, ...item });
    }
  }

  let bodyText = frames.map((frameResult) => frameResult.frameId === "f1"
    ? frameResult.text
    : `[Frame ${frameResult.frameId}${frameResult.name ? ` ${frameResult.name}` : ""}: ${frameResult.url}]\n${frameResult.text}`
  ).filter(Boolean).join("\n\n");
  const textTruncated = bodyText.length > maxTextChars;
  if (textTruncated) bodyText = bodyText.slice(0, maxTextChars);

  return {
    value: {
      pageId,
      url: page.url(),
      title: await page.title(),
      snapshotId: `${pageId}:s${sequence}`,
      elements,
      elementsTruncated: totalElements > maxElements,
      text: bodyText,
      textTruncated,
      ...(frames.length > 1 ? {
        frames: frames.map((frameResult) => ({
          frameId: frameResult.frameId,
          url: frameResult.url,
          ...(frameResult.name ? { name: frameResult.name } : {}),
          elements: frameResult.rawItems.length
        }))
      } : {})
    },
    refs
  };
}

export function expectedFingerprint(entry) {
  return entry.fingerprint;
}
