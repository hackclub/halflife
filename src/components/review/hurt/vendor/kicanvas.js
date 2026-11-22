/*
 * KiCanvas, bundled from Fabricate's source copy (app/javascript/hurt/kicanvas, regenerated 2026-11-22)
 * with the esbuild settings of Fabricate's vite.config.ts `kicanvas` plugin. Next has no equivalent of that plugin, so Half Life keeps
 * the built output here. Do not edit by hand: change Fabricate's source and rebuild. Licence: kicanvas.LICENSE.md.
 */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// base/livereload.js
if (false) {
  new EventSource("/esbuild").addEventListener(
    "change",
    () => location.reload()
  );
}

// base/async.ts
function later(callback) {
  window.setTimeout(() => {
    callback();
  }, 0);
}
__name(later, "later");
var DeferredPromise = class {
  static {
    __name(this, "DeferredPromise");
  }
  #promise;
  #resolve;
  #reject;
  #outcome;
  #value;
  constructor() {
    this.#promise = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }
  get rejected() {
    return this.#outcome === 1 /* Rejected */;
  }
  get resolved() {
    return this.#outcome === 0 /* Resolved */;
  }
  get settled() {
    return !!this.#outcome;
  }
  get value() {
    return this.#value;
  }
  then(onfulfilled, onrejected) {
    return this.#promise.then(onfulfilled, onrejected);
  }
  resolve(value) {
    this.#outcome = 0 /* Resolved */;
    this.#value = value;
    this.#resolve(value);
  }
  reject(error) {
    this.#outcome = 1 /* Rejected */;
    this.#value = error;
    this.#reject(error);
  }
};
var Barrier = class extends DeferredPromise {
  static {
    __name(this, "Barrier");
  }
  get isOpen() {
    return this.resolved && this.value === true;
  }
  open() {
    this.resolve(true);
  }
};

// base/paths.ts
function dirname(path) {
  if (path instanceof URL) {
    path = path.pathname;
  }
  return path.split("/").slice(0, -1).join("/");
}
__name(dirname, "dirname");
function basename(path) {
  if (path instanceof URL) {
    path = path.pathname;
  }
  return path.split("/").at(-1);
}
__name(basename, "basename");
function extension(path) {
  const res = path.split(".");
  if (res.length <= 1) {
    return "";
  }
  return res.at(-1);
}
__name(extension, "extension");
function normalize_join(...parts) {
  return parts.flatMap((p) => p.split("/")).filter((s) => s !== "").join("/");
}
__name(normalize_join, "normalize_join");
function based_on(parent, absolute) {
  if (parent === absolute) {
    return "";
  }
  const base = normalize_join(parent);
  const prefix = base.length > 0 ? base + "/" : "";
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
}
__name(based_on, "based_on");

// base/dom/download.ts
function initiate_download(file_or_url) {
  let url;
  let name;
  if (file_or_url instanceof File) {
    url = URL.createObjectURL(file_or_url);
    name = file_or_url.name;
  } else {
    url = file_or_url.href;
    name = basename(url);
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.target = "_blank";
  console.log(anchor);
  anchor.click();
  if (file_or_url instanceof File) {
    URL.revokeObjectURL(url);
  }
}
__name(initiate_download, "initiate_download");

// kicanvas/services/vfs.ts
var FileSystemBase = class _FileSystemBase {
  static {
    __name(this, "FileSystemBase");
  }
  constructor(entries = /* @__PURE__ */ new Map()) {
    this.entries = entries;
  }
  *list() {
    for (const [path, entry] of this.entries) {
      if (entry.type === "file") {
        yield path;
      }
    }
  }
  async setup() {
    await this.walk("");
  }
  async get(name) {
    if (!await this.has(name)) {
      throw new Error(`File ${name} not found`);
    }
    return await this.load_file(name);
  }
  async has(name) {
    const dir = dirname(name);
    if (!this.entries.has(dir) && !this.entries.has(name)) {
      return false;
    }
    await this.walk(dir);
    const obj = this.entries.get(name);
    return !!obj && obj.type === "file";
  }
  async download(name) {
    initiate_download(await this.get(name));
  }
  /**
   * Return true if a file has extension name `.kicad_pcb`, `.kicad_prj` or `.kicad_sch`
   */
  static is_kicad_file(name) {
    const exts = ["kicad_pcb", "kicad_pro", "kicad_sch"];
    return exts.includes(extension(name));
  }
  /**
   * Walk through directories and update `this.entries`
   */
  async walk(dir) {
    if (this.entries.get(dir)?.type === "visited-directory") {
      return;
    }
    const entries = await this.enumerate(dir);
    this.entries.set(dir, { path: dir, type: "visited-directory" });
    for (const it of entries) {
      if (it.type === "file" && !_FileSystemBase.is_kicad_file(it.path)) {
        continue;
      }
      this.entries.set(it.path, it);
    }
  }
};
var MergedFileSystem = class {
  static {
    __name(this, "MergedFileSystem");
  }
  constructor(fs) {
    this.fs_list = fs.filter((f) => f !== null);
  }
  *list() {
    for (const fs of this.fs_list) {
      yield* fs.list();
    }
  }
  async setup() {
    for (const fs of this.fs_list) {
      await fs.setup();
    }
  }
  async has(name) {
    for (const fs of this.fs_list) {
      if (await fs.has(name)) {
        return true;
      }
    }
    return false;
  }
  async get(name) {
    for (const fs of this.fs_list) {
      if (await fs.has(name)) {
        return await fs.get(name);
      }
    }
    throw new Error(`File ${name} not found`);
  }
  async download(name) {
    for (const fs of this.fs_list) {
      if (await fs.has(name)) {
        return await fs.download(name);
      }
    }
    throw new Error(`File ${name} not found`);
  }
};
var LocalFileSystemBase = class _LocalFileSystemBase extends FileSystemBase {
  constructor(file_list) {
    super(_LocalFileSystemBase.into_entries(file_list));
    this.file_list = file_list;
  }
  static {
    __name(this, "LocalFileSystemBase");
  }
  async load_file(path) {
    const file = this.file_list.get(path);
    if (!file) {
      throw new Error(`File ${path} not found!`);
    }
    return file;
  }
  async enumerate(base_dir) {
    return [];
  }
  static into_entries(files) {
    const result = /* @__PURE__ */ new Map();
    for (const path of files.keys()) {
      result.set(path, { path, type: "file" });
    }
    return result;
  }
};
var FetchFileSystem = class extends FileSystemBase {
  constructor(urls, resolve_file = null) {
    super();
    this.urls = /* @__PURE__ */ new Map();
    this.resolver = resolve_file ?? this.#default_resolver;
    for (const item of urls) {
      this.#resolve(item);
    }
  }
  static {
    __name(this, "FetchFileSystem");
  }
  #default_resolver(name) {
    const url = new URL(name, window.location.toString());
    return url;
  }
  #resolve(filepath) {
    if (typeof filepath === "string") {
      const cached_url = this.urls.get(filepath);
      if (cached_url) {
        return cached_url;
      } else {
        const url = this.resolver(filepath);
        const name = basename(url);
        this.urls.set(name, url);
        return url;
      }
    }
    return filepath;
  }
  async load_file(path) {
    const url = this.#resolve(path);
    if (!url) {
      throw new Error(`File ${path} not found!`);
    }
    const request = new Request(url, { method: "GET" });
    const response = await fetch(request);
    if (!response.ok) {
      throw new Error(
        `Unable to load ${url}: ${response.status} ${response.statusText}`
      );
    }
    const blob = await response.blob();
    return new File([blob], path);
  }
  async enumerate(base_dir) {
    return Array.from(this.urls.keys()).map((path) => ({
      path,
      type: "file"
    }));
  }
};
var DragAndDropFileSystem = class _DragAndDropFileSystem extends LocalFileSystemBase {
  static {
    __name(this, "DragAndDropFileSystem");
  }
  static async fromDataTransfer(dt) {
    const items = [];
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i]?.webkitGetAsEntry();
      if (item) {
        items.push(item);
      }
    }
    const files = await _DragAndDropFileSystem.walk(items);
    const file_map = /* @__PURE__ */ new Map();
    for (const entry of files) {
      if (entry.isFile && _DragAndDropFileSystem.is_kicad_file(entry.name)) {
        const file = await _DragAndDropFileSystem.load(entry);
        file_map.set(normalize_join(entry.fullPath), file);
      }
    }
    const lcp = _DragAndDropFileSystem.lcp(Array.from(file_map.keys()));
    const res = new Map(
      [...file_map].map(([p, f]) => [based_on(lcp, p), f])
    );
    return new _DragAndDropFileSystem(res);
  }
  static lcp(str) {
    if (str.length === 0) {
      return "";
    }
    const str_arr = str.map(
      (s) => s.split("/").filter(Boolean).slice(0, -1)
    );
    const fst = str_arr[0];
    let p_len = fst.length;
    for (const s of str_arr.slice(1)) {
      let i = 0;
      while (i < p_len && i < s.length && fst[i] === s[i]) {
        i += 1;
      }
      p_len = i;
      if (p_len === 0) {
        break;
      }
    }
    return fst.slice(0, p_len).join("/");
  }
  static async load(entry) {
    return await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
  }
  static async walk(items) {
    const files = [];
    while (items.length > 0) {
      const item = items.pop();
      if (item.isFile) {
        files.push(item);
      } else if (item.isDirectory) {
        const reader = item.createReader();
        await new Promise((resolve, reject) => {
          reader.readEntries((entries) => {
            for (const entry of entries) {
              if (entry.isFile) {
                files.push(entry);
              } else if (entry.isDirectory) {
                items.push(entry);
              }
            }
            resolve(true);
          }, reject);
        });
      }
    }
    return files;
  }
};
var LocalFileSystem = class extends LocalFileSystemBase {
  static {
    __name(this, "LocalFileSystem");
  }
  constructor(files) {
    super(new Map(files.map((f) => [f.name, f])));
  }
};

// base/dom/drag-drop.ts
var DropTarget = class {
  static {
    __name(this, "DropTarget");
  }
  constructor(elm, callback) {
    elm.addEventListener(
      "dragenter",
      (e) => {
        e.preventDefault();
      },
      false
    );
    elm.addEventListener(
      "dragover",
      (e) => {
        if (!e.dataTransfer) {
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      false
    );
    elm.addEventListener(
      "drop",
      async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dt = e.dataTransfer;
        if (!dt) {
          return;
        }
        const fs = await DragAndDropFileSystem.fromDataTransfer(dt);
        callback(fs);
      },
      false
    );
  }
};

// base/dom/file-picker.ts
var FilePicker = class _FilePicker {
  static {
    __name(this, "FilePicker");
  }
  /**
   * Open file picker and call callback with the selected files.
   */
  static async pick(callback) {
    const files = await _FilePicker.open_picker();
    if (files.length > 0) {
      await callback(new LocalFileSystem(files));
    }
  }
  /**
   * Open the file picker
   */
  static open_picker() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.style.display = "none";
      input.multiple = true;
      input.accept = ".kicad_pcb,.kicad_pro,.kicad_sch";
      input.onchange = (event) => {
        const files = event.target.files;
        if (files && files.length > 0) {
          resolve(Array.from(files));
        } else {
          resolve([]);
        }
      };
      input.oncancel = () => {
        resolve([]);
      };
      input.click();
    });
  }
};

// base/web-components/context.ts
var ContextRequestEvent = class _ContextRequestEvent extends Event {
  constructor(context_name, _callback) {
    super(_ContextRequestEvent.type, {
      bubbles: true,
      cancelable: true,
      composed: true
    });
    this.context_name = context_name;
    this._callback = _callback;
  }
  static {
    __name(this, "ContextRequestEvent");
  }
  static {
    this.type = "context-request";
  }
  callback(context) {
    this.stopPropagation();
    this._callback(context);
  }
};
async function requestContext(target, context_name) {
  return new Promise((resolve) => {
    target.dispatchEvent(
      new ContextRequestEvent(context_name, (context) => {
        resolve(context);
      })
    );
  });
}
__name(requestContext, "requestContext");
function provideContext(target, context_name, context) {
  target.addEventListener(ContextRequestEvent.type, (e) => {
    const request_event = e;
    if (request_event.context_name == context_name) {
      request_event.callback(context);
    }
  });
}
__name(provideContext, "provideContext");
async function requestLazyContext(target, context_name) {
  return (await requestContext(target, context_name))();
}
__name(requestLazyContext, "requestLazyContext");
async function provideLazyContext(target, context_name, context) {
  provideContext(target, context_name, context);
}
__name(provideLazyContext, "provideLazyContext");
function WithContext(Base) {
  return class WithContext extends Base {
    static {
      __name(this, "WithContext");
    }
    constructor(...args) {
      super(...args);
    }
    /** Request context from ancestors */
    async requestContext(context_name) {
      return await requestContext(this, context_name);
    }
    /** Provide context to descendants */
    provideContext(context_name, context) {
      provideContext(this, context_name, context);
    }
    /** Request context from ancestors lazily */
    async requestLazyContext(context_name) {
      return await requestLazyContext(this, context_name);
    }
    /** Provide context to descendants lazily */
    provideLazyContext(context_name, context) {
      provideLazyContext(this, context_name, context);
    }
  };
}
__name(WithContext, "WithContext");

// base/types.ts
function is_primitive(value) {
  return value === null || typeof value != "object" && typeof value != "function";
}
__name(is_primitive, "is_primitive");
function is_string(value) {
  return typeof value === "string";
}
__name(is_string, "is_string");
function is_number(value) {
  return typeof value === "number" && !isNaN(value);
}
__name(is_number, "is_number");
function is_iterable(value) {
  return Array.isArray(value) || typeof value?.[Symbol.iterator] === "function";
}
__name(is_iterable, "is_iterable");
function is_array(value) {
  return Array.isArray(value);
}
__name(is_array, "is_array");
function is_object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof RegExp) && !(value instanceof Date);
}
__name(is_object, "is_object");

// base/web-components/css.ts
var stylesheet_cache = /* @__PURE__ */ new Map();
var CSS = class {
  constructor(css_string) {
    this.css_string = css_string;
  }
  static {
    __name(this, "CSS");
  }
  get stylesheet() {
    let sheet = stylesheet_cache.get(this.css_string);
    if (sheet == void 0) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(this.css_string);
      stylesheet_cache.set(this.css_string, sheet);
    }
    return sheet;
  }
};
function css(strings, ...values) {
  let text = "";
  for (let i = 0; i < strings.length - 1; i++) {
    text += strings[i];
    const value = values[i];
    if (value instanceof CSS) {
      text += value.css_string;
    } else if (is_number(value)) {
      text += String(value);
    } else {
      throw new Error(
        "Only CSS or number variables allowed in css template literal"
      );
    }
  }
  text += strings.at(-1);
  return new CSS(text);
}
__name(css, "css");
function adopt_styles(root, styles) {
  root.adoptedStyleSheets = root.adoptedStyleSheets.concat(
    styles.map((ss) => ss instanceof CSSStyleSheet ? ss : ss.stylesheet)
  );
}
__name(adopt_styles, "adopt_styles");

// base/array.ts
function as_array(x) {
  if (is_array(x)) {
    return x;
  }
  return [x];
}
__name(as_array, "as_array");
function iterable_as_array(x) {
  if (is_array(x)) {
    return x;
  }
  if (is_iterable(x)) {
    return Array.from(x);
  }
  return [x];
}
__name(iterable_as_array, "iterable_as_array");
var collator = new Intl.Collator(void 0, { numeric: true });
function sorted_by_numeric_strings(array, getter) {
  return array.slice().sort((a, b) => collator.compare(getter(a), getter(b)));
}
__name(sorted_by_numeric_strings, "sorted_by_numeric_strings");

// base/disposable.ts
var Disposables = class {
  constructor() {
    this._disposables = /* @__PURE__ */ new Set();
    this._is_disposed = false;
  }
  static {
    __name(this, "Disposables");
  }
  add(item) {
    if (this._is_disposed) {
      throw new Error(
        "Tried to add item to a DisposableStack that's already been disposed"
      );
    }
    this._disposables.add(item);
    return item;
  }
  disposeAndRemove(item) {
    if (!item) {
      return;
    }
    item.dispose();
    this._disposables.delete(item);
  }
  get isDisposed() {
    return this._is_disposed;
  }
  dispose() {
    if (this._is_disposed) {
      console.trace("dispose() called on an already disposed resource");
      return;
    }
    for (const item of this._disposables.values()) {
      item.dispose();
    }
    this._disposables.clear();
    this._is_disposed = true;
  }
};

// base/web-components/html.ts
function is_HTMLElement(v) {
  return typeof HTMLElement === "object" && v instanceof HTMLElement;
}
__name(is_HTMLElement, "is_HTMLElement");
function html(strings, ...values) {
  const template = document.createElement(`template`);
  template.innerHTML = prepare_template_html(strings, values);
  let content = template.content;
  content = document.importNode(content, true);
  apply_values_to_tree(content, values);
  if (content.childElementCount == 1) {
    return content.firstElementChild;
  } else {
    return content;
  }
}
__name(html, "html");
function literal(strings, ...values) {
  let str = "";
  strings.forEach((string, i) => {
    str += string + (values[i] ?? "");
  });
  return new Literal(str);
}
__name(literal, "literal");
var Literal = class {
  constructor(text) {
    this.text = text;
  }
  static {
    __name(this, "Literal");
  }
};
var placeholder_regex = /\$\$:(\d+):\$\$/g;
function prepare_template_html(strings, values) {
  const template_parts = [];
  for (let i = 0; i < strings.length - 1; i++) {
    template_parts.push(strings[i]);
    if (values[i] instanceof Literal) {
      template_parts.push(values[i].text);
    } else {
      template_parts.push(`$$:${i}:$$`);
    }
  }
  template_parts.push(strings[strings.length - 1]);
  const template_string = template_parts.join("");
  return template_string;
}
__name(prepare_template_html, "prepare_template_html");
function apply_values_to_tree(tree, values) {
  const walker = document.createTreeWalker(
    tree,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while ((node = walker.nextNode()) !== null) {
    if (node.nodeType == Node.TEXT_NODE) {
      apply_content_value(node.parentNode, node, values);
    } else if (node.nodeType == Node.ELEMENT_NODE) {
      const elm = node;
      for (const attr_name of elm.getAttributeNames()) {
        const attr = elm.getAttributeNode(attr_name);
        apply_attribute_value(elm, attr, values);
      }
    }
  }
}
__name(apply_values_to_tree, "apply_values_to_tree");
function apply_content_value(node, text, values) {
  if (!node) {
    return;
  }
  const parts = text.data.split(placeholder_regex);
  if (!parts || parts.length == 1) {
    return;
  }
  if (is_HTMLElement(node) && ["script", "style"].includes(node.localName)) {
    throw new Error(
      `Cannot bind values inside of <script> or <style> tags`
    );
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    if (i % 2 == 0) {
      node.insertBefore(new Text(part), text);
    } else {
      for (const value of convert_value_for_content(
        values[parseInt(part, 10)]
      )) {
        if (value == null) continue;
        node.insertBefore(value, text);
      }
    }
  }
  text.data = "";
}
__name(apply_content_value, "apply_content_value");
function apply_attribute_value(elm, attr, values) {
  const parts = attr.value.split(placeholder_regex);
  if (!parts || parts.length == 1) {
    return;
  }
  if (attr.localName.startsWith("on")) {
    throw new Error(`Cannot bind to event handler ${attr.localName}.`);
  }
  if (parts.length == 3 && parts[0] == "" && parts[2] == "") {
    const value = values[parseInt(parts[1], 10)];
    if (value === true) {
      attr.value = "";
    } else if (value === false || value === null || value === void 0) {
      elm.removeAttribute(attr.name);
    } else {
      attr.value = convert_value_for_attr(value, attr.name);
    }
    return;
  }
  attr.value = attr.value.replaceAll(
    placeholder_regex,
    (_, number) => {
      const value = values[parseInt(number, 10)];
      return convert_value_for_attr(value, attr.localName);
    }
  );
}
__name(apply_attribute_value, "apply_attribute_value");
function* convert_value_for_content(value) {
  if (value == null || value == void 0) {
    return;
  }
  if (is_primitive(value)) {
    yield new Text(value.toString());
    return;
  }
  if (value instanceof Node || value instanceof DocumentFragment) {
    yield value;
    return;
  }
  if (is_iterable(value)) {
    for (const i of value) {
      yield* convert_value_for_content(i);
    }
    return;
  }
  throw new Error(`Invalid value ${value}`);
}
__name(convert_value_for_content, "convert_value_for_content");
function convert_value_for_attr(value, attr_name) {
  if (value == null || value == void 0) {
    return "";
  }
  if (is_primitive(value)) {
    return value.toString();
  }
  if (is_iterable(value)) {
    return Array.from(value).map((v) => convert_value_for_attr(v, attr_name)).join("");
  }
  throw new Error(`Invalid value ${value}`);
}
__name(convert_value_for_attr, "convert_value_for_attr");

// base/web-components/custom-element.ts
var CustomElement = class extends HTMLElement {
  constructor() {
    super();
    this.updateComplete = new DeferredPromise();
    this.disposables = new Disposables();
    const static_this = this.constructor;
    if (static_this.exportparts.length) {
      this.setAttribute("exportparts", static_this.exportparts.join(","));
    }
  }
  static {
    __name(this, "CustomElement");
  }
  static {
    /**
     * If true, a shadowRoot is created for this element.
     */
    this.useShadowRoot = true;
  }
  static {
    /**
     * Exports nested shadow dom parts
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/exportparts
     */
    this.exportparts = [];
  }
  addDisposable(item) {
    return this.disposables.add(item);
  }
  /**
   * Returns either the shadowRoot or this if useShadowRoot is false.
   */
  get renderRoot() {
    return this.shadowRoot ?? this;
  }
  /**
   * Called when connected to the DOM
   *
   * By default it calls render() to place the initial content to the
   * renderRoot.
   */
  connectedCallback() {
    this.#renderInitialContent();
  }
  disconnectedCallback() {
    this.disposables.dispose();
  }
  /**
   * Called after the initial content is added to the renderRoot, perfect
   * for registering event callbacks.
   */
  initialContentCallback() {
  }
  /**
   * Called to render content to the renderRoot.
   */
  render() {
    return html``;
  }
  renderedCallback() {
  }
  async update() {
    this.updateComplete = new DeferredPromise();
    while (this.renderRoot.firstChild) {
      this.renderRoot.firstChild.remove();
    }
    this.renderRoot.appendChild(await this.render());
    this.renderedCallback();
    window.requestAnimationFrame(() => {
      this.updateComplete.resolve(true);
    });
    return this.updateComplete;
  }
  #renderInitialContent() {
    const static_this = this.constructor;
    this.updateComplete = new DeferredPromise();
    if (this.constructor.useShadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    if (static_this.styles) {
      adopt_styles(
        this.shadowRoot ?? document,
        as_array(static_this.styles)
      );
    }
    (async () => {
      const content = this.render();
      this.renderRoot.appendChild(content);
      this.renderedCallback();
      this.initialContentCallback();
      window.requestAnimationFrame(() => {
        this.updateComplete.resolve(true);
      });
    })();
    return this.updateComplete;
  }
  queryAssignedElements(slot_name, selector) {
    const slot_element = this.renderRoot.querySelector(
      `slot${slot_name ? `[name=${slot_name}]` : ":not([name])"}`
    );
    const elements = slot_element?.assignedElements() ?? [];
    if (selector) {
      return elements.filter((elm) => elm.matches(selector));
    } else {
      return elements;
    }
  }
};

// base/web-components/decorators.ts
function attribute(options) {
  const to = options.converter?.to_attribute ?? default_attribute_converter.to_attribute;
  const from = options.converter?.from_attribute ?? default_attribute_converter.from_attribute;
  return (target, propertyKey) => {
    const attributeKey = propertyKey.replace("_", "-");
    let running_on_change = false;
    Object.defineProperty(target, propertyKey, {
      enumerable: true,
      configurable: true,
      get() {
        return from(this.getAttribute(attributeKey), options.type);
      },
      set(value) {
        const old = this[propertyKey];
        const converted = to(value, options.type);
        if (converted === null) {
          this.removeAttribute(attributeKey);
        } else {
          this.setAttribute(attributeKey, converted);
        }
        if (!running_on_change) {
          running_on_change = true;
          options.on_change?.(old, value);
          running_on_change = false;
        }
      }
    });
  };
}
__name(attribute, "attribute");
var default_attribute_converter = {
  to_attribute(value, type) {
    if (value === null) {
      return value;
    }
    switch (type) {
      case Boolean:
        return value ? "" : null;
      case String:
        return value;
      case Number:
        return `${value}`;
      default:
        throw new Error(
          `Cannot convert type "${type}" and value "${value} to attribute`
        );
    }
  },
  from_attribute(value, type) {
    switch (type) {
      case Boolean:
        return value !== null;
      case String:
        return value;
      case Number:
        return value === null ? null : Number(value);
      default:
        throw new Error(
          `Cannot convert type "${type}" and value "${value} to attribute`
        );
    }
  }
};
function query(selector, cache) {
  return (target, propertyKey) => {
    const cache_key = typeof propertyKey === "symbol" ? /* @__PURE__ */ Symbol() : `__${propertyKey}`;
    Object.defineProperty(target, propertyKey, {
      enumerable: true,
      configurable: true,
      get() {
        const this_as_record = this;
        if (cache && this_as_record[cache_key] !== void 0) {
          return this_as_record[cache_key];
        }
        const result = this.renderRoot?.querySelector(selector) ?? null;
        if (cache && result) {
          this_as_record[cache_key] = result;
        }
        return result;
      }
    });
  };
}
__name(query, "query");
function query_all(selector) {
  return (target, propertyKey) => {
    Object.defineProperty(target, propertyKey, {
      enumerable: true,
      configurable: true,
      get() {
        return this.renderRoot?.querySelectorAll(selector) ?? [];
      }
    });
  };
}
__name(query_all, "query_all");

// base/events.ts
function listen(target, type, handler, use_capture_or_options) {
  target.addEventListener(type, handler, use_capture_or_options);
  return {
    dispose: /* @__PURE__ */ __name(() => {
      target.removeEventListener(type, handler, use_capture_or_options);
    }, "dispose")
  };
}
__name(listen, "listen");
function delegate(parent, match, type, handler, use_capture_or_options) {
  return listen(
    parent,
    type,
    (e) => {
      const el = e.target.closest(match);
      if (!el) {
        return;
      }
      handler(e, el);
    },
    use_capture_or_options
  );
}
__name(delegate, "delegate");

// kc-ui/element.ts
var common_styles = css`
    :host {
        box-sizing: border-box;
    }

    :host *,
    :host *::before,
    :host *::after {
        box-sizing: inherit;
    }

    [hidden] {
        display: none !important;
    }

    :host {
        scrollbar-width: thin;
        scrollbar-color: #ae81ff #282634;
    }

    ::-webkit-scrollbar {
        position: absolute;
        width: 6px;
        height: 6px;
        margin-left: -6px;
        background: var(--scrollbar-bg);
    }

    ::-webkit-scrollbar-thumb {
        position: absolute;
        background: var(--scrollbar-fg);
    }

    ::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-hover-fg);
    }

    ::-webkit-scrollbar-thumb:active {
        background: var(--scrollbar-active-fg);
    }

    .invert-scrollbar::-webkit-scrollbar {
        position: absolute;
        width: 6px;
        height: 6px;
        margin-left: -6px;
        background: var(--scrollbar-fg);
    }

    .invert-scrollbar::-webkit-scrollbar-thumb {
        position: absolute;
        background: var(--scrollbar-bg);
    }

    .invert-scrollbar::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-hover-bg);
    }

    .invert-scrollbar::-webkit-scrollbar-thumb:active {
        background: var(--scrollbar-active-bg);
    }
`;
var KCUIElement = class extends WithContext(CustomElement) {
  static {
    __name(this, "KCUIElement");
  }
  static {
    this.styles = [common_styles];
  }
};

// kc-ui/icon.ts
var KCUIIconElement = class _KCUIIconElement extends KCUIElement {
  static {
    __name(this, "KCUIIconElement");
  }
  static {
    this.sprites_url = "";
  }
  static {
    this.styles = [
      css`
            :host {
                box-sizing: border-box;
                font-family: "Material Symbols Outlined";
                font-weight: normal;
                font-style: normal;
                font-size: inherit;
                line-height: 1;
                letter-spacing: normal;
                text-transform: none;
                white-space: nowrap;
                word-wrap: normal;
                direction: ltr;
                -webkit-font-feature-settings: "liga";
                -moz-font-feature-settings: "liga";
                font-feature-settings: "liga";
                -webkit-font-smoothing: antialiased;
                user-select: none;
            }

            svg {
                width: 1.2em;
                height: auto;
                fill: currentColor;
            }
        `
    ];
  }
  render() {
    const text = this.textContent ?? "";
    if (text.startsWith("svg:")) {
      const name = text.slice(4);
      const url = `${_KCUIIconElement.sprites_url}#${name}`;
      return html`<svg viewBox="0 0 48 48" width="48">
                <use xlink:href="${literal`${url}`}" />
            </svg>`;
    } else {
      return html`<slot></slot>`;
    }
  }
};
window.customElements.define("kc-ui-icon", KCUIIconElement);

// kc-ui/button.ts
var KCUIButtonElement = class extends KCUIElement {
  static {
    __name(this, "KCUIButtonElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: inline-flex;
                position: relative;
                width: auto;
                cursor: pointer;
                user-select: none;
                align-items: center;
                justify-content: center;
            }

            button {
                all: unset;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0.5em;
                border: 1px solid transparent;
                border-radius: 0.25em;
                font-weight: medium;
                font-size: 1em;
                background: var(--button-bg);
                color: var(--button-fg);
                transition:
                    color var(--transition-time-short) ease,
                    border var(--transition-time-short) ease,
                    background var(--transition-time-short) ease;
            }

            :host {
                fill: var(--button-fg);
            }

            button:hover {
                background: var(--button-hover-bg);
                color: var(--button-hover-fg);
            }

            button:disabled {
                background: var(--button-disabled-bg);
                color: var(--button-disabled-fg);
            }

            button:focus {
                outline: var(--button-focus-outline);
            }

            :host([selected]) button {
                background: var(--button-selected-bg);
                color: var(--button-selected-fg);
            }

            /* variants */

            button.outline {
                background: var(--button-outline-bg);
                color: var(--button-outline-fg);
            }

            button.outline:hover {
                background: var(--button-outline-hover-bg);
                color: var(--button-outline-hover-fg);
            }

            button.outline:disabled {
                background: var(--button-outline-disabled-bg);
                color: var(--button-outline-disabled-fg);
            }

            :host([selected]) button.outline {
                background: var(--button-outline-disabled-bg);
                color: var(--button--outline-disabled-fg);
            }

            button.toolbar {
                background: var(--button-toolbar-bg);
                color: var(--button-toolbar-fg);
            }

            button.toolbar:hover {
                background: var(--button-toolbar-hover-bg);
                color: var(--button-toolbar-hover-fg);
            }

            button.toolbar:disabled {
                background: var(--button-toolbar-disabled-bg);
                color: var(--button-toolbar-disabled-fg);
            }

            :host([selected]) button.toolbar {
                background: var(--button-toolbar-disabled-bg);
                color: var(--button--toolbar-disabled-fg);
            }

            button.toolbar-alt {
                background: var(--button-toolbar-alt-bg);
                color: var(--button-toolbar-alt-fg);
            }

            button.toolbar-alt:hover {
                background: var(--button-toolbar-alt-hover-bg);
                color: var(--button-toolbar-alt-hover-fg);
            }

            button.toolbar-alt:disabled {
                background: var(--button-toolbar-alt-disabled-bg);
                color: var(--button-toolbar-alt-disabled-fg);
            }

            :host([selected]) button.toolbar-alt {
                background: var(--button-toolbar-alt-disabled-bg);
                color: var(--button--toolbar-alt-disabled-fg);
            }

            button.menu {
                background: var(--button-menu-bg);
                color: var(--button-menu-fg);
                padding: 0;
            }

            button.menu:hover {
                background: var(--button-menu-hover-bg);
                color: var(--button-menu-hover-fg);
                outline: none;
            }

            button.menu:focus {
                outline: none;
            }

            button.menu:disabled {
                background: var(--button-menu-disabled-bg);
                color: var(--button-menu-disabled-fg);
            }

            :host([selected]) button.menu {
                background: var(--button-menu-disabled-bg);
                color: var(--button--menu-disabled-fg);
                outline: none;
            }
        `
    ];
  }
  static get observedAttributes() {
    return ["disabled", "icon"];
  }
  attributeChangedCallback(name, old, value) {
    if (!this.button) {
      return;
    }
    switch (name) {
      case "disabled":
        this.button.disabled = value == null ? false : true;
        break;
      case "icon":
        this.button_icon.innerText = value ?? "";
        break;
    }
  }
  initialContentCallback() {
    if (this.variant) {
      this.button.classList.add(this.variant);
    }
    this.button.disabled = this.disabled;
  }
  render() {
    const icon = this.icon ? html`<kc-ui-icon part="icon">${this.icon}</kc-ui-icon>` : void 0;
    return html`<button part="base">
            ${icon}
            <slot part="contents"></slot>
        </button>`;
  }
};
__decorateClass([
  query("button", true)
], KCUIButtonElement.prototype, "button", 2);
__decorateClass([
  query("button_icon", true)
], KCUIButtonElement.prototype, "button_icon", 2);
__decorateClass([
  attribute({ type: String })
], KCUIButtonElement.prototype, "name", 2);
__decorateClass([
  attribute({ type: String })
], KCUIButtonElement.prototype, "icon", 2);
__decorateClass([
  attribute({ type: String })
], KCUIButtonElement.prototype, "variant", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIButtonElement.prototype, "disabled", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIButtonElement.prototype, "selected", 2);
window.customElements.define("kc-ui-button", KCUIButtonElement);

// kc-ui/activity-side-bar.ts
var KCUIActivitySideBarElement = class extends KCUIElement {
  static {
    __name(this, "KCUIActivitySideBarElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                flex-shrink: 0;
                display: flex;
                flex-direction: row;
                height: 100%;
                overflow: hidden;
                min-width: calc(max(20%, 200px));
                max-width: calc(max(20%, 200px));
            }

            div {
                display: flex;
                overflow: hidden;
                flex-direction: column;
            }

            div.bar {
                flex-grow: 0;
                flex-shrink: 0;
                height: 100%;
                z-index: 1;
                display: flex;
                flex-direction: column;
                background: var(--activity-bar-bg);
                color: var(--activity-bar-fg);
                padding: 0.2em;
                user-select: none;
            }

            div.start {
                flex: 1;
            }

            div.activities {
                flex-grow: 1;
            }

            kc-ui-button {
                --button-bg: transparent;
                --button-fg: var(--activity-bar-fg);
                --button-hover-bg: var(--activity-bar-active-bg);
                --button-hover-fg: var(--activity-bar-active-fg);
                --button-selected-bg: var(--activity-bar-active-bg);
                --button-selected-fg: var(--activity-bar-active-fg);
                --button-focus-outline: none;
                margin-bottom: 0.25em;
            }

            kc-ui-button:last-child {
                margin-bottom: 0;
            }

            ::slotted(kc-ui-activity) {
                display: none;
                height: 100%;
            }

            ::slotted(kc-ui-activity[active]) {
                display: block;
            }
        `
    ];
  }
  #activity;
  get #activities() {
    return this.querySelectorAll("kc-ui-activity");
  }
  get #activity_names() {
    return Array.from(this.#activities).map((x) => {
      return (x.getAttribute("name") ?? "").toLowerCase();
    });
  }
  get #default_activity_name() {
    return (this.#activities[0]?.getAttribute("name") ?? "").toLowerCase();
  }
  render() {
    const top_buttons = [];
    const bottom_buttons = [];
    for (const activity of this.#activities) {
      const name = activity.getAttribute("name");
      const icon = activity.getAttribute("icon");
      const button_location = activity.getAttribute("button-location");
      (button_location == "bottom" ? bottom_buttons : top_buttons).push(
        html`
                    <kc-ui-button
                        type="button"
                        tooltip-left="${name}"
                        name="${name?.toLowerCase()}"
                        title="${name}"
                        icon=${icon}>
                    </kc-ui-button>
                `
      );
    }
    return html`<div class="bar">
                <div class="start">${top_buttons}</div>
                <div class="end">${bottom_buttons}</div>
            </div>
            <div class="activities">
                <slot name="activities"></slot>
            </div>`;
  }
  initialContentCallback() {
    if (!this.collapsed) {
      this.change_activity(this.#default_activity_name);
    } else {
      this.change_activity(null);
    }
    delegate(this.renderRoot, "kc-ui-button", "click", (e, source) => {
      this.change_activity(source.name, true);
    });
    const observer = new MutationObserver(async (mutations) => {
      await this.update();
      if (this.#activity && !this.#activity_names.includes(this.#activity)) {
        this.change_activity(this.#default_activity_name);
      }
    });
    observer.observe(this, {
      childList: true
    });
  }
  static get observedAttributes() {
    return ["collapsed"];
  }
  attributeChangedCallback(name, old, value) {
    switch (name) {
      case "collapsed":
        if (value == void 0) {
          this.show_activities();
        } else {
          this.hide_activities();
        }
        break;
      default:
        break;
    }
  }
  get activity() {
    return this.#activity;
  }
  set activity(name) {
    this.change_activity(name, false);
  }
  hide_activities() {
    if (!this.activities_container) {
      return;
    }
    this.style.width = "unset";
    this.style.minWidth = "unset";
    this.style.maxWidth = "";
    this.activities_container.style.width = "0px";
  }
  show_activities() {
    if (!this.activities_container) {
      return;
    }
    if (!this.#activity) {
      this.change_activity(this.#default_activity_name);
    }
    this.style.minWidth = "";
    this.activities_container.style.width = "";
  }
  change_activity(name, toggle = false) {
    name = name?.toLowerCase();
    if (this.#activity == name && toggle) {
      this.#activity = null;
    } else {
      this.#activity = name;
    }
    if (!this.#activity) {
      this.collapsed = true;
    } else {
      this.collapsed = false;
    }
    this.update_state();
  }
  update_state() {
    for (const btn of this.buttons) {
      btn.selected = btn.name == this.#activity;
    }
    for (const activity of this.#activities) {
      if (activity.getAttribute("name")?.toLowerCase() == this.#activity) {
        activity.setAttribute("active", "");
      } else {
        activity.removeAttribute("active");
      }
    }
  }
};
__decorateClass([
  query(".activities", true)
], KCUIActivitySideBarElement.prototype, "activities_container", 2);
__decorateClass([
  query_all("kc-ui-button")
], KCUIActivitySideBarElement.prototype, "buttons", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIActivitySideBarElement.prototype, "collapsed", 2);
window.customElements.define(
  "kc-ui-activity-side-bar",
  KCUIActivitySideBarElement
);

// kc-ui/app.ts
var KCUIAppElement = class extends CustomElement {
  static {
    __name(this, "KCUIAppElement");
  }
  static {
    this.useShadowRoot = false;
  }
};
window.customElements.define("kc-ui-app", KCUIAppElement);

// kc-ui/control-list.ts
var KCUIControlListElement = class extends KCUIElement {
  static {
    __name(this, "KCUIControlListElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: flex;
                flex-direction: column;
                flex-wrap: nowrap;
                background: var(--list-item-bg);
                color: var(--list-item-fg);
                padding-top: 0.2em;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-control-list", KCUIControlListElement);
var KCUIControlListItemElement = class extends KCUIElement {
  static {
    __name(this, "KCUIControlListItemElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                margin-top: 0.2em;
                display: flex;
                flex-direction: column;
                flex-wrap: nowrap;
                user-select: none;
                background-color: transparent;
                transition:
                    color var(--transition-time-short) ease,
                    background-color var(--transition-time-short) ease;
            }

            ::slotted(label) {
                flex: 1 1 100%;
                display: block;
                margin: 0;
                overflow-wrap: anywhere;
            }

            ::slotted(input),
            ::slotted(select) {
                margin: 0;
                padding-left: 0;
                padding-right: 0;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define(
  "kc-ui-control-list-item",
  KCUIControlListItemElement
);

// base/functions.ts
function no_self_recursion(target, propertyKey, descriptor) {
  const fn = descriptor.value;
  let _is_running = false;
  descriptor.value = function(...args) {
    if (_is_running) {
      return;
    }
    _is_running = true;
    try {
      fn.apply(this, args);
    } finally {
      _is_running = false;
    }
  };
}
__name(no_self_recursion, "no_self_recursion");

// kc-ui/menu.ts
var KCUIMenuElement = class extends KCUIElement {
  static {
    __name(this, "KCUIMenuElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                width 100%;
                display: flex;
                flex-direction: column;
                flex-wrap: nowrap;
                background: var(--list-item-bg);
                color: var(--list-item-fg);
            }

            :host(.outline) ::slotted(kc-ui-menu-item) {
                border-bottom: 1px solid var(--grid-outline);
            }

            :host(.dropdown) {
                --list-item-padding: 0.3em 0.6em;
                --list-item-bg: var(--dropdown-bg);
                --list-item-fg: var(--dropdown-fg);
                --list-item-hover-bg: var(--dropdown-hover-bg);
                --list-item-hover-fg: var(--dropdown-hover-fg);
                --list-item-active-bg: var(--dropdown-active-bg);
                --list-item-active-fg: var(--dropdown-active-fg);
                max-height: 50vh;
                overflow-y: auto;
            }
        `
    ];
  }
  constructor() {
    super();
    this.role = "menu";
  }
  items() {
    return this.querySelectorAll(`kc-ui-menu-item`);
  }
  item_by_name(name) {
    for (const item of this.items()) {
      if (item.name == name) {
        return item;
      }
    }
    return null;
  }
  deselect() {
    for (const item of this.items()) {
      item.selected = false;
    }
  }
  get selected() {
    for (const item of this.items()) {
      if (item.selected) {
        return item;
      }
    }
    return null;
  }
  set selected(element_or_name) {
    let new_selected;
    if (is_string(element_or_name)) {
      new_selected = this.item_by_name(element_or_name);
    } else {
      new_selected = element_or_name;
    }
    this.deselect();
    if (!new_selected || !(new_selected instanceof KCUIMenuItemElement)) {
      return;
    }
    new_selected.selected = true;
    this.send_selected_event(new_selected);
  }
  send_selected_event(new_selected) {
    this.dispatchEvent(
      new CustomEvent("kc-ui-menu:select", {
        detail: new_selected,
        bubbles: true,
        composed: true
      })
    );
  }
  initialContentCallback() {
    super.initialContentCallback();
    delegate(this, `kc-ui-menu-item`, "click", (e, source) => {
      if (e.target.tagName == "KC-UI-BUTTON") {
        return;
      }
      e.stopPropagation();
      this.selected = source;
    });
  }
  render() {
    return html`<slot></slot>`;
  }
};
__decorateClass([
  no_self_recursion
], KCUIMenuElement.prototype, "send_selected_event", 1);
window.customElements.define("kc-ui-menu", KCUIMenuElement);
var KCUIMenuItemElement = class extends KCUIElement {
  static {
    __name(this, "KCUIMenuItemElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: flex;
                align-items: center;
                flex-wrap: nowrap;
                padding: var(--list-item-padding, 0.2em 0.3em);
                user-select: none;
                background: transparent;
                transition:
                    color var(--transition-time-short) ease,
                    background-color var(--transition-time-short) ease;
                cursor: pointer;
            }

            :host(:hover) {
                background: var(--list-item-hover-bg);
                color: var(--list-item-hover-fg);
            }

            :host([selected]) {
                background: var(--list-item-active-bg);
                color: var(--list-item-active-fg);
            }

            :host([disabled]) {
                background: var(--list-item-disabled-bg);
                color: var(--list-item-disabled-fg);
            }

            ::slotted(*) {
                flex: 1 1 100%;
                display: block;
                overflow-wrap: anywhere;
            }

            ::slotted(.narrow) {
                max-width: 100px;
            }

            ::slotted(.very-narrow) {
                max-width: 50px;
            }

            kc-ui-icon {
                margin-right: 0.5em;
                margin-left: -0.1em;
            }
        `
    ];
  }
  constructor() {
    super();
    this.role = "menuitem";
  }
  render() {
    const icon = this.icon ? html`<kc-ui-icon>${this.icon}</kc-ui-icon>` : void 0;
    return html`${icon}<slot></slot>`;
  }
};
__decorateClass([
  attribute({ type: String })
], KCUIMenuItemElement.prototype, "name", 2);
__decorateClass([
  attribute({ type: String })
], KCUIMenuItemElement.prototype, "icon", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIMenuItemElement.prototype, "selected", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIMenuItemElement.prototype, "disabled", 2);
window.customElements.define("kc-ui-menu-item", KCUIMenuItemElement);
var KCUIMenuLabelElement = class extends KCUIElement {
  static {
    __name(this, "KCUIMenuLabelElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                width: 100%;
                display: flex;
                flex-wrap: nowrap;
                padding: 0.2em 0.3em;
                background: var(--panel-subtitle-bg);
                color: var(--panel-subtitle-fg);
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-menu-label", KCUIMenuLabelElement);

// kc-ui/dropdown.ts
var KCUIDropdownElement = class extends KCUIElement {
  static {
    __name(this, "KCUIDropdownElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                border-radius: 5px;
                border: 1px solid transparent;
                display: none;
                flex-direction: column;
                overflow: hidden;
                user-select: none;
                background: var(--dropdown-bg);
                color: var(--dropdown-fg);
                font-weight: 300;
            }

            :host([visible]) {
                display: flex;
            }
        `
    ];
  }
  constructor() {
    super();
    this.mouseout_padding ??= 50;
  }
  show() {
    if (this.visible) {
      return;
    }
    this.visible = true;
    this.dispatchEvent(
      new CustomEvent("kc-ui-dropdown:show", {
        bubbles: true,
        composed: true
      })
    );
  }
  hide() {
    if (!this.visible) {
      return;
    }
    this.visible = false;
    this.dispatchEvent(
      new CustomEvent("kc-ui-dropdown:hide", {
        bubbles: true,
        composed: true
      })
    );
  }
  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }
  get menu() {
    return this.querySelector("kc-ui-menu");
  }
  initialContentCallback() {
    super.initialContentCallback();
    if (this.hasAttribute("auto-hide")) {
      this.setup_leave_event();
    }
    this.menu.classList.add("invert-scrollbar");
  }
  setup_leave_event() {
    this.addEventListener("mouseleave", (e) => {
      if (!this.visible) {
        return;
      }
      const padding = this.mouseout_padding;
      const rect = this.getBoundingClientRect();
      const move_listener = listen(window, "mousemove", (e2) => {
        if (!this.visible) {
          move_listener.dispose();
        }
        const in_box = e2.clientX > rect.left - padding && e2.clientX < rect.right + padding && e2.clientY > rect.top - padding && e2.clientY < rect.bottom + padding;
        if (!in_box) {
          this.hide();
          move_listener.dispose();
        }
      });
    });
  }
  render() {
    return html`<slot></slot>`;
  }
};
__decorateClass([
  attribute({ type: Boolean })
], KCUIDropdownElement.prototype, "visible", 2);
__decorateClass([
  attribute({ type: Number })
], KCUIDropdownElement.prototype, "mouseout_padding", 2);
window.customElements.define("kc-ui-dropdown", KCUIDropdownElement);

// kc-ui/filtered-list.ts
var KCUIFilteredListElement = class extends KCUIElement {
  static {
    __name(this, "KCUIFilteredListElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: contents;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
  #filter_text;
  set filter_text(v) {
    this.#filter_text = v?.toLowerCase() ?? null;
    this.apply_filter();
  }
  get filter_text() {
    return this.#filter_text;
  }
  get item_selector() {
    return this.getAttribute("item-selector") ?? "[data-match-text]";
  }
  *items() {
    for (const parent of this.queryAssignedElements()) {
      yield* parent.querySelectorAll(this.item_selector);
    }
  }
  apply_filter() {
    later(() => {
      for (const el of this.items()) {
        if (this.#filter_text == null || el.dataset["matchText"]?.toLowerCase().includes(this.#filter_text)) {
          el.style.removeProperty("display");
        } else {
          el.style.display = "none";
        }
      }
    });
  }
};
window.customElements.define("kc-ui-filtered-list", KCUIFilteredListElement);

// kc-ui/floating-toolbar.ts
var KCUIFloatingToolbarElement = class extends KCUIElement {
  static {
    __name(this, "KCUIFloatingToolbarElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                z-index: 10;
                user-select: none;
                pointer-events: none;
                position: absolute;
                left: 0;
                width: 100%;
                padding: 0.5em;
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: flex-start;
            }

            :host([location="top"]) {
                top: 0;
            }

            :host([location="bottom"]) {
                bottom: 0;
            }

            ::slotted(*) {
                user-select: initial;
                pointer-events: initial;
            }

            slot[name="left"] {
                flex-grow: 999;
                display: flex;
            }

            slot[name="right"] {
                display: flex;
            }

            ::slotted(kc-ui-button) {
                margin-left: 0.25em;
            }
        `
    ];
  }
  render() {
    return html`<slot name="left"></slot><slot name="right"></slot>`;
  }
};
window.customElements.define(
  "kc-ui-floating-toolbar",
  KCUIFloatingToolbarElement
);

// kc-ui/focus-overlay.ts
var KCUIFocusOverlay = class extends KCUIElement {
  static {
    __name(this, "KCUIFocusOverlay");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                z-index: 10;
                user-select: none;
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: initial;
                background: transparent;
                contain: paint;
            }

            :host(.has-focus) {
                z-index: -10;
                pointer-events: none;
            }

            .bg {
                background: var(--focus-overlay-bg);
                opacity: 0;
                transition: opacity var(--transition-time-short);
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }

            :host(:hover) .bg {
                opacity: var(--focus-overlay-opacity);
            }

            :host(.has-focus) .bg {
                opacity: 0;
            }

            .fg {
                position: absolute;
                font-size: 1.5rem;
                color: var(--focus-overlay-fg);
                text-shadow: rgba(0, 0, 0, 0.5) 0px 0px 15px;
                opacity: 0;
                pointer-events: none;
            }

            :host(:hover) .fg {
                opacity: 1;
            }

            :host(.has-focus) .fg {
                opacity: 0;
            }
        `
    ];
  }
  #intersection_observer;
  initialContentCallback() {
    this.addEventListener("click", () => {
      this.classList.add("has-focus");
    });
    this.addDisposable(
      listen(document, "click", (e) => {
        const outside = !e.composedPath().includes(this.parentElement);
        if (outside) {
          this.classList.remove("has-focus");
        }
      })
    );
    this.#intersection_observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          this.classList.remove("has-focus");
        }
      }
    });
    this.#intersection_observer.observe(this);
    this.addDisposable({
      dispose: /* @__PURE__ */ __name(() => {
        this.#intersection_observer.disconnect();
      }, "dispose")
    });
  }
  render() {
    return html`
            <div class="bg"></div>
            <div class="fg">Click or tap to interact</div>
        `;
  }
};
window.customElements.define("kc-ui-focus-overlay", KCUIFocusOverlay);

// kc-ui/panel.ts
var KCUIPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCUIPanelElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                width: 100%;
                height: 100%;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                background: var(--panel-bg);
                color: var(--panel-fg);
                --bg: var(--panel-bg);
            }

            :host(:last-child) {
                flex-grow: 1;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-panel", KCUIPanelElement);
var KCUIPanelTitleElement = class extends KCUIElement {
  static {
    __name(this, "KCUIPanelTitleElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                flex: 0;
                width: 100%;
                text-align: left;
                padding: 0.2em 0.8em 0.2em 0.4em;
                display: flex;
                align-items: center;
                background: var(--panel-title-bg);
                color: var(--panel-title-fg);
                border-top: var(--panel-title-border);
                user-select: none;
            }

            div.title {
                flex: 1;
            }

            div.actions {
                flex: 0 1;
                display: flex;
                flex-direction: row;
                /* cheeky hack to work around scrollbar causing placement to be off. */
                padding-right: 6px;
            }
        `
    ];
  }
  render() {
    return html`<div class="title">${this.title}</div>
            <div class="actions">
                <slot name="actions"></slot>
            </div>`;
  }
};
window.customElements.define("kc-ui-panel-title", KCUIPanelTitleElement);
var KCUIPanelBodyElement = class extends KCUIElement {
  static {
    __name(this, "KCUIPanelBodyElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                width: 100%;
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
                flex: 1 0;
                font-weight: 300;
                font-size: 1em;
            }

            :host([padded]) {
                padding: 0.1em 0.8em 0.1em 0.4em;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-panel-body", KCUIPanelBodyElement);
var KCUIPanelLabelElement = class extends KCUIElement {
  static {
    __name(this, "KCUIPanelLabelElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                width: 100%;
                display: flex;
                flex-wrap: nowrap;
                padding: 0.2em 0.3em;
                background: var(--panel-subtitle-bg);
                color: var(--panel-subtitle-fg);
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-panel-label", KCUIPanelLabelElement);

// kc-ui/property-list.ts
var KCUIPropertyList = class extends KCUIElement {
  static {
    __name(this, "KCUIPropertyList");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: grid;
                gap: 1px;
                grid-template-columns: fit-content(50%) 1fr;
                background: var(--grid-outline);
                border-bottom: 1px solid var(--grid-outline);
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-property-list", KCUIPropertyList);
var KCUIPropertyListItemElement = class extends KCUIElement {
  static {
    __name(this, "KCUIPropertyListItemElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: contents;
            }

            span {
                padding: 0.2em;
                background: var(--bg);
                overflow-wrap: anywhere;
                user-select: all;
            }

            :host(.label) span:first-child {
                user-select: none;
                grid-column-end: span 2;
                background: var(--panel-subtitle-bg);
                color: var(--panel-subtitle-fg);
            }

            :host(.label) span:last-child {
                display: none;
            }

            ::slotted(*) {
                vertical-align: middle;
            }
        `
    ];
  }
  render() {
    return html`<span title="${this.name}">${this.name}</span
            ><span><slot></slot></span>`;
  }
};
__decorateClass([
  attribute({ type: String })
], KCUIPropertyListItemElement.prototype, "name", 2);
window.customElements.define(
  "kc-ui-property-list-item",
  KCUIPropertyListItemElement
);

// kc-ui/range.ts
var KCUIRangeElement = class extends KCUIElement {
  static {
    __name(this, "KCUIRangeElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: block;
                width: 100%;
                user-select: none;
            }

            input[type="range"] {
                all: unset;
                box-sizing: border-box;
                display: block;
                width: 100%;
                max-width: 100%;
                padding-top: 0.25em;
                padding-bottom: 0.25em;
                -webkit-appearance: none;
                appearance: none;
                font: inherit;
                cursor: grab;
                background: transparent;
                transition:
                    color var(--transition-time-medium) ease,
                    box-shadow var(--transition-time-medium) ease,
                    outline var(--transition-time-medium) ease,
                    background var(--transition-time-medium) ease,
                    border var(--transition-time-medium) ease;
            }

            input[type="range"]:hover {
                z-index: 10;
                box-shadow: var(--input-range-hover-shadow);
            }

            input[type="range"]:focus {
                box-shadow: none;
                outline: none;
            }

            input[type="range"]:disabled:hover {
                cursor: unset;
            }

            input[type="range"]::-webkit-slider-runnable-track {
                box-sizing: border-box;
                height: 0.5em;
                border: 1px solid transparent;
                border-radius: 0.5em;
                background: var(--input-range-bg);
            }
            input[type="range"]::-moz-range-track {
                box-sizing: border-box;
                height: 0.5em;
                border: 1px solid transparent;
                border-radius: 0.5em;
                background: var(--input-range-bg);
            }

            input[type="range"]:hover::-webkit-slider-runnable-track,
            input[type="range"]:focus::-webkit-slider-runnable-track {
                border: 1px solid var(--input-range-hover-bg);
            }
            input[type="range"]:hover::-moz-range-track,
            input[type="range"]:focus::-moz-range-track {
                border: 1px solid var(--input-range-hover-bg);
            }

            input[type="range"]:disabled::-webkit-slider-runnable-track {
                background: var(--input-range-disabled-bg);
            }
            input[type="range"]:disabled::-moz-range-track {
                background: var(--input-range-disabled-bg);
            }

            input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                height: 1em;
                width: 1em;
                border-radius: 0.5em;
                margin-top: -0.3em;
                background: var(--input-range-fg);
            }
            input[type="range"]::-moz-range-thumb {
                border: none;
                height: 1em;
                width: 1em;
                border-radius: 100%;
                margin-top: -0.3em;
                background: var(--input-range-fg);
            }

            input[type="range"]:focus::-webkit-slider-thumb {
                box-shadow: var(--input-range-handle-shadow);
            }
            input[type="range"]:focus::-moz-range-thumb {
                box-shadow: var(--input-range-handle-shadow);
            }
        `
    ];
  }
  static get observedAttributes() {
    return ["disabled", "min", "max", "step", "value"];
  }
  get value() {
    return this.input.value;
  }
  set value(val) {
    this.input.value = val;
  }
  get valueAsNumber() {
    return this.input.valueAsNumber;
  }
  attributeChangedCallback(name, old, value) {
    if (!this.input) {
      return;
    }
    switch (name) {
      case "disabled":
        this.input.disabled = value == null ? false : true;
        break;
      case "min":
        this.input.min = value ?? "";
        break;
      case "max":
        this.input.max = value ?? "";
        break;
      case "step":
        this.input.step = value ?? "";
        break;
      case "value":
        this.value = value ?? "";
        break;
    }
  }
  initialContentCallback() {
    this.input.disabled = this.disabled;
    this.input.addEventListener("input", (e) => {
      e.stopPropagation();
      this.dispatchEvent(
        new CustomEvent("kc-ui-range:input", {
          composed: true,
          bubbles: true
        })
      );
    });
  }
  render() {
    return html`<input
            type="range"
            min="${this.min}"
            max="${this.max}"
            step="${this.step}"
            value="${this.getAttribute("value")}">
        </input>`;
  }
};
__decorateClass([
  attribute({ type: String })
], KCUIRangeElement.prototype, "name", 2);
__decorateClass([
  attribute({ type: String })
], KCUIRangeElement.prototype, "min", 2);
__decorateClass([
  attribute({ type: String })
], KCUIRangeElement.prototype, "max", 2);
__decorateClass([
  attribute({ type: String })
], KCUIRangeElement.prototype, "step", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIRangeElement.prototype, "disabled", 2);
__decorateClass([
  query("input", true)
], KCUIRangeElement.prototype, "input", 2);
window.customElements.define("kc-ui-range", KCUIRangeElement);

// kc-ui/resizer.ts
var KCUIResizerElement = class extends KCUIElement {
  static {
    __name(this, "KCUIResizerElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                z-index: 999;
                user-select: none;
                display: block;
                width: 6px;
                margin-left: -6px;
                cursor: col-resize;
                background: transparent;
                opacity: 0;
                transition: opacity var(--transition-time-medium, 500) ease;
            }

            :host(:hover) {
                background: var(--resizer-bg, rebeccapurple);
                opacity: 1;
                transition: opacity var(--transition-time-short) ease;
            }

            :host(:hover.active),
            :host(.active) {
                background: var(--resizer-active-bg, rebeccapurple);
            }
        `
    ];
  }
  initialContentCallback() {
    const prev = this.previousElementSibling;
    const next = this.nextElementSibling;
    this.addEventListener("mousedown", (e) => {
      const mouse_x = e.clientX;
      const width = next.getBoundingClientRect().width;
      document.body.style.cursor = "col-resize";
      prev.style.pointerEvents = "none";
      prev.style.userSelect = "none";
      next.style.pointerEvents = "none";
      next.style.userSelect = "none";
      next.style.width = `${width}px`;
      next.style.maxWidth = "unset";
      this.classList.add("active");
      if (next.hasAttribute("collapsed")) {
        console.log("removing collapsed");
        next.removeAttribute("collapsed");
      }
      const mouse_move = /* @__PURE__ */ __name((e2) => {
        const dx = mouse_x - e2.clientX;
        const new_width = (width + dx) * 100 / this.parentElement.getBoundingClientRect().width;
        next.style.width = `${new_width}%`;
      }, "mouse_move");
      const mouse_move_listener = this.addDisposable(
        listen(window, "mousemove", mouse_move)
      );
      const mouse_up = /* @__PURE__ */ __name((e2) => {
        document.body.style.cursor = "";
        prev.style.pointerEvents = "";
        prev.style.userSelect = "";
        next.style.pointerEvents = "";
        next.style.userSelect = "";
        this.classList.remove("active");
        mouse_move_listener.dispose();
      }, "mouse_up");
      window.addEventListener("mouseup", mouse_up, { once: true });
    });
  }
};
window.customElements.define("kc-ui-resizer", KCUIResizerElement);

// kc-ui/split-view.ts
var common_styles2 = css`
    :host(.grow) {
        flex-basis: unset;
        flex-grow: 999;
    }

    :host(.shrink) {
        flex-grow: 0;
        flex-shrink: 1;
        width: unset;
    }

    :host:(.fixed) {
        flex-grow: 0;
        flex-shrink: 0;
    }
`;
var KCUIView = class extends KCUIElement {
  static {
    __name(this, "KCUIView");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      common_styles2,
      css`
            :host {
                flex-grow: 1;
                display: flex;
                overflow: hidden;
                flex-direction: column;
                position: relative;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-view", KCUIView);
var KCUISplitView = class extends KCUIElement {
  static {
    __name(this, "KCUISplitView");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      common_styles2,
      css`
            :host {
                display: flex;
                height: 100%;
                overflow: hidden;
            }

            :host([horizontal]) {
                flex-direction: column;
                max-height: 100%;
            }

            :host([vertical]) {
                flex-direction: row;
                max-width: 100%;
            }
        `
    ];
  }
  render() {
    return html`<slot></slot>`;
  }
};
window.customElements.define("kc-ui-split-view", KCUISplitView);

// kc-ui/text-filter-input.ts
var KCUITextFilterInputElement = class extends KCUIElement {
  static {
    __name(this, "KCUITextFilterInputElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: flex;
                align-items: center;
                align-content: center;
                position: relative;
                border-bottom: 1px solid var(--grid-outline);
            }

            kc-ui-icon.before {
                pointer-events: none;
                position: absolute;
                left: 0;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding-left: 0.25em;
            }

            input {
                all: unset;
                display: block;
                width: 100%;
                max-width: 100%;
                border-radius: 0;
                padding: 0.4em;
                padding-left: 1.5em;
                text-align: left;
                font: inherit;
                background: var(--input-bg);
                color: var(--input-fg);
            }

            input:placeholder-shown + button {
                display: none;
            }

            button {
                all: unset;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                color: var(--input-fg);
                padding: 0.25em;
            }

            button:hover {
                cursor: pointer;
                color: var(--input-accent);
            }
        `
    ];
  }
  get value() {
    return this.input.value;
  }
  set value(v) {
    this.input.value = v;
    this.input.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
  }
  initialContentCallback() {
    super.initialContentCallback();
    this.button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.value = "";
    });
  }
  render() {
    return html`<kc-ui-icon class="flex before">search</kc-ui-icon>
            <input style="" type="text" placeholder="search" name="search" />
            <button type="button">
                <kc-ui-icon>close</kc-ui-icon>
            </button>`;
  }
};
__decorateClass([
  query("input", true)
], KCUITextFilterInputElement.prototype, "input", 2);
__decorateClass([
  query("button", true)
], KCUITextFilterInputElement.prototype, "button", 2);
window.customElements.define(
  "kc-ui-text-filter-input",
  KCUITextFilterInputElement
);

// kc-ui/toggle-menu.ts
var KCUIToggleMenuElement = class extends KCUIElement {
  static {
    __name(this, "KCUIToggleMenuElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            * {
                box-sizing: border-box;
            }

            button {
                all: unset;
                box-sizing: border-box;
                user-select: none;
                width: 100%;
                max-width: 100%;
                margin: unset;
                font: inherit;
                padding: 0.3em 0.6em 0.3em 0.6em;
                display: flex;
                align-items: flex-end;
                justify-content: left;
                border: 1px solid transparent;
                border-radius: 0.25em;
                font-weight: 300;
                font-size: 1em;
                background: var(--dropdown-bg);
                color: var(--dropdown-fg);
                transition:
                    color var(--transition-time-medium, 500) ease,
                    background var(--transition-time-medium, 500) ease;
            }

            button:hover {
                background: var(--dropdown-hover-bg);
                color: var(--dropdown-hover-fg);
                box-shadow: none;
                outline: none;
            }

            button kc-ui-icon {
                font-size: 1em;
                margin-top: 0.1em;
                margin-bottom: 0.1em;
            }

            button span {
                display: none;
                margin-left: 0.5em;
            }

            :host([visible]) button {
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
            }

            :host([visible]) button span {
                display: revert;
            }

            ::slotted(kc-ui-dropdown) {
                border-top-left-radius: 0;
                border-top-right-radius: 0;
            }
        `
    ];
  }
  get dropdown() {
    return this.queryAssignedElements(
      "dropdown",
      "kc-ui-dropdown"
    )[0];
  }
  get button() {
    return this.renderRoot.querySelector("button");
  }
  initialContentCallback() {
    this.button.addEventListener("click", (e) => {
      this.dropdown.toggle();
    });
    this.addEventListener("kc-ui-dropdown:show", () => {
      this.visible = true;
    });
    this.addEventListener("kc-ui-dropdown:hide", () => {
      this.visible = false;
    });
  }
  render() {
    return html`<button name="toggle" type="button" title="${this.title}">
                <kc-ui-icon>${this.icon ?? "question-mark"}</kc-ui-icon>
                <span>${this.title}</span>
            </button>
            <slot name="dropdown"></slot>`;
  }
};
__decorateClass([
  attribute({ type: String })
], KCUIToggleMenuElement.prototype, "icon", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCUIToggleMenuElement.prototype, "visible", 2);
window.customElements.define("kc-ui-toggle-menu", KCUIToggleMenuElement);

// kicanvas/icons/sprites.svg
var sprites_default = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs/><symbol id="pcb_file" viewBox="0 0 48 48">\n    <path d="M11,44C10.2,44 9.5,43.7 8.9,43.1C8.3,42.5 8,41.8 8,41L8,7C8,6.2 8.3,5.5 8.9,4.9C9.5,4.3 10.2,4 11,4L29.05,4L40,14.95L40,41C40,41.8 39.7,42.5 39.1,43.1C38.5,43.7 37.8,44 37,44L11,44ZM27.55,16.3L27.55,7L11,7L11,41L37,41L37,16.3L27.55,16.3ZM11,7L11,16.3L11,7L11,41L11,7Z"/>\n    <path d="M20.231,37.681C20.231,37.681 20.231,36.001 20.231,36.001L18.007,36.001C17.437,36.001 16.936,35.792 16.509,35.365C16.081,34.937 15.872,34.437 15.872,33.867L15.872,31.643L13.693,31.643L13.693,29.008C13.693,29.008 15.872,29.008 15.872,29.008L15.872,26.63L13.693,26.63L13.693,23.995C13.693,23.995 15.872,23.995 15.872,23.995L15.872,21.771C15.872,21.201 16.081,20.701 16.509,20.273C16.936,19.846 17.437,19.636 18.007,19.636C18.007,19.636 20.231,19.636 20.231,19.636L20.231,17.566L22.865,17.566C22.865,17.566 22.865,19.636 22.865,19.636C22.865,19.636 25.244,19.636 25.244,19.636L25.244,17.566L27.878,17.566C27.878,17.566 27.878,19.636 27.878,19.636L30.102,19.636C30.672,19.636 31.173,19.846 31.6,20.273C32.028,20.701 32.237,21.201 32.237,21.771C32.237,21.771 32.237,23.995 32.237,23.995L34.307,23.995L34.307,26.63C34.307,26.63 32.237,26.63 32.237,26.63C32.237,26.63 32.237,29.008 32.237,29.008L34.307,29.008L34.307,31.643C34.307,31.643 32.237,31.643 32.237,31.643L32.237,33.867C32.237,34.437 32.028,34.937 31.6,35.365C31.173,35.792 30.672,36.001 30.102,36.001L27.878,36.001L27.878,38.181L25.244,38.181C25.244,38.181 25.244,36.001 25.244,36.001L22.865,36.001L22.865,38.181L20.231,38.181L20.231,37.681ZM29.602,33.367L29.602,22.271L18.507,22.271L18.507,33.367L29.602,33.367ZM20.694,24.595L27.279,24.595L27.279,31.179L20.694,31.179L20.694,24.595ZM23.329,28.545C23.329,28.545 24.644,28.545 24.644,28.545C24.644,28.545 24.644,27.229 24.644,27.229C24.644,27.229 23.329,27.229 23.329,27.229L23.329,28.545Z"/>\n</symbol><symbol id="schematic_file" viewBox="0 0 48 48">\n    <path d="M11,44C10.2,44 9.5,43.7 8.9,43.1C8.3,42.5 8,41.8 8,41L8,7C8,6.2 8.3,5.5 8.9,4.9C9.5,4.3 10.2,4 11,4L29.05,4L40,14.95L40,41C40,41.8 39.7,42.5 39.1,43.1C38.5,43.7 37.8,44 37,44L11,44ZM27.55,16.3L27.55,7L11,7L11,41L37,41L37,16.3L27.55,16.3ZM11,7L11,16.3L11,7L11,41L11,7Z"/>\n    <path d="M18.256,26.367L15.377,26.367L15.377,23.367L18.256,23.367L18.256,23.184C18.256,22.155 18.784,21.198 19.654,20.648C20.524,20.098 21.615,20.033 22.544,20.475L24.69,21.494L24.69,19.353L27.69,19.353L27.69,22.92L32.411,25.164C33.457,25.661 34.123,26.715 34.123,27.873C34.123,29.031 33.457,30.086 32.411,30.583L27.69,32.827L27.69,36.394L24.69,36.394L24.69,34.252L22.544,35.272C21.615,35.714 20.524,35.648 19.654,35.099C18.784,34.549 18.256,33.592 18.256,32.563L18.256,32.38L15.377,32.38L15.377,29.38L18.256,29.38L18.256,26.367ZM21.256,32.563L31.123,27.873L21.256,23.184L21.256,32.563Z"/>\n</symbol><symbol id="zoom_footprint" viewBox="0 0 48 48">\n    <g>\n        <path d="M33,38.5C34.567,38.5 35.875,37.975 36.925,36.925C37.975,35.875 38.5,34.567 38.5,33C38.5,31.433 37.975,30.125 36.925,29.075C35.875,28.025 34.567,27.5 33,27.5C31.433,27.5 30.125,28.025 29.075,29.075C28.025,30.125 27.5,31.433 27.5,33C27.5,34.567 28.025,35.875 29.075,36.925C30.125,37.975 31.433,38.5 33,38.5ZM43.2,45.3L37.842,39.95C37.147,40.417 36.392,40.792 35.575,41.075C34.758,41.358 33.9,41.5 33,41.5C30.639,41.5 28.632,40.673 26.979,39.019C25.326,37.365 24.5,35.357 24.5,32.994C24.5,30.631 25.327,28.625 26.981,26.975C28.635,25.325 30.643,24.5 33.006,24.5C35.369,24.5 37.375,25.326 39.025,26.979C40.675,28.632 41.5,30.639 41.5,33C41.5,33.9 41.358,34.758 41.075,35.575C40.792,36.392 40.417,37.147 39.95,37.842L45.3,43.2L43.2,45.3Z"/>\n        <path d="M22.597,38L21,38L21,42L18,42L18,38L13,38C12.2,38 11.5,37.7 10.9,37.1C10.3,36.5 10,35.8 10,35L10,30L6,30L6,27L10,27L10,20.8L6,20.8L6,17.8L10,17.8L10,12.8C10,12 10.3,11.3 10.9,10.7C11.5,10.1 12.2,9.8 13,9.8L18,9.8L18,6L21,6L21,9.8L27.2,9.8L27.2,6L30.2,6L30.2,9.8L35.2,9.8C36,9.8 36.7,10.1 37.3,10.7C37.9,11.3 38.2,12 38.2,12.8L38.2,17.8L42,17.8L42,20.8L38.2,20.8L38.2,22.691C37.262,22.214 36.262,21.88 35.2,21.69L35.2,12.8L13,12.8L13,35L21.657,35C21.83,36.06 22.143,37.06 22.597,38ZM22.119,29.15L18.85,29.15L18.85,18.9L29.1,18.9L29.1,22.139C28.029,22.515 27.029,23.058 26.1,23.767L26.1,21.9L21.85,21.9L21.85,26.15L23.727,26.15C23.025,27.079 22.489,28.079 22.119,29.15Z"/>\n    </g>\n</symbol><symbol id="zoom_page" viewBox="0 0 48 48">\n    <g>\n        <path d="M9,41L24.75,41C25.417,41.7 26.158,42.3 26.975,42.8C27.792,43.3 28.683,43.7 29.65,44L9,44C8.2,44 7.5,43.7 6.9,43.1C6.3,42.5 6,41.8 6,41L6.02,9.006C6.02,8.206 6.32,7.506 6.92,6.906C7.52,6.306 8.22,6.006 9.02,6.006L27.07,6.006L38,14.95L38,22.65C37.533,22.417 37.05,22.217 36.55,22.05C36.05,21.883 35.533,21.75 35,21.65L35,16.3L25.55,16.3L25.57,9.006L9.02,9.006L9,16.3L9,41Z"/>\n        <path d="M43.2,45.3L37.842,39.95C37.147,40.417 36.392,40.792 35.575,41.075C34.758,41.358 33.9,41.5 33,41.5C30.639,41.5 28.632,40.673 26.979,39.019C25.326,37.365 24.5,35.357 24.5,32.994C24.5,30.631 25.327,28.625 26.981,26.975C28.635,25.325 30.643,24.5 33.006,24.5C35.369,24.5 37.375,25.326 39.025,26.979C40.675,28.632 41.5,30.639 41.5,33C41.5,33.9 41.358,34.758 41.075,35.575C40.792,36.392 40.417,37.147 39.95,37.842L45.3,43.2L43.2,45.3ZM33,38.5C34.567,38.5 35.875,37.975 36.925,36.925C37.975,35.875 38.5,34.567 38.5,33C38.5,31.433 37.975,30.125 36.925,29.075C35.875,28.025 34.567,27.5 33,27.5C31.433,27.5 30.125,28.025 29.075,29.075C28.025,30.125 27.5,31.433 27.5,33C27.5,34.567 28.025,35.875 29.075,36.925C30.125,37.975 31.433,38.5 33,38.5Z"/>\n    </g>\n</symbol></svg>';

// kicanvas/icons/sprites.ts
var sprites_url = URL.createObjectURL(
  new Blob([sprites_default], { type: "image/svg+xml" })
);

// base/iterator.ts
function first(iterable) {
  return iterable[Symbol.iterator]().next().value;
}
__name(first, "first");
function* map(iterable, callback) {
  let n = 0;
  for (const i of iterable) {
    yield callback(i, n);
    n++;
  }
}
__name(map, "map");
function length(iterable) {
  let n = 0;
  for (const _ of iterable) {
    n++;
  }
  return n;
}
__name(length, "length");

// base/log.ts
var Logger = class {
  constructor(name, level = 1 /* INFO */) {
    this.name = name;
    this.level = level;
  }
  static {
    __name(this, "Logger");
  }
  #log(method, ...args) {
    method(
      `%c${this.name}:%c`,
      `color: ButtonText`,
      `color: inherit`,
      ...args
    );
  }
  debug(...args) {
    if (this.level >= 2 /* DEBUG */) {
      this.#log(console.debug, ...args);
    }
  }
  info(...args) {
    if (this.level >= 1 /* INFO */) {
      this.#log(console.info.bind(window.console), ...args);
    }
  }
  warn(...args) {
    if (this.level >= 0 /* ERROR */) {
      this.#log(console.warn, ...args);
    }
  }
  error(...args) {
    if (this.level >= 0 /* ERROR */) {
      this.#log(console.error, ...args);
    }
  }
};
var default_logger = new Logger("kicanvas");
function warn(...args) {
  default_logger.warn(...args);
}
__name(warn, "warn");

// base/math/matrix3.ts
var Matrix3 = class _Matrix3 {
  static {
    __name(this, "Matrix3");
  }
  /**
   * Create a new Matrix
   * @param elements the 9 matrix elements
   */
  constructor(elements) {
    if (elements.length != 9) {
      throw new Error(`Matrix3 requires 9 elements, got ${elements}`);
    }
    this.elements = new Float32Array(elements);
  }
  /**
   * Create a Matrix3 from a DOMMatrix
   */
  static from_DOMMatrix(m) {
    return new _Matrix3([
      m.m11,
      m.m12,
      m.m14,
      m.m21,
      m.m22,
      m.m24,
      m.m41,
      m.m42,
      m.m44
    ]);
  }
  /**
   * Create a DOMMatrix from this Matrix3
   */
  to_DOMMatrix() {
    const e = this.elements;
    return new DOMMatrix([
      e[0],
      e[3],
      e[1],
      e[4],
      e[6],
      e[7]
    ]);
  }
  /**
   * Create a 4x4 DOMMatrix from this Matrix3
   */
  to_4x4_DOMMatrix() {
    const e = this.elements;
    return new DOMMatrix([
      e[0],
      e[1],
      0,
      e[2],
      e[3],
      e[4],
      0,
      e[5],
      0,
      0,
      1,
      0,
      e[6],
      e[7],
      0,
      1
    ]);
  }
  /**
   * @returns a new identity matrix
   */
  static identity() {
    return new _Matrix3([
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1
    ]);
  }
  /**
   * @returns a new matrix representing a 2D orthographic projection
   */
  static orthographic(width, height) {
    return new _Matrix3([
      2 / width,
      0,
      0,
      0,
      -2 / height,
      0,
      -1,
      1,
      1
    ]);
  }
  /**
   * @returns a copy of this matrix
   */
  copy() {
    return new _Matrix3(this.elements);
  }
  /**
   * Update this matrix's elements
   */
  set(elements) {
    if (elements.length != 9) {
      throw new Error(`Matrix3 requires 9 elements, got ${elements}`);
    }
    this.elements.set(elements);
  }
  /**
   * Transform a vector by multiplying it with this matrix.
   * @returns A new Vec2
   */
  transform(vec) {
    const x1 = this.elements[0 * 3 + 0];
    const x2 = this.elements[0 * 3 + 1];
    const y1 = this.elements[1 * 3 + 0];
    const y2 = this.elements[1 * 3 + 1];
    const z1 = this.elements[2 * 3 + 0];
    const z2 = this.elements[2 * 3 + 1];
    const px = vec.x;
    const py = vec.y;
    const x = px * x1 + py * y1 + z1;
    const y = px * x2 + py * y2 + z2;
    return new Vec2(x, y);
  }
  /**
   * Transforms a list of vectors
   * @yields new transformed vectors
   */
  *transform_all(vecs) {
    for (const vec of vecs) {
      yield this.transform(vec);
    }
  }
  /**
   * Transforms a list of vectors by a given matrix, which may be null.
   */
  static transform_all(mat, vecs) {
    if (!mat) {
      return vecs;
    }
    return Array.from(mat.transform_all(vecs));
  }
  /**
   * Multiply this matrix by another and store the result
   * in this matrix.
   * @returns this matrix
   */
  multiply_self(b) {
    const a00 = this.elements[0 * 3 + 0];
    const a01 = this.elements[0 * 3 + 1];
    const a02 = this.elements[0 * 3 + 2];
    const a10 = this.elements[1 * 3 + 0];
    const a11 = this.elements[1 * 3 + 1];
    const a12 = this.elements[1 * 3 + 2];
    const a20 = this.elements[2 * 3 + 0];
    const a21 = this.elements[2 * 3 + 1];
    const a22 = this.elements[2 * 3 + 2];
    const b00 = b.elements[0 * 3 + 0];
    const b01 = b.elements[0 * 3 + 1];
    const b02 = b.elements[0 * 3 + 2];
    const b10 = b.elements[1 * 3 + 0];
    const b11 = b.elements[1 * 3 + 1];
    const b12 = b.elements[1 * 3 + 2];
    const b20 = b.elements[2 * 3 + 0];
    const b21 = b.elements[2 * 3 + 1];
    const b22 = b.elements[2 * 3 + 2];
    this.elements[0] = b00 * a00 + b01 * a10 + b02 * a20;
    this.elements[1] = b00 * a01 + b01 * a11 + b02 * a21;
    this.elements[2] = b00 * a02 + b01 * a12 + b02 * a22;
    this.elements[3] = b10 * a00 + b11 * a10 + b12 * a20;
    this.elements[4] = b10 * a01 + b11 * a11 + b12 * a21;
    this.elements[5] = b10 * a02 + b11 * a12 + b12 * a22;
    this.elements[6] = b20 * a00 + b21 * a10 + b22 * a20;
    this.elements[7] = b20 * a01 + b21 * a11 + b22 * a21;
    this.elements[8] = b20 * a02 + b21 * a12 + b22 * a22;
    return this;
  }
  /**
   * Create a new matrix by multiplying this matrix with another
   * @returns a new matrix
   */
  multiply(b) {
    return this.copy().multiply_self(b);
  }
  /**
   * @returns A new matrix that is the inverse of this matrix
   */
  inverse() {
    const a00 = this.elements[0 * 3 + 0];
    const a01 = this.elements[0 * 3 + 1];
    const a02 = this.elements[0 * 3 + 2];
    const a10 = this.elements[1 * 3 + 0];
    const a11 = this.elements[1 * 3 + 1];
    const a12 = this.elements[1 * 3 + 2];
    const a20 = this.elements[2 * 3 + 0];
    const a21 = this.elements[2 * 3 + 1];
    const a22 = this.elements[2 * 3 + 2];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    const det = a00 * b01 + a01 * b11 + a02 * b21;
    const inv_det = 1 / det;
    return new _Matrix3([
      b01 * inv_det,
      (-a22 * a01 + a02 * a21) * inv_det,
      (a12 * a01 - a02 * a11) * inv_det,
      b11 * inv_det,
      (a22 * a00 - a02 * a20) * inv_det,
      (-a12 * a00 + a02 * a10) * inv_det,
      b21 * inv_det,
      (-a21 * a00 + a01 * a20) * inv_det,
      (a11 * a00 - a01 * a10) * inv_det
    ]);
  }
  /**
   * @returns A new matrix representing a 2D translation
   */
  static translation(x, y) {
    return new _Matrix3([
      1,
      0,
      0,
      0,
      1,
      0,
      x,
      y,
      1
    ]);
  }
  /**
   * Translate this matrix by the given amounts
   * @returns this matrix
   */
  translate_self(x, y) {
    return this.multiply_self(_Matrix3.translation(x, y));
  }
  /**
   * Creates a new matrix representing this matrix translated by the given amount
   * @returns a new matrix
   */
  translate(x, y) {
    return this.copy().translate_self(x, y);
  }
  /**
   * @returns {Matrix3} A new matrix representing a 2D scale
   */
  static scaling(x, y) {
    return new _Matrix3([
      x,
      0,
      0,
      0,
      y,
      0,
      0,
      0,
      1
    ]);
  }
  /**
   * Scale this matrix by the given amounts
   * @returns this matrix
   */
  scale_self(x, y) {
    return this.multiply_self(_Matrix3.scaling(x, y));
  }
  /**
   * Creates a new matrix representing this matrix scaled by the given amount
   * @returns a new matrix
   */
  scale(x, y) {
    return this.copy().scale_self(x, y);
  }
  /**
   * @returns A new matrix representing a 2D rotation
   */
  static rotation(angle) {
    const theta = new Angle(angle).radians;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return new _Matrix3([
      cos,
      -sin,
      0,
      sin,
      cos,
      0,
      0,
      0,
      1
    ]);
  }
  /**
   * Rotate this matrix by the given angle
   * @returns this matrix
   */
  rotate_self(angle) {
    return this.multiply_self(_Matrix3.rotation(angle));
  }
  /**
   * Creates a new matrix representing this matrix rotated by the given angle
   * @returns a new matrix
   */
  rotate(angle) {
    return this.copy().rotate_self(angle);
  }
  /**
   * Returns the total translation (relative to identity) applied via this matrix.
   */
  get absolute_translation() {
    return this.transform(new Vec2(0, 0));
  }
  /**
   * Retruns the total rotation (relative to identity) applied via this matrix.
   */
  get absolute_rotation() {
    const p0 = this.transform(new Vec2(0, 0));
    const p1 = this.transform(new Vec2(1, 0));
    const pn = p1.sub(p0);
    return pn.angle.normalize();
  }
};

// base/math/vec2.ts
var Vec2 = class _Vec2 {
  static {
    __name(this, "Vec2");
  }
  /**
   * Create a Vec2
   */
  constructor(x = 0, y) {
    this.set(x, y);
  }
  /**
   * Copy this vector
   */
  copy() {
    return new _Vec2(...this);
  }
  /**
   * Update this vector's values
   */
  set(x, y) {
    let x_prime = null;
    if (is_number(x) && is_number(y)) {
      x_prime = x;
    } else if (x instanceof _Vec2) {
      x_prime = x.x;
      y = x.y;
    } else if (x instanceof Array) {
      x_prime = x[0];
      y = x[1];
    } else if (x instanceof Object && Object.hasOwn(x, "x")) {
      x_prime = x.x;
      y = x.y;
    } else if (x == 0 && y == void 0) {
      x_prime = 0;
      y = 0;
    }
    if (x_prime == null || y == void 0) {
      throw new Error(`Invalid parameters x: ${x}, y: ${y}.`);
    }
    this.x = x_prime;
    this.y = y;
  }
  /** Iterate through [x, y] */
  *[Symbol.iterator]() {
    yield this.x;
    yield this.y;
  }
  get magnitude() {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
  get squared_magnitude() {
    return this.x ** 2 + this.y ** 2;
  }
  /**
   * @returns the perpendicular normal of this vector
   */
  get normal() {
    return new _Vec2(-this.y, this.x);
  }
  /**
   * @returns the direction (angle) of this vector
   */
  get angle() {
    return new Angle(Math.atan2(this.y, this.x));
  }
  /**
   * KiCad has to be weird about this, ofc.
   */
  get kicad_angle() {
    if (this.x == 0 && this.y == 0) {
      return new Angle(0);
    } else if (this.y == 0) {
      if (this.x >= 0) {
        return new Angle(0);
      } else {
        return Angle.from_degrees(-180);
      }
    } else if (this.x == 0) {
      if (this.y >= 0) {
        return Angle.from_degrees(90);
      } else {
        return Angle.from_degrees(-90);
      }
    } else if (this.x == this.y) {
      if (this.x >= 0) {
        return Angle.from_degrees(45);
      } else {
        return Angle.from_degrees(-135);
      }
    } else if (this.x == -this.y) {
      if (this.x >= 0) {
        return Angle.from_degrees(-45);
      } else {
        return Angle.from_degrees(135);
      }
    } else {
      return this.angle;
    }
  }
  /**
   * @returns A new unit vector in the same direction as this vector
   */
  normalize() {
    if (this.x == 0 && this.y == 0) {
      return new _Vec2(0, 0);
    }
    const l = this.magnitude;
    const x = this.x /= l;
    const y = this.y /= l;
    return new _Vec2(x, y);
  }
  equals(b) {
    return this.x == b?.x && this.y == b?.y;
  }
  add(b) {
    return new _Vec2(this.x + b.x, this.y + b.y);
  }
  sub(b) {
    return new _Vec2(this.x - b.x, this.y - b.y);
  }
  scale(b) {
    return new _Vec2(this.x * b.x, this.y * b.y);
  }
  rotate(angle) {
    const m = Matrix3.rotation(angle);
    return m.transform(this);
  }
  multiply(s) {
    if (is_number(s)) {
      return new _Vec2(this.x * s, this.y * s);
    } else {
      return new _Vec2(this.x * s.x, this.y * s.y);
    }
  }
  resize(len) {
    return this.normalize().multiply(len);
  }
  cross(b) {
    return this.x * b.y - this.y * b.x;
  }
  static segment_intersect(a1, b1, a2, b2) {
    const ray_1 = b1.sub(a1);
    const ray_2 = b2.sub(a2);
    const delta = a2.sub(a1);
    const d = ray_2.cross(ray_1);
    const t1 = ray_2.cross(delta);
    const t2 = ray_1.cross(delta);
    if (d == 0) {
      return null;
    }
    if (d > 0 && (t2 < 0 || t2 > d || t1 < 0 || t1 > d)) {
      return null;
    }
    if (d < 0 && (t2 < d || t1 < d || t1 > 0 || t2 > 0)) {
      return null;
    }
    return new _Vec2(a2.x + t2 / d * ray_2.x, a2.y + t2 / d * ray_2.y);
  }
};

// base/math/angle.ts
var Angle = class _Angle {
  static {
    __name(this, "Angle");
  }
  #theta_rad;
  #theta_deg;
  /**
   * Convert radians to degrees
   */
  static rad_to_deg(radians) {
    return radians / Math.PI * 180;
  }
  /**
   * Convert degrees to radians
   */
  static deg_to_rad(degrees) {
    return degrees / 180 * Math.PI;
  }
  /** Round degrees to two decimal places
   *
   * A lot of math involving angles is done with degrees to two decimal places
   * instead of radians to match KiCad's behavior and to avoid floating point
   * nonsense.
   */
  static round(degrees) {
    return Math.round((degrees + Number.EPSILON) * 100) / 100;
  }
  /**
   * Create an Angle
   */
  constructor(radians) {
    if (radians instanceof _Angle) {
      return radians;
    }
    this.radians = radians;
  }
  copy() {
    return new _Angle(this.radians);
  }
  get radians() {
    return this.#theta_rad;
  }
  set radians(v) {
    this.#theta_rad = v;
    this.#theta_deg = _Angle.round(_Angle.rad_to_deg(v));
  }
  get degrees() {
    return this.#theta_deg;
  }
  set degrees(v) {
    this.#theta_deg = v;
    this.#theta_rad = _Angle.deg_to_rad(v);
  }
  static from_degrees(v) {
    return new _Angle(_Angle.deg_to_rad(v));
  }
  /**
   * Returns a new Angle representing the sum of this angle and the given angle.
   */
  add(other) {
    const sum = this.radians + new _Angle(other).radians;
    return new _Angle(sum);
  }
  /**
   * Returns a new Angle representing the difference between this angle and the given angle.
   */
  sub(other) {
    const diff = this.radians - new _Angle(other).radians;
    return new _Angle(diff);
  }
  /**
   * @returns a new Angle constrained to 0 to 360 degrees.
   */
  normalize() {
    let deg = _Angle.round(this.degrees);
    while (deg < 0) {
      deg += 360;
    }
    while (deg >= 360) {
      deg -= 360;
    }
    return _Angle.from_degrees(deg);
  }
  /**
   * @returns a new Angle constrained to -180 to 180 degrees.
   */
  normalize180() {
    let deg = _Angle.round(this.degrees);
    while (deg <= -180) {
      deg += 360;
    }
    while (deg > 180) {
      deg -= 360;
    }
    return _Angle.from_degrees(deg);
  }
  /**
   * @returns a new Angle constrained to -360 to +360 degrees.
   */
  normalize720() {
    let deg = _Angle.round(this.degrees);
    while (deg < -360) {
      deg += 360;
    }
    while (deg >= 360) {
      deg -= 360;
    }
    return _Angle.from_degrees(deg);
  }
  /**
   * @returns a new Angle that's reflected in the other direction, for
   * example, 90 degrees ends up being -90 or 270 degrees (when normalized).
   */
  negative() {
    return new _Angle(-this.radians);
  }
  get is_vertical() {
    return this.degrees == 90 || this.degrees == 270;
  }
  get is_horizontal() {
    return this.degrees == 0 || this.degrees == 180;
  }
  rotate_point(point, origin = new Vec2(0, 0)) {
    let x = point.x - origin.x;
    let y = point.y - origin.y;
    const angle = this.normalize();
    if (angle.degrees == 0) {
    } else if (angle.degrees == 90) {
      [x, y] = [y, -x];
    } else if (angle.degrees == 180) {
      [x, y] = [-x, -y];
    } else if (angle.degrees == 270) {
      [x, y] = [-y, x];
    } else {
      const sina = Math.sin(angle.radians);
      const cosa = Math.cos(angle.radians);
      const [x0, y0] = [x, y];
      x = y0 * sina + x0 * cosa;
      y = y0 * cosa - x0 * sina;
    }
    x += origin.x;
    y += origin.y;
    return new Vec2(x, y);
  }
};

// base/math/bbox.ts
var BBox = class _BBox {
  /**
   * Create a bounding box
   */
  constructor(x = 0, y = 0, w = 0, h = 0, context) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.context = context;
    if (this.w < 0) {
      this.w *= -1;
      this.x -= this.w;
    }
    if (this.h < 0) {
      this.h *= -1;
      this.y -= this.h;
    }
  }
  static {
    __name(this, "BBox");
  }
  copy() {
    return new _BBox(this.x, this.y, this.w, this.h, this.context);
  }
  /**
   * Create a BBox given the top left and bottom right corners
   */
  static from_corners(x1, y1, x2, y2, context) {
    if (x2 < x1) {
      [x1, x2] = [x2, x1];
    }
    if (y2 < y1) {
      [y1, y2] = [y2, y1];
    }
    return new _BBox(x1, y1, x2 - x1, y2 - y1, context);
  }
  /**
   * Create a BBox that contains all the given points
   */
  static from_points(points, context) {
    if (points.length == 0) {
      return new _BBox(0, 0, 0, 0);
    }
    const first_pt = points[0];
    const start = first_pt.copy();
    const end = first_pt.copy();
    for (const p of points) {
      start.x = Math.min(start.x, p.x);
      start.y = Math.min(start.y, p.y);
      end.x = Math.max(end.x, p.x);
      end.y = Math.max(end.y, p.y);
    }
    return _BBox.from_corners(start.x, start.y, end.x, end.y, context);
  }
  /**
   * Combine two or more BBoxes into a new BBox that contains both
   */
  static combine(boxes, context) {
    let min_x = Number.POSITIVE_INFINITY;
    let min_y = Number.POSITIVE_INFINITY;
    let max_x = Number.NEGATIVE_INFINITY;
    let max_y = Number.NEGATIVE_INFINITY;
    for (const box of boxes) {
      if (!box.valid) {
        continue;
      }
      min_x = Math.min(min_x, box.x);
      min_y = Math.min(min_y, box.y);
      max_x = Math.max(max_x, box.x2);
      max_y = Math.max(max_y, box.y2);
    }
    if (min_x == Number.POSITIVE_INFINITY || min_y == Number.POSITIVE_INFINITY || max_x == Number.NEGATIVE_INFINITY || max_y == Number.NEGATIVE_INFINITY) {
      return new _BBox(0, 0, 0, 0, context);
    }
    return _BBox.from_corners(min_x, min_y, max_x, max_y, context);
  }
  /**
   * @returns true if the BBox has a non-zero area
   */
  get valid() {
    return (this.w !== 0 || this.h !== 0) && this.w !== void 0 && this.h !== void 0;
  }
  get start() {
    return new Vec2(this.x, this.y);
  }
  set start(v) {
    this.x = v.x;
    this.y = v.y;
  }
  get end() {
    return new Vec2(this.x + this.w, this.y + this.h);
  }
  set end(v) {
    this.x2 = v.x;
    this.y2 = v.y;
  }
  get top_left() {
    return this.start;
  }
  get top_right() {
    return new Vec2(this.x + this.w, this.y);
  }
  get bottom_left() {
    return new Vec2(this.x, this.y + this.h);
  }
  get bottom_right() {
    return this.end;
  }
  get x2() {
    return this.x + this.w;
  }
  set x2(v) {
    this.w = v - this.x;
    if (this.w < 0) {
      this.w *= -1;
      this.x -= this.w;
    }
  }
  get y2() {
    return this.y + this.h;
  }
  set y2(v) {
    this.h = v - this.y;
    if (this.h < 0) {
      this.h *= -1;
      this.y -= this.h;
    }
  }
  get center() {
    return new Vec2(this.x + this.w / 2, this.y + this.h / 2);
  }
  /**
   * @returns A new BBox transformed by the given matrix.
   */
  transform(mat) {
    const start = mat.transform(this.start);
    const end = mat.transform(this.end);
    return _BBox.from_corners(start.x, start.y, end.x, end.y, this.context);
  }
  /**
   * @returns A new BBox with the size uniformly modified from the center
   */
  grow(dx, dy) {
    dy ??= dx;
    return new _BBox(
      this.x - dx,
      this.y - dy,
      this.w + dx * 2,
      this.h + dy * 2,
      this.context
    );
  }
  scale(s) {
    return _BBox.from_points(
      [this.start.multiply(s), this.end.multiply(s)],
      this.context
    );
  }
  /**
   * @returns a BBox flipped around the X axis (mirrored Y)
   */
  mirror_vertical() {
    return new _BBox(this.x, -this.y, this.w, -this.h);
  }
  /** returns true if this box contains the other */
  contains(other) {
    return this.contains_point(other.start) && this.contains_point(other.end);
  }
  /**
   * @returns true if the point is within the bounding box.
   */
  contains_point(v) {
    return v.x >= this.x && v.x <= this.x2 && v.y >= this.y && v.y <= this.y2;
  }
  /**
   * @returns A new Vec2 constrained within this bounding box
   */
  constrain_point(v) {
    const x = Math.min(Math.max(v.x, this.x), this.x2);
    const y = Math.min(Math.max(v.y, this.y), this.y2);
    return new Vec2(x, y);
  }
  intersect_segment(a, b) {
    if (this.contains_point(a)) {
      return null;
    }
    const left = [this.top_left, this.bottom_left];
    const right = [this.top_right, this.bottom_right];
    const top = [this.top_left, this.top_right];
    const bottom = [this.bottom_left, this.bottom_right];
    const start = a;
    const end = b;
    for (const seg of [left, right, top, bottom]) {
      const intersection = Vec2.segment_intersect(a, b, ...seg);
      if (!intersection) {
        continue;
      }
      if (intersection.sub(start).squared_magnitude < end.sub(start).squared_magnitude) {
        end.set(intersection);
      }
    }
    if (start.equals(end)) {
      return null;
    }
    return end;
  }
};

// base/math/arc.ts
var Arc = class _Arc {
  /**
   * Create a new Arc
   */
  constructor(center, radius, start_angle, end_angle, width, direction = "clockwise") {
    this.center = center;
    this.radius = radius;
    this.start_angle = start_angle;
    this.end_angle = end_angle;
    this.width = width;
    this.direction = direction;
  }
  static {
    __name(this, "Arc");
  }
  /**
   * Create an Arc given three points on a circle
   */
  static from_three_points(start, mid, end, width = 1) {
    const u = 1e6;
    const center = arc_center_from_three_points(
      new Vec2(start.x * u, start.y * u),
      new Vec2(mid.x * u, mid.y * u),
      new Vec2(end.x * u, end.y * u)
    );
    center.x /= u;
    center.y /= u;
    const radius = center.sub(mid).magnitude;
    const start_angle = start.sub(center).angle;
    const mid_angle = mid.sub(center).angle;
    const end_angle = end.sub(center).angle;
    let arc_angle;
    const start_to_mid = mid_angle.sub(start_angle).normalize();
    const start_to_end = end_angle.sub(start_angle).normalize();
    if (start_to_mid.degrees < start_to_end.degrees) {
      arc_angle = start_to_end;
    } else {
      arc_angle = Angle.from_degrees(360).sub(start_to_end);
    }
    let arc_start;
    let direction;
    const mid_to_start = mid.sub(start);
    const end_to_mid = end.sub(mid);
    if (mid_to_start.cross(end_to_mid) < 0) {
      arc_start = end_angle.normalize();
      direction = "counter-clockwise";
    } else {
      arc_start = start_angle.normalize();
      direction = "clockwise";
    }
    const arc_end = arc_start.add(arc_angle);
    return new _Arc(center, radius, arc_start, arc_end, width, direction);
  }
  static from_center_start_end(center, start, end, width) {
    const radius = start.sub(center).magnitude;
    const start_radial = start.sub(center);
    const end_radial = end.sub(center);
    let start_angle = start_radial.kicad_angle;
    let end_angle = end_radial.kicad_angle;
    if (end_angle.degrees == start_angle.degrees) {
      end_angle.degrees = start_angle.degrees + 360;
    }
    if (start_angle.degrees > end_angle.degrees) {
      if (end_angle.degrees < 0) {
        end_angle = end_angle.normalize();
      } else {
        start_angle = start_angle.normalize().sub(Angle.from_degrees(-360));
      }
    }
    return new _Arc(center, radius, start_angle, end_angle, width);
  }
  get start_radial() {
    return this.start_angle.rotate_point(new Vec2(this.radius, 0));
  }
  get start_point() {
    return this.center.add(this.start_radial);
  }
  get end_radial() {
    return this.end_angle.rotate_point(new Vec2(this.radius, 0));
  }
  get end_point() {
    return this.center.add(this.end_radial);
  }
  get mid_angle() {
    return new Angle(
      (this.start_angle.radians + this.end_angle.radians) / 2
    );
  }
  get mid_radial() {
    return this.mid_angle.rotate_point(new Vec2(this.radius, 0));
  }
  get mid_point() {
    return this.center.add(this.mid_radial);
  }
  get arc_angle() {
    return this.end_angle.sub(this.start_angle);
  }
  /**
   * Approximate the Arc using a polyline
   */
  to_polyline() {
    const points = [];
    let start = this.start_angle.radians;
    let end = this.end_angle.radians;
    if (start > end) {
      [end, start] = [start, end];
    }
    for (let theta = start; theta < end; theta += Math.PI / 32) {
      points.push(
        new Vec2(
          this.center.x + Math.cos(theta) * this.radius,
          this.center.y + Math.sin(theta) * this.radius
        )
      );
    }
    let last_angle;
    if (this.direction === "counter-clockwise") {
      points.reverse();
      last_angle = start;
    } else {
      last_angle = end;
    }
    const last_point = new Vec2(
      this.center.x + Math.cos(last_angle) * this.radius,
      this.center.y + Math.sin(last_angle) * this.radius
    );
    if (!last_point.equals(points[points.length - 1])) {
      points.push(last_point);
    }
    return points;
  }
  /**
   * Same as to_polyline, but includes the arc center
   */
  to_polygon() {
    const points = this.to_polyline();
    points.push(this.center);
    return points;
  }
  /**
   * Get a bounding box that encloses the entire arc.
   */
  get bbox() {
    const points = [this.start_point, this.mid_point, this.end_point];
    if (this.start_angle.degrees < 0 && this.end_angle.degrees >= 0) {
      points.push(this.center.add(new Vec2(this.radius, 0)));
    }
    if (this.start_angle.degrees < 90 && this.end_angle.degrees >= 90) {
      points.push(this.center.add(new Vec2(0, this.radius)));
    }
    if (this.start_angle.degrees < 180 && this.end_angle.degrees >= 180) {
      points.push(this.center.add(new Vec2(-this.radius, 0)));
    }
    if (this.start_angle.degrees < 270 && this.end_angle.degrees >= 270) {
      points.push(this.center.add(new Vec2(0, this.radius)));
    }
    if (this.start_angle.degrees < 360 && this.end_angle.degrees >= 360) {
      points.push(this.center.add(new Vec2(0, this.radius)));
    }
    return BBox.from_points(points);
  }
};
function arc_center_from_three_points(start, mid, end) {
  const sqrt_1_2 = Math.SQRT1_2;
  const center = new Vec2(0, 0);
  const y_delta_21 = mid.y - start.y;
  let x_delta_21 = mid.x - start.x;
  const y_delta_32 = end.y - mid.y;
  let x_delta_32 = end.x - mid.x;
  if (x_delta_21 == 0 && y_delta_32 == 0 || y_delta_21 == 0 && x_delta_32 == 0) {
    center.x = (start.x + end.x) / 2;
    center.y = (start.y + end.y) / 2;
    return center;
  }
  if (x_delta_21 == 0) {
    x_delta_21 = Number.EPSILON;
  }
  if (x_delta_32 == 0) x_delta_32 = -Number.EPSILON;
  let slope_a = y_delta_21 / x_delta_21;
  let slope_b = y_delta_32 / x_delta_32;
  const d_slope_a = slope_a * new Vec2(0.5 / y_delta_21, 0.5 / x_delta_21).magnitude;
  const d_slope_b = slope_b * new Vec2(0.5 / y_delta_32, 0.5 / x_delta_32).magnitude;
  if (slope_a == slope_b) {
    if (start == end) {
      center.x = (start.x + mid.x) / 2;
      center.y = (start.y + mid.y) / 2;
      return center;
    } else {
      slope_a += Number.EPSILON;
      slope_b -= Number.EPSILON;
    }
  }
  if (slope_a == 0) {
    slope_a = Number.EPSILON;
  }
  const slope_ab_start_end_y = slope_a * slope_b * (start.y - end.y);
  const d_slope_ab_start_end_y = slope_ab_start_end_y * Math.sqrt(
    d_slope_a / slope_a * d_slope_a / slope_a + d_slope_b / slope_b * d_slope_b / slope_b + sqrt_1_2 / (start.y - end.y) * (sqrt_1_2 / (start.y - end.y))
  );
  const slope_b_start_mid_x = slope_b * (start.x + mid.x);
  const d_slope_b_start_mid_x = slope_b_start_mid_x * Math.sqrt(
    d_slope_b / slope_b * d_slope_b / slope_b + sqrt_1_2 / (start.x + mid.x) * sqrt_1_2 / (start.x + mid.x)
  );
  const slope_a_mid_end_x = slope_a * (mid.x + end.x);
  const d_slope_a_mid_end_x = slope_a_mid_end_x * Math.sqrt(
    d_slope_a / slope_a * d_slope_a / slope_a + sqrt_1_2 / (mid.x + end.x) * sqrt_1_2 / (mid.x + end.x)
  );
  const twice_b_a_slope_diff = 2 * (slope_b - slope_a);
  const d_twice_b_a_slope_diff = 2 * Math.sqrt(d_slope_b * d_slope_b + d_slope_a * d_slope_a);
  const center_numerator_x = slope_ab_start_end_y + slope_b_start_mid_x - slope_a_mid_end_x;
  const d_center_numerator_x = Math.sqrt(
    d_slope_ab_start_end_y * d_slope_ab_start_end_y + d_slope_b_start_mid_x * d_slope_b_start_mid_x + d_slope_a_mid_end_x * d_slope_a_mid_end_x
  );
  const center_x = (slope_ab_start_end_y + slope_b_start_mid_x - slope_a_mid_end_x) / twice_b_a_slope_diff;
  const d_center_x = center_x * Math.sqrt(
    d_center_numerator_x / center_numerator_x * d_center_numerator_x / center_numerator_x + d_twice_b_a_slope_diff / twice_b_a_slope_diff * d_twice_b_a_slope_diff / twice_b_a_slope_diff
  );
  const center_numerator_y = (start.x + mid.x) / 2 - center_x;
  const d_center_numerator_y = Math.sqrt(1 / 8 + d_center_x * d_center_x);
  const center_first_term = center_numerator_y / slope_a;
  const d_center_first_term_y = center_first_term * Math.sqrt(
    d_center_numerator_y / center_numerator_y * d_center_numerator_y / center_numerator_y + d_slope_a / slope_a * d_slope_a / slope_a
  );
  const center_y = center_first_term + (start.y + mid.y) / 2;
  const d_center_y = Math.sqrt(
    d_center_first_term_y * d_center_first_term_y + 1 / 8
  );
  const rounded_100_center_x = Math.floor((center_x + 50) / 100) * 100;
  const rounded_100_center_y = Math.floor((center_y + 50) / 100) * 100;
  const rounded_10_center_x = Math.floor((center_x + 5) / 10) * 10;
  const rounded_10_center_y = Math.floor((center_y + 5) / 10) * 10;
  if (Math.abs(rounded_100_center_x - center_x) < d_center_x && Math.abs(rounded_100_center_y - center_y) < d_center_y) {
    center.x = rounded_100_center_x;
    center.y = rounded_100_center_y;
  } else if (Math.abs(rounded_10_center_x - center_x) < d_center_x && Math.abs(rounded_10_center_y - center_y) < d_center_y) {
    center.x = rounded_10_center_x;
    center.y = rounded_10_center_y;
  } else {
    center.x = center_x;
    center.y = center_y;
  }
  return center;
}
__name(arc_center_from_three_points, "arc_center_from_three_points");

// base/math/camera2.ts
var Camera2 = class {
  /**
   * Create a camera
   * @param {Vec2} viewport_size - The width and height of the viewport
   * @param {Vec2} center - The point at which the camera's view is centered
   * @param {number} zoom - Scale factor, increasing numbers zoom the camera in.
   * @param {number|Angle} rotation - Rotation (roll) in radians.
   * @param {boolean} flipped - Flip viewer horizontally. Keep it same as `RenderState.flipped`.
   */
  constructor(viewport_size = new Vec2(0, 0), center = new Vec2(0, 0), zoom = 1, rotation = new Angle(0), flipped = false) {
    this.viewport_size = viewport_size;
    this.center = center;
    this.zoom = zoom;
    this.rotation = rotation;
    this.flipped = flipped;
  }
  static {
    __name(this, "Camera2");
  }
  /**
   * Relative translation
   * @param v
   */
  translate(v, bound) {
    const new_pos = this.center.add(
      new Vec2(this.flipped ? -v.x : v.x, v.y)
    );
    if (bound) {
      new_pos.set(bound.constrain_point(new_pos));
    }
    this.center.set(new_pos);
  }
  /**
   * Relative rotation
   * @param {Angle|number} a - rotation in radians
   */
  rotate(a) {
    this.rotation = this.rotation.add(a);
  }
  /**
   * Complete transformation matrix.
   */
  get matrix() {
    const mx = this.viewport_size.x / 2;
    const my = this.viewport_size.y / 2;
    const dx = this.center.x - this.center.x * this.zoom;
    const dy = this.center.y - this.center.y * this.zoom;
    const left = this.flipped ? -(this.center.x + mx) + dx : -(this.center.x - mx) + dx;
    const top = -(this.center.y - my) + dy;
    const scale = this.flipped ? -1 : 1;
    return Matrix3.identity().scale_self(scale, 1).translate_self(left, top).rotate_self(this.rotation).scale_self(this.zoom, this.zoom);
  }
  /**
   * Bounding box representing the camera's view
   */
  get bbox() {
    const m = this.matrix.inverse();
    const start = m.transform(new Vec2(0, 0));
    const end = m.transform(
      new Vec2(this.viewport_size.x, this.viewport_size.y)
    );
    return new BBox(start.x, start.y, end.x - start.x, end.y - start.y);
  }
  /**
   * Move the camera and adjust zoom so that the given bounding box is in
   * view.
   */
  set bbox(bbox) {
    const zoom_w = this.viewport_size.x / bbox.w;
    const zoom_h = this.viewport_size.y / bbox.h;
    const center_x = bbox.x + bbox.w / 2;
    const center_y = bbox.y + bbox.h / 2;
    this.zoom = Math.min(zoom_w, zoom_h);
    this.center.set(center_x, center_y);
  }
  get top() {
    return this.bbox.y;
  }
  get bottom() {
    return this.bbox.y2;
  }
  get left() {
    return this.bbox.x;
  }
  get right() {
    return this.bbox.x2;
  }
  /**
   * Apply this camera to a 2D canvas
   *
   * A simple convenience method that sets the canvas's transform to
   * the camera's transformation matrix.
   */
  apply_to_canvas(ctx) {
    this.viewport_size.set(ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    const m = Matrix3.from_DOMMatrix(ctx.getTransform());
    m.multiply_self(this.matrix);
    ctx.setTransform(m.to_DOMMatrix());
  }
  /**
   * Transform screen coordinates to world coordinates
   */
  screen_to_world(v) {
    return this.matrix.inverse().transform(v);
  }
  /**
   * Transform world coordinates to screen coordinates
   */
  world_to_screen(v) {
    return this.matrix.transform(v);
  }
};

// base/color.ts
var Color = class _Color {
  constructor(r, g, b, a = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
  static {
    __name(this, "Color");
  }
  copy() {
    return new _Color(this.r, this.g, this.b, this.a);
  }
  static get transparent_black() {
    return new _Color(0, 0, 0, 0);
  }
  static get black() {
    return new _Color(0, 0, 0, 1);
  }
  static get white() {
    return new _Color(1, 1, 1, 1);
  }
  static from_css(str) {
    let r, g, b, a;
    if (str[0] == "#") {
      str = str.slice(1);
      if (str.length == 3) {
        str = `${str[0]}${str[0]}${str[1]}${str[1]}${str[2]}${str[2]}`;
      }
      if (str.length == 6) {
        str = `${str}FF`;
      }
      [r, g, b, a] = [
        parseInt(str.slice(0, 2), 16) / 255,
        parseInt(str.slice(2, 4), 16) / 255,
        parseInt(str.slice(4, 6), 16) / 255,
        parseInt(str.slice(6, 8), 16) / 255
      ];
    } else if (str.startsWith("rgb")) {
      if (!str.startsWith("rgba")) {
        str = `rgba(${str.slice(4, -1)}, 1)`;
      }
      str = str.trim().slice(5, -1);
      const parts = str.split(",");
      if (parts.length != 4) {
        throw new Error(`Invalid color ${str}`);
      }
      [r, g, b, a] = [
        parseFloat(parts[0]) / 255,
        parseFloat(parts[1]) / 255,
        parseFloat(parts[2]) / 255,
        parseFloat(parts[3])
      ];
    } else {
      throw new Error(`Unable to parse CSS color string ${str}`);
    }
    return new _Color(r, g, b, a);
  }
  to_css() {
    return `rgba(${this.r_255}, ${this.g_255}, ${this.b_255}, ${this.a})`;
  }
  to_array() {
    return [this.r, this.g, this.b, this.a];
  }
  get r_255() {
    return Math.round(this.r * 255);
  }
  set r_255(v) {
    this.r = v / 255;
  }
  get g_255() {
    return Math.round(this.g * 255);
  }
  set g_255(v) {
    this.g = v / 255;
  }
  get b_255() {
    return Math.round(this.b * 255);
  }
  set b_255(v) {
    this.b = v / 255;
  }
  get is_transparent_black() {
    return this.r == 0 && this.g == 0 && this.b == 0 && this.a == 0;
  }
  with_alpha(a) {
    const c = this.copy();
    c.a = a;
    return c;
  }
  desaturate() {
    if (this.r == this.g && this.r == this.b) {
      return this;
    }
    const [h, _, l] = rgb_to_hsl(this.r, this.g, this.b);
    return new _Color(...hsl_to_rgb(h, 0, l));
  }
  mix(other, amount) {
    return new _Color(
      other.r * (1 - amount) + this.r * amount,
      other.g * (1 - amount) + this.g * amount,
      other.b * (1 - amount) + this.b * amount,
      this.a
    );
  }
};
function rgb_to_hsl(r, g, b) {
  const max = Math.max(...[r, g, b]);
  const min = Math.min(...[r, g, b]);
  const l = (min + max) / 2;
  const d = max - min;
  let [h, s] = [NaN, 0];
  if (d !== 0) {
    s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
    }
    h = h * 60;
  }
  return [h, s * 100, l * 100];
}
__name(rgb_to_hsl, "rgb_to_hsl");
function hsl_to_rgb(h, s, l) {
  h = h % 360;
  if (h < 0) {
    h += 360;
  }
  s /= 100;
  l /= 100;
  function f(n) {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  }
  __name(f, "f");
  return [f(0), f(8), f(4)];
}
__name(hsl_to_rgb, "hsl_to_rgb");

// kicad/tokenizer.ts
var EOF = "";
var Token = class {
  /**
   * Create a new Token
   */
  constructor(type, value = null) {
    this.type = type;
    this.value = value;
  }
  static {
    __name(this, "Token");
  }
  static {
    this.OPEN = /* @__PURE__ */ Symbol("opn");
  }
  static {
    this.CLOSE = /* @__PURE__ */ Symbol("clo");
  }
  static {
    this.ATOM = /* @__PURE__ */ Symbol("atm");
  }
  static {
    this.NUMBER = /* @__PURE__ */ Symbol("num");
  }
  static {
    this.STRING = /* @__PURE__ */ Symbol("str");
  }
};
function is_digit(c) {
  return c >= "0" && c <= "9";
}
__name(is_digit, "is_digit");
function is_alpha(c) {
  return c >= "A" && c <= "Z" || c >= "a" && c <= "z";
}
__name(is_alpha, "is_alpha");
function is_whitespace(c) {
  return c === EOF || c === " " || c === "\n" || c === "\r" || c === "	";
}
__name(is_whitespace, "is_whitespace");
function is_atom(c) {
  return is_alpha(c) || is_digit(c) || [
    "_",
    "-",
    ":",
    "!",
    ".",
    "[",
    "]",
    "{",
    "}",
    "@",
    "*",
    "/",
    "&",
    "#",
    "%",
    "+",
    "=",
    "~",
    "$",
    "|"
  ].includes(c);
}
__name(is_atom, "is_atom");
function error_context(input, index) {
  let start = input.slice(0, index).lastIndexOf("\n");
  if (start < 0) start = 0;
  let end = input.slice(index).indexOf("\n");
  if (end < 0) end = 20;
  return input.slice(start, index + end);
}
__name(error_context, "error_context");
function* tokenize(input) {
  const open_token = new Token(Token.OPEN);
  const close_token = new Token(Token.CLOSE);
  let state = 0 /* none */;
  let start_idx = 0;
  let escaping = false;
  for (let i = 0; i < input.length + 1; i++) {
    const c = i < input.length ? input[i] : EOF;
    if (state == 0 /* none */) {
      if (c === "(") {
        yield open_token;
        continue;
      } else if (c === ")") {
        yield close_token;
        continue;
      } else if (c === '"') {
        state = 1 /* string */;
        start_idx = i;
        continue;
      } else if (c === "-" || c == "+" || is_digit(c)) {
        state = 2 /* number */;
        start_idx = i;
        continue;
      } else if (is_alpha(c) || ["*", "&", "$", "/", "%", "|"].includes(c)) {
        state = 3 /* atom */;
        start_idx = i;
        continue;
      } else if (is_whitespace(c)) {
        continue;
      } else {
        throw new Error(
          `Unexpected character at index ${i}: ${c}
Context: ${error_context(
            input,
            i
          )}`
        );
      }
    } else if (state == 3 /* atom */) {
      if (is_atom(c)) {
        continue;
      } else if (c === ")" || is_whitespace(c)) {
        yield new Token(Token.ATOM, input.substring(start_idx, i));
        state = 0 /* none */;
        if (c === ")") {
          yield close_token;
        }
      } else {
        throw new Error(
          `Unexpected character while tokenizing atom at index ${i}: ${c}
Context: ${error_context(
            input,
            i
          )}`
        );
      }
    } else if (state == 2 /* number */) {
      if (c === "." || is_digit(c)) {
        continue;
      } else if (c.toLowerCase() === "x") {
        state = 4 /* hex */;
        continue;
      } else if (["+", "-", "a", "b", "c", "d", "e", "f"].includes(
        c.toLowerCase()
      )) {
        state = 3 /* atom */;
        continue;
      } else if (is_atom(c)) {
        state = 3 /* atom */;
        continue;
      } else if (c === ")" || is_whitespace(c)) {
        yield new Token(
          Token.NUMBER,
          parseFloat(input.substring(start_idx, i))
        );
        state = 0 /* none */;
        if (c === ")") {
          yield close_token;
        }
        continue;
      } else {
        throw new Error(
          `Unexpected character at index ${i}: ${c}, expected numeric.
Context: ${error_context(
            input,
            i
          )}`
        );
      }
    } else if (state == 4 /* hex */) {
      if (is_digit(c) || ["a", "b", "c", "d", "e", "f", "_"].includes(c.toLowerCase())) {
        continue;
      } else if (c === ")" || is_whitespace(c)) {
        const hexstr = input.substring(start_idx, i).replace("_", "");
        yield new Token(Token.NUMBER, Number.parseInt(hexstr, 16));
        state = 0 /* none */;
        if (c === ")") {
          yield close_token;
        }
        continue;
      } else if (is_atom(c)) {
        state = 3 /* atom */;
        continue;
      } else {
        throw new Error(
          `Unexpected character at index ${i}: ${c}, expected hexadecimal.
Context: ${error_context(
            input,
            i
          )}`
        );
      }
    } else if (state == 1 /* string */) {
      if (!escaping && c === '"') {
        yield new Token(
          Token.STRING,
          input.substring((start_idx ?? 0) + 1, i).replaceAll("\\n", "\n").replaceAll("\\\\", "\\")
        );
        state = 0 /* none */;
        escaping = false;
        continue;
      } else if (!escaping && c === "\\") {
        escaping = true;
        continue;
      } else {
        escaping = false;
        continue;
      }
    } else {
      throw new Error(
        `Unknown tokenizer state ${state}
Context: ${error_context(
          input,
          i
        )}`
      );
    }
  }
}
__name(tokenize, "tokenize");
function* listify_tokens(tokens) {
  let token;
  let it;
  while (true) {
    it = tokens.next();
    token = it.value;
    switch (token?.type) {
      case Token.ATOM:
      case Token.STRING:
      case Token.NUMBER:
        yield token.value;
        break;
      case Token.OPEN:
        yield Array.from(listify_tokens(tokens));
        break;
      case Token.CLOSE:
      case void 0:
        return;
    }
  }
}
__name(listify_tokens, "listify_tokens");
function listify(src) {
  const tokens = tokenize(src);
  return Array.from(listify_tokens(tokens));
}
__name(listify, "listify");

// kicad/parser.ts
var log = new Logger("kicanvas:parser");
var T = {
  any(obj, name, e) {
    return e;
  },
  boolean(obj, name, e) {
    switch (e) {
      case "false":
      case "no":
        return false;
      case "true":
      case "yes":
        return true;
      default:
        return e ? true : false;
    }
  },
  string(obj, name, e) {
    if (is_string(e)) {
      return e;
    } else {
      return void 0;
    }
  },
  number(obj, name, e) {
    if (is_number(e)) {
      return e;
    } else {
      return void 0;
    }
  },
  item(type, ...args) {
    return (obj, name, e) => {
      return new type(e, ...args);
    };
  },
  object(start, ...defs) {
    return (obj, name, e) => {
      let existing = {};
      if (start !== null) {
        existing = obj[name] ?? start ?? {};
      }
      return {
        ...existing,
        ...parse_expr(e, P.start(name), ...defs)
      };
    };
  },
  vec2(obj, name, e) {
    const el = e;
    return new Vec2(el[1], el[2]);
  },
  color(obj, name, e) {
    const el = e;
    return new Color(el[1] / 255, el[2] / 255, el[3] / 255, el[4]);
  },
  /**
   * Choose a type processor by prefix
   *
   * Example: `choice[("xy", T.vec2), ("color", T.color)]`
   *  - if input is `(xy 1 2)`, use `T.vec2` to parse input
   *  - if input is `(color 1 2 3)`, use `T.color` to parse input
   */
  choice(...fns) {
    return (obj, name, e) => {
      const e_str = e;
      for (const [prefix, fn] of fns) {
        if (prefix === e_str[0]) {
          return fn(obj, name, e);
        }
      }
      throw new Error(`No matched for ${e}`);
    };
  }
};
var P = {
  /**
   * Checks that the first item in the list is "name". For example,
   * (thing 1 2 3) would use start("thing").
   */
  start(name) {
    return {
      kind: 0 /* start */,
      name,
      fn: T.string
    };
  },
  /**
   * Accepts a positional argument. For example,
   * (1 2 3) with positional("first", T.number) would end up with {first: 1}.
   */
  positional(name, typefn = T.any) {
    return {
      kind: 1 /* positional */,
      name,
      fn: typefn
    };
  },
  /**
   * Accepts a pair. For example, ((a 1)) with pair(a) would end up with {a: 1}.
   */
  pair(name, typefn = T.any) {
    return {
      kind: 2 /* pair */,
      name,
      accepts: [name],
      fn: /* @__PURE__ */ __name((obj, name2, e) => {
        return typefn(obj, name2, e[1]);
      }, "fn")
    };
  },
  /**
   * Accepts a list. For example ((a 1 2 3)) with list(a) would end up with {a: [1, 2, 3]}.
   */
  list(name, typefn = T.any) {
    return {
      kind: 3 /* list */,
      name,
      accepts: [name],
      fn: /* @__PURE__ */ __name((obj, name2, e) => {
        return e.slice(1).map((n) => typefn(obj, name2, n));
      }, "fn")
    };
  },
  /**
   * Accepts a collection. For example ((a 1) (a 2) (a 3)) with collection("items", "a")
   * would end up with {items: [[a, 1], [a, 2], [a, 3]]}.
   */
  collection(name, accept, typefn = T.any) {
    return {
      kind: 5 /* item_list */,
      name,
      accepts: [accept],
      fn: /* @__PURE__ */ __name((obj, name2, e) => {
        const list = obj[name2] ?? [];
        list.push(typefn(obj, name2, e));
        return list;
      }, "fn")
    };
  },
  /**
   * Like collection but creates a map instead of an array.. For example
   * ((a key1 1) (a key2 2) (a key3 3)) with collection_map("items", "a")
   * would end up with {items: {key1: [a, key1, 2], ...}.
   */
  mapped_collection(name, accept, keyfn, typefn = T.any) {
    return {
      kind: 5 /* item_list */,
      name,
      accepts: [accept],
      fn: /* @__PURE__ */ __name((obj, name2, e) => {
        const map2 = obj[name2] ?? /* @__PURE__ */ new Map();
        const val = typefn(obj, name2, e);
        const key = keyfn(val);
        map2.set(key, val);
        return map2;
      }, "fn")
    };
  },
  /**
   * Accepts a dictionary. For example ((thing a 1) (thing b 2) (thing c 3)) with
   * dict("things", "thing") would end up with {things: {a: 1, b: 2, c: 3}}.
   */
  dict(name, accept, typefn = T.any) {
    return {
      kind: 5 /* item_list */,
      name,
      accepts: [accept],
      fn: /* @__PURE__ */ __name((obj, name2, e) => {
        const el = e;
        const rec = obj[name2] ?? {};
        rec[el[1]] = typefn(obj, name2, el.slice(2));
        return rec;
      }, "fn")
    };
  },
  /**
   * Accepts an atom. For example (locked) and ((locked)) with atom("locked")
   * would end up with {locked: true}. Atoms can also be mutually exclusive
   * options, for example atom("align", ["left", "right"]) would process
   * (left) as {align: "left"} and (right) as {align: "right"}.
   */
  atom(name, values) {
    let typefn;
    if (values) {
      typefn = T.string;
    } else {
      typefn = T.boolean;
      values = [name];
    }
    return {
      kind: 4 /* atom */,
      name,
      accepts: values,
      fn(obj, name2, e) {
        if (Array.isArray(e) && e.length == 1) {
          e = e[0];
        }
        return typefn(obj, name2, e);
      }
    };
  },
  /**
   * Accepts an expression. For example ((thing a 1 b)) with expr("thing")
   * would end up with {thing: ["thing", a, 1, b]}.
   */
  expr(name, typefn = T.any) {
    return {
      kind: 6 /* expr */,
      name,
      accepts: [name],
      fn: typefn
    };
  },
  /**
   * Accepts an expression that describes a simple object with the given
   * property definitions. For example ((thing (a 1) (b 2))) with
   * object("thing", P.pair("a"), P.pair("b")) would end up with
   * {thing: {a: 1, b: 2}}.
   */
  object(name, start, ...defs) {
    return P.expr(name, T.object(start, ...defs));
  },
  /**
   * Accepts an expression that describes an object that can be used to
   * construct the given Item type. An Item is any class that takes
   * a List as its first constructor parameter.
   */
  item(name, item_type, ...args) {
    return P.expr(name, T.item(item_type, ...args));
  },
  /**
   * Accepts an expression that describes a 2D vector. For example,
   * ((xy 1 2)) with vec2("xy") would end up with {xy: Vec2(1, 2)}.
   */
  vec2(name) {
    return P.expr(name, T.vec2);
  },
  color(name = "color") {
    return P.expr(name, T.color);
  }
};
function parse_expr(expr, ...defs) {
  if (is_string(expr)) {
    log.info(`Parsing expression with ${expr.length} chars`);
    expr = listify(expr);
    if (expr.length == 1 && Array.isArray(expr[0])) {
      expr = expr[0];
    }
  }
  const defs_map = /* @__PURE__ */ new Map();
  let start_def;
  let n = 0;
  for (const def of defs) {
    if (def.kind == 0 /* start */) {
      start_def = def;
    } else if (def.kind == 1 /* positional */) {
      defs_map.set(n, def);
      n++;
    } else {
      for (const a of def.accepts) {
        defs_map.set(a, def);
      }
    }
  }
  if (start_def) {
    const acceptable_start_strings = as_array(start_def.name);
    const first2 = expr.at(0);
    if (!acceptable_start_strings.includes(first2)) {
      throw new Error(
        `Expression must start with ${start_def.name}, but found ${first2} in ${expr}`
      );
    }
    expr = expr.slice(1);
  }
  const out = {};
  n = 0;
  for (const element of expr) {
    let def = null;
    if (is_string(element)) {
      def = defs_map.get(element);
    }
    if (!def && (is_string(element) || is_number(element))) {
      def = defs_map.get(n);
      if (!def) {
        log.warn(
          `Bare element ${element} is undefined at position ${n}`
        );
        continue;
      }
      n++;
    }
    if (!def && Array.isArray(element)) {
      def = defs_map.get(element[0]);
    }
    if (!def) {
      log.warn(
        `No definition found for element ${Array.isArray(element) ? element[0] : element}`
      );
      continue;
    }
    const value = def.fn(out, def.name, element);
    out[def.name] = value;
  }
  return out;
}
__name(parse_expr, "parse_expr");

// kicad/common.ts
function unescape_string(str) {
  const escape_vars = {
    dblquote: '"',
    quote: "'",
    lt: "<",
    gt: ">",
    backslash: "\\",
    slash: "/",
    bar: "|",
    comma: ",",
    colon: ":",
    space: " ",
    dollar: "$",
    tab: "	",
    return: "\n",
    brace: "{"
  };
  for (const [k, v] of Object.entries(escape_vars)) {
    str = str.replaceAll("{" + k + "}", v);
  }
  return str;
}
__name(unescape_string, "unescape_string");
function expand_text_vars(text, resolveable) {
  text = unescape_string(text);
  if (resolveable === void 0) {
    return text;
  }
  let last_len;
  let retry_count = 8;
  const resolved = [];
  do {
    last_len = resolved.length;
    retry_count -= 1;
    text = text.replaceAll(
      /(\$\{(.+?)\})/g,
      (substring, all, name) => {
        if (resolved.includes(name)) {
          log.warn(`Cycle reference "${name}" in text "${text}"`);
          return all;
        }
        const val = resolveable.resolve_text_var(name);
        if (val === void 0) {
          return all;
        }
        resolved.push(name);
        return val;
      }
    );
  } while (last_len !== resolved.length || retry_count === 0);
  return text;
}
__name(expand_text_vars, "expand_text_vars");
var At = class _At {
  constructor(expr) {
    this.position = new Vec2(0, 0);
    this.rotation = 0;
    this.unlocked = false;
    if (expr) {
      const parsed = parse_expr(
        expr,
        P.start("at"),
        P.positional("x", T.number),
        P.positional("y", T.number),
        P.positional("rotation", T.number),
        P.atom("unlocked")
      );
      this.position.set(parsed.x, parsed.y);
      this.rotation = parsed.rotation ?? this.rotation;
      this.unlocked = parsed.unlocked ?? this.unlocked;
    }
  }
  static {
    __name(this, "At");
  }
  copy() {
    const at = new _At();
    at.position = this.position.copy();
    at.rotation = this.rotation;
    at.unlocked = this.unlocked;
    return at;
  }
};
var PaperSize = {
  User: [431.8, 279.4],
  A0: [1189, 841],
  A1: [841, 594],
  A2: [594, 420],
  A3: [420, 297],
  A4: [297, 210],
  A5: [210, 148],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4]
};
var Paper = class {
  constructor(expr) {
    this.portrait = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("paper"),
        P.atom("size", Object.keys(PaperSize)),
        P.positional("width", T.number),
        P.positional("height", T.number),
        P.atom("portrait")
      )
    );
    const paper_size = PaperSize[this.size];
    if (!this.width && paper_size) {
      this.width = paper_size[0];
    }
    if (!this.height && paper_size) {
      this.height = paper_size[1];
    }
    if (this.size != "User" && this.portrait) {
      [this.width, this.height] = [this.height, this.width];
    }
  }
  static {
    __name(this, "Paper");
  }
};
var TitleBlock = class {
  constructor(expr) {
    this.title = "";
    this.date = "";
    this.rev = "";
    this.company = "";
    this.comment = {};
    if (expr) {
      Object.assign(
        this,
        parse_expr(
          expr,
          P.start("title_block"),
          P.pair("title", T.string),
          P.pair("date", T.string),
          P.pair("rev", T.string),
          P.pair("company", T.string),
          P.expr("comment", (obj, name, e) => {
            const ep = e;
            const record = obj[name] ?? {};
            record[ep[1]] = ep[2];
            return record;
          })
        )
      );
    }
  }
  static {
    __name(this, "TitleBlock");
  }
  resolve_text_var(name) {
    return (/* @__PURE__ */ new Map([
      ["ISSUE_DATE", this.date],
      ["REVISION", this.rev],
      ["TITLE", this.title],
      ["COMPANY", this.company],
      ["COMMENT1", this.comment[1] ?? ""],
      ["COMMENT2", this.comment[2] ?? ""],
      ["COMMENT3", this.comment[3] ?? ""],
      ["COMMENT4", this.comment[4] ?? ""],
      ["COMMENT5", this.comment[5] ?? ""],
      ["COMMENT6", this.comment[6] ?? ""],
      ["COMMENT7", this.comment[7] ?? ""],
      ["COMMENT8", this.comment[8] ?? ""],
      ["COMMENT9", this.comment[9] ?? ""]
    ])).get(name);
  }
};
var Effects = class _Effects {
  constructor(expr) {
    this.font = new Font();
    this.justify = new Justify();
    this.hide = false;
    if (expr) {
      Object.assign(
        this,
        parse_expr(
          expr,
          P.start("effects"),
          P.item("font", Font),
          P.item("justify", Justify),
          P.atom("hide"),
          P.color()
        )
      );
    }
  }
  static {
    __name(this, "Effects");
  }
  copy() {
    const e = new _Effects();
    e.font = this.font.copy();
    e.justify = this.justify.copy();
    e.hide = this.hide;
    return e;
  }
};
var Font = class _Font {
  constructor(expr) {
    this.size = new Vec2(1.27, 1.27);
    this.thickness = 0;
    this.bold = false;
    this.italic = false;
    this.color = Color.transparent_black;
    if (expr) {
      Object.assign(
        this,
        parse_expr(
          expr,
          P.start("font"),
          P.pair("face", T.string),
          P.vec2("size"),
          P.pair("thickness", T.number),
          P.atom("bold"),
          P.atom("italic"),
          P.pair("line_spacing", T.number),
          P.color()
        )
      );
      [this.size.x, this.size.y] = [this.size.y, this.size.x];
    }
  }
  static {
    __name(this, "Font");
  }
  copy() {
    const f = new _Font();
    f.face = this.face;
    f.size = this.size.copy();
    f.thickness = this.thickness;
    f.bold = this.bold;
    f.italic = this.italic;
    return f;
  }
};
var Justify = class _Justify {
  constructor(expr) {
    this.horizontal = "center";
    this.vertical = "center";
    this.mirror = false;
    if (expr) {
      Object.assign(
        this,
        parse_expr(
          expr,
          P.start("justify"),
          P.atom("horizontal", ["left", "right"]),
          P.atom("vertical", ["top", "bottom"]),
          P.atom("mirror")
        )
      );
    }
  }
  static {
    __name(this, "Justify");
  }
  copy() {
    const j = new _Justify();
    j.horizontal = this.horizontal;
    j.vertical = this.vertical;
    j.mirror = this.mirror;
    return j;
  }
};
var Stroke = class {
  constructor(expr) {
    this.type = "default";
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("stroke"),
        P.pair("width", T.number),
        P.pair("type", T.string),
        P.color()
      )
    );
  }
  static {
    __name(this, "Stroke");
  }
  static default_value() {
    return {
      width: 0,
      type: "default",
      color: Color.transparent_black
    };
  }
};
var EmbeddedFile = class {
  static {
    __name(this, "EmbeddedFile");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("file"),
        P.pair("name", T.string),
        P.pair("type", T.string),
        P.pair("data", T.string),
        P.pair("checksum", T.string)
      )
    );
  }
  async decompress_file() {
    if (!this.data) {
      return void 0;
    }
    return void 0;
  }
};
var StrokeParams = class _StrokeParams {
  static {
    __name(this, "StrokeParams");
  }
  static {
    /** ISO 128-2 line correction factor */
    this.line_correction = 1;
  }
  /** Calculate the length of a dot in a dashed line. */
  static dot_length(line) {
    return Math.max(1 - _StrokeParams.line_correction, 0.2) * line;
  }
  /** Calculate the length of a gap in a dashed line. */
  static gap_length(line, stroke) {
    const gap_ratio = stroke.dashed_line_gap_ratio;
    return Math.max(gap_ratio + _StrokeParams.line_correction, 1) * line;
  }
  /** Calculate the length of a dash in a dashed line. */
  static dash_length(line, stroke) {
    const dash_ratio = stroke.dashed_line_dash_ratio;
    return Math.max(dash_ratio - _StrokeParams.line_correction, 1) * line;
  }
  /** Solid line, gap: 3, dash: 12. */
  static default_value() {
    return {
      stroke: Stroke.default_value(),
      dashed_line_gap_ratio: 3,
      dashed_line_dash_ratio: 12
    };
  }
};
var Net = class {
  static {
    __name(this, "Net");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("net"),
        P.positional("number", T.number),
        P.positional("name", T.string)
      )
    );
  }
};
function isNetInfo(obj) {
  return "net" in obj && obj.__lookupGetter__("netname") !== void 0;
}
__name(isNetInfo, "isNetInfo");
function getNetNumber(item) {
  if (typeof item.net === "number") {
    return item.net;
  } else {
    return item.net.number;
  }
}
__name(getNetNumber, "getNetNumber");

// kicad/board.ts
var KicadPCB = class {
  constructor(filename, expr) {
    this.filename = filename;
    this.general = {
      thickness: 1.6,
      legacy_teardrops: false
    };
    this.title_block = new TitleBlock();
    this.properties = /* @__PURE__ */ new Map();
    this.layers = [];
    this.nets = [];
    this.footprints = [];
    this.zones = [];
    this.segments = [];
    this.vias = [];
    this.drawings = [];
    this.groups = [];
    this.embedded_fonts = false;
    this.embedded_files = [];
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("kicad_pcb"),
        P.pair("version", T.number),
        P.pair("generator", T.string),
        P.pair("generator_version", T.string),
        P.object(
          "general",
          {},
          P.pair("thickness", T.number),
          P.pair("legacy_teardrops", T.boolean)
        ),
        P.item("paper", Paper),
        P.item("title_block", TitleBlock),
        P.list("layers", T.item(Layer)),
        P.item("setup", Setup),
        P.mapped_collection(
          "properties",
          "property",
          (p) => p.name,
          T.item(Property, this)
        ),
        P.collection("nets", "net", T.item(Net)),
        P.collection(
          "footprints",
          "footprint",
          T.item(Footprint, this)
        ),
        P.collection("zones", "zone", T.item(Zone, this)),
        P.collection("segments", "segment", T.item(LineSegment, this)),
        P.collection("segments", "arc", T.item(ArcSegment, this)),
        P.collection("vias", "via", T.item(Via, this)),
        P.collection("drawings", "dimension", T.item(Dimension, this)),
        P.collection("drawings", "gr_line", T.item(GrLine, this)),
        P.collection("drawings", "gr_circle", T.item(GrCircle, this)),
        P.collection("drawings", "gr_arc", T.item(GrArc, this)),
        P.collection("drawings", "gr_poly", T.item(GrPoly, this)),
        P.collection("drawings", "gr_rect", T.item(GrRect, this)),
        P.collection("drawings", "gr_text", T.item(GrText, this)),
        P.collection("groups", "group", T.item(Group)),
        P.pair("embedded_fonts", T.boolean),
        P.list("embedded_files", T.item(EmbeddedFile))
      )
    );
    this.nets.sort((a, b) => a.number - b.number);
  }
  static {
    __name(this, "KicadPCB");
  }
  *items() {
    yield* this.drawings;
    yield* this.vias;
    yield* this.segments;
    yield* this.zones;
    yield* this.footprints;
  }
  resolve_text_var(name) {
    if (name == "FILENAME") {
      return this.filename;
    }
    if (this.properties.has(name)) {
      return this.properties.get(name).value;
    }
    return this.title_block.resolve_text_var(name);
  }
  get edge_cuts_bbox() {
    let bbox = new BBox(0, 0, 0, 0);
    for (const item of this.drawings) {
      if (item.layer != "Edge.Cuts" || !(item instanceof GraphicItem)) {
        continue;
      }
      bbox = BBox.combine([bbox, item.bbox]);
    }
    return bbox;
  }
  find_footprint(uuid_or_ref) {
    for (const fp of this.footprints) {
      if (fp.unique_id == uuid_or_ref || fp.reference == uuid_or_ref) {
        return fp;
      }
    }
    return null;
  }
  get_netname_by_number(net_number) {
    return this.nets[net_number]?.name;
  }
};
var Property = class {
  static {
    __name(this, "Property");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("property"),
        P.positional("name", T.string),
        P.positional("value", T.string)
      )
    );
  }
};
var LineSegment = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("segment"),
        P.vec2("start"),
        P.vec2("end"),
        P.pair("width", T.number),
        P.pair("layer", T.string),
        P.pair("net", T.number),
        P.atom("locked"),
        P.pair("uuid", T.string),
        P.pair("tstamp", T.string)
      )
    );
  }
  static {
    __name(this, "LineSegment");
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
  get netname() {
    return this.parent.get_netname_by_number(this.net);
  }
};
var ArcSegment = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("arc"),
        P.vec2("start"),
        P.vec2("mid"),
        P.vec2("end"),
        P.pair("width", T.number),
        P.pair("layer", T.string),
        P.pair("net", T.number),
        P.atom("locked"),
        P.pair("tstamp", T.string),
        P.pair("uuid", T.string)
      )
    );
  }
  static {
    __name(this, "ArcSegment");
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
  get netname() {
    return this.parent.get_netname_by_number(this.net);
  }
};
var Via = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.type = "through-hole";
    this.remove_unused_layers = false;
    this.keep_end_layers = false;
    this.locked = false;
    this.free = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("via"),
        P.atom("type", ["blind", "micro", "through-hole"]),
        P.item("at", At),
        P.pair("size", T.number),
        P.pair("drill", T.number),
        P.list("layers", T.string),
        P.pair("net", T.number),
        P.atom("locked"),
        P.atom("free"),
        P.atom("remove_unused_layers"),
        P.atom("keep_end_layers"),
        P.pair("tstamp", T.string),
        P.pair("uuid", T.string)
      )
    );
  }
  static {
    __name(this, "Via");
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
  get netname() {
    return this.parent.get_netname_by_number(this.net);
  }
};
var Zone = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("zone"),
        P.atom("locked"),
        P.pair("net", T.number),
        P.pair("net_name", T.string),
        P.pair("net_name", T.string),
        P.pair("name", T.string),
        P.pair("layer", T.string),
        P.list("layers", T.string),
        P.object(
          "hatch",
          {},
          P.positional("style", T.string),
          P.positional("pitch", T.number)
        ),
        P.pair("priority", T.number),
        P.object(
          "connect_pads",
          {},
          P.positional("type", T.string),
          P.pair("clearance", T.number)
        ),
        P.pair("min_thickness", T.number),
        P.pair("filled_areas_thickness", T.boolean),
        P.item("keepout", ZoneKeepout),
        P.item("fill", ZoneFill),
        P.collection("polygons", "polygon", T.item(Poly)),
        P.collection(
          "filled_polygons",
          "filled_polygon",
          T.item(FilledPolygon)
        ),
        P.pair("tstamp", T.string),
        P.pair("uuid", T.string)
      )
    );
  }
  static {
    __name(this, "Zone");
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
};
var ZoneKeepout = class {
  static {
    __name(this, "ZoneKeepout");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("keepout"),
        P.pair("tracks", T.string),
        P.pair("vias", T.string),
        P.pair("pads", T.string),
        P.pair("copperpour", T.string),
        P.pair("footprints", T.string)
      )
    );
  }
};
var ZoneFill = class {
  constructor(expr) {
    this.fill = false;
    this.mode = "solid";
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("fill"),
        P.positional("fill", T.boolean),
        P.pair("mode", T.string),
        P.pair("thermal_gap", T.number),
        P.pair("thermal_bridge_width", T.number),
        P.expr(
          "smoothing",
          T.object(
            {},
            P.positional("style", T.string),
            P.pair("radius", T.number)
          )
        ),
        P.pair("radius", T.number),
        P.pair("island_removal_mode", T.number),
        P.pair("island_area_min", T.number),
        P.pair("hatch_thickness", T.number),
        P.pair("hatch_gap", T.number),
        P.pair("hatch_orientation", T.number),
        P.pair("hatch_smoothing_level", T.number),
        P.pair("hatch_smoothing_value", T.number),
        P.pair("hatch_border_algorithm", T.string),
        P.pair("hatch_min_hole_area", T.number)
      )
    );
  }
  static {
    __name(this, "ZoneFill");
  }
};
var Layer = class {
  static {
    __name(this, "Layer");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.positional("ordinal", T.number),
        P.positional("canonical_name", T.string),
        P.positional("type", T.string),
        P.positional("user_name", T.string)
      )
    );
  }
};
var Setup = class {
  constructor(expr) {
    this.allow_soldermask_bridges_in_footprints = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("setup"),
        P.pair("pad_to_mask_clearance", T.number),
        P.pair("solder_mask_min_width", T.number),
        P.pair("pad_to_paste_clearance", T.number),
        P.pair("pad_to_paste_clearance_ratio", T.number),
        P.pair("allow_soldermask_bridges_in_footprints", T.boolean),
        P.vec2("aux_axis_origin"),
        P.vec2("grid_origin"),
        P.item("pcbplotparams", PCBPlotParams),
        P.item("stackup", Stackup)
      )
    );
  }
  static {
    __name(this, "Setup");
  }
};
var PCBPlotParams = class {
  constructor(expr) {
    this.disableapertmacros = false;
    this.usegerberextensions = false;
    this.usegerberattributes = false;
    this.usegerberadvancedattributes = false;
    this.creategerberjobfile = false;
    this.svguseinch = false;
    this.excludeedgelayer = false;
    this.plotframeref = false;
    this.viasonmask = false;
    this.useauxorigin = false;
    this.pdf_front_fp_property_popups = true;
    this.pdf_back_fp_property_popups = true;
    this.pdf_metadata = true;
    this.pdf_single_document = false;
    this.dxfpolygonmode = false;
    this.dxfimperialunits = false;
    this.dxfusepcbnewfont = false;
    this.psnegative = false;
    this.psa4output = false;
    this.plotreference = false;
    this.plotvalue = false;
    this.plotinvisibletext = false;
    this.sketchpadsonfab = false;
    this.subtractmaskfromsilk = false;
    this.plot_black_and_white = true;
    this.plotpadnumbers = false;
    this.hidednponfab = false;
    this.sketchdnponfab = true;
    this.crossoutdnponfab = true;
    this.mirror = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("pcbplotparams"),
        P.pair("layerselection", T.number),
        P.pair("disableapertmacros", T.boolean),
        P.pair("usegerberextensions", T.boolean),
        P.pair("usegerberattributes", T.boolean),
        P.pair("usegerberadvancedattributes", T.boolean),
        P.pair("creategerberjobfile", T.boolean),
        P.pair("gerberprecision", T.number),
        P.pair("svguseinch", T.boolean),
        P.pair("svgprecision", T.number),
        P.pair("excludeedgelayer", T.boolean),
        P.pair("plotframeref", T.boolean),
        P.pair("viasonmask", T.boolean),
        P.pair("mode", T.number),
        P.pair("useauxorigin", T.boolean),
        P.pair("hpglpennumber", T.number),
        P.pair("hpglpenspeed", T.number),
        P.pair("hpglpendiameter", T.number),
        P.pair("pdf_front_fp_property_popups", T.boolean),
        P.pair("pdf_back_fp_property_popups", T.boolean),
        P.pair("pdf_metadata", T.boolean),
        P.pair("pdf_single_document", T.boolean),
        P.pair("dxfpolygonmode", T.boolean),
        P.pair("dxfimperialunits", T.boolean),
        P.pair("dxfusepcbnewfont", T.boolean),
        P.pair("psnegative", T.boolean),
        P.pair("psa4output", T.boolean),
        P.pair("plotreference", T.boolean),
        P.pair("plotvalue", T.boolean),
        P.pair("plotinvisibletext", T.boolean),
        P.pair("sketchpadsonfab", T.boolean),
        P.pair("subtractmaskfromsilk", T.boolean),
        P.pair("plotpadnumbers", T.boolean),
        P.pair("plot_black_and_white", T.boolean),
        P.pair("hidednponfab", T.boolean),
        P.pair("sketchdnponfab", T.boolean),
        P.pair("crossoutdnponfab", T.boolean),
        P.pair("outputformat", T.number),
        P.pair("mirror", T.boolean),
        P.pair("drillshape", T.number),
        P.pair("scaleselection", T.number),
        P.pair("outputdirectory", T.string),
        P.pair("plot_on_all_layers_selection", T.number),
        P.pair("dashed_line_dash_ratio", T.number),
        P.pair("dashed_line_gap_ratio", T.number)
      )
    );
  }
  static {
    __name(this, "PCBPlotParams");
  }
};
var Stackup = class {
  constructor(expr) {
    this.dielectric_constraints = false;
    this.castellated_pads = false;
    this.edge_plating = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("stackup"),
        P.pair("copper_finish", T.string),
        P.pair("dielectric_constraints", T.boolean),
        P.pair("edge_connector", T.string),
        P.pair("castellated_pads", T.boolean),
        P.pair("edge_plating", T.boolean),
        P.collection("layers", "layer", T.item(StackupLayer))
      )
    );
  }
  static {
    __name(this, "Stackup");
  }
};
var StackupLayer = class {
  static {
    __name(this, "StackupLayer");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("layer"),
        P.positional("name", T.string),
        P.pair("type", T.string),
        P.pair("color", T.string),
        P.pair("thickness", T.number),
        P.pair("material", T.string),
        P.pair("epsilon_r", T.number),
        P.pair("loss_tangent", T.number)
      )
    );
  }
};
var Dimension = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("dimension"),
        P.atom("locked"),
        P.pair("type", T.string),
        P.pair("layer", T.string),
        P.pair("tstamp", T.string),
        P.pair("uuid", T.string),
        P.list("pts", T.vec2),
        P.pair("height", T.number),
        P.pair("orientation", T.number),
        P.pair("leader_length", T.number),
        P.item("gr_text", GrText, this),
        P.item("format", DimensionFormat),
        P.item("style", DimensionStyle)
      )
    );
  }
  static {
    __name(this, "Dimension");
  }
  resolve_text_var(name) {
    return this.parent.resolve_text_var(name);
  }
  get start() {
    return this.pts.at(0) ?? new Vec2(0, 0);
  }
  get end() {
    return this.pts.at(-1) ?? new Vec2(0, 0);
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
};
var DimensionFormat = class {
  constructor(expr) {
    this.suppress_zeroes = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("format"),
        P.pair("prefix", T.string),
        P.pair("suffix", T.string),
        P.pair("units", T.number),
        P.pair("units_format", T.number),
        P.pair("precision", T.number),
        P.pair("override_value", T.string),
        P.atom("suppress_zeroes")
      )
    );
  }
  static {
    __name(this, "DimensionFormat");
  }
};
var DimensionStyle = class {
  static {
    __name(this, "DimensionStyle");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("style"),
        P.pair("thickness", T.number),
        P.pair("arrow_length", T.number),
        P.pair("text_position_mode", T.number),
        P.pair("extension_height", T.number),
        P.pair("text_frame", T.number),
        P.pair("extension_offset", T.number),
        P.atom("keep_text_aligned")
      )
    );
  }
};
var Footprint = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.locked = false;
    this.placed = false;
    this.attr = {
      through_hole: false,
      smd: false,
      virtual: false,
      board_only: false,
      exclude_from_pos_files: false,
      exclude_from_bom: false,
      allow_solder_mask_bridges: false,
      allow_missing_courtyard: false
    };
    this.properties = {};
    this.drawings = [];
    this.pads = [];
    this.#pads_by_number = /* @__PURE__ */ new Map();
    this.zones = [];
    this.models = [];
    this.embedded_fonts = false;
    this.embedded_files = [];
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("footprint"),
        P.positional("library_link", T.string),
        P.pair("version", T.number),
        P.pair("generator", T.string),
        P.atom("locked"),
        P.atom("placed"),
        P.pair("layer", T.string),
        P.pair("tedit", T.string),
        P.pair("tstamp", T.string),
        P.pair("uuid", T.string),
        P.pair("sheetname", T.string),
        P.pair("sheetfile", T.string),
        P.item("at", At),
        P.pair("descr", T.string),
        P.pair("tags", T.string),
        P.pair("path", T.string),
        P.pair("autoplace_cost90", T.number),
        P.pair("autoplace_cost180", T.number),
        P.pair("solder_mask_margin", T.number),
        P.pair("solder_paste_margin", T.number),
        P.pair("solder_paste_ratio", T.number),
        P.pair("clearance", T.number),
        P.pair("zone_connect", T.number),
        P.pair("thermal_width", T.number),
        P.pair("thermal_gap", T.number),
        P.pair("net_tie_pad_groups", T.string),
        P.object(
          "attr",
          this.attr,
          P.atom("through_hole"),
          P.atom("smd"),
          P.atom("virtual"),
          P.atom("board_only"),
          P.atom("exclude_from_pos_files"),
          P.atom("exclude_from_bom"),
          P.atom("allow_solder_mask_bridges"),
          P.atom("allow_missing_courtyard")
        ),
        P.dict("properties", "property", T.item(SymbolProperty, this)),
        P.collection("drawings", "fp_line", T.item(FpLine, this)),
        P.collection("drawings", "fp_circle", T.item(FpCircle, this)),
        P.collection("drawings", "fp_arc", T.item(FpArc, this)),
        P.collection("drawings", "fp_poly", T.item(FpPoly, this)),
        P.collection("drawings", "fp_rect", T.item(FpRect, this)),
        P.collection("drawings", "fp_text", T.item(FpText, this)),
        P.collection("zones", "zone", T.item(Zone, this)),
        P.collection("models", "model", T.item(Model)),
        P.collection("pads", "pad", T.item(Pad, this)),
        P.pair("embedded_fonts", T.boolean),
        P.list("embedded_files", T.item(EmbeddedFile))
      )
    );
    for (const pad of this.pads) {
      this.#pads_by_number.set(pad.number, pad);
    }
    for (const d of this.drawings) {
      if (!(d instanceof FpText)) {
        continue;
      }
      if (d.type == "reference") {
        this.reference = d.text;
      }
      if (d.type == "value") {
        this.value = d.text;
      }
    }
    for (const [prop_name, prop] of Object.entries(this.properties)) {
      if (this.reference === void 0 && prop_name == "Reference") {
        this.reference = prop.value;
      }
      if (this.value === void 0 && prop_name == "Value") {
        this.value = prop.value;
      }
    }
  }
  static {
    __name(this, "Footprint");
  }
  #pads_by_number;
  #bbox;
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
  *items() {
    yield* this.drawings ?? [];
    yield* this.zones ?? [];
    yield* this.pads.values() ?? [];
    yield* Object.values(this.properties).filter(
      (prop) => prop.has_symbol_prop
    );
  }
  resolve_text_var(name) {
    switch (name) {
      case "REFERENCE":
        return this.reference;
      case "VALUE":
        return this.value;
      case "LAYER":
        return this.layer;
      case "FOOTPRINT_LIBRARY":
        return this.library_link.split(":").at(0);
      case "FOOTPRINT_NAME":
        return this.library_link.split(":").at(-1);
    }
    const pad_expr = /^(NET_NAME|NET_CLASS|PIN_NAME)\(.+?\)$/.exec(name);
    if (pad_expr?.length == 3) {
      const [_, expr_type, pad_name] = pad_expr;
      switch (expr_type) {
        case "NET_NAME":
          return this.pad_by_number(pad_name)?.net.number.toString();
        case "NET_CLASS":
          return this.pad_by_number(pad_name)?.net.name;
        case "PIN_NAME":
          return this.pad_by_number(pad_name)?.pinfunction;
      }
    }
    if (this.properties[name] !== void 0) {
      return this.properties[name].value;
    }
    return this.parent.resolve_text_var(name);
  }
  pad_by_number(number) {
    return this.#pads_by_number.get(number);
  }
  /**
   * Get the nominal bounding box for this footprint.
   *
   * This does not take into account text drawings.
   */
  get bbox() {
    if (!this.#bbox) {
      let bbox = new BBox(
        this.at.position.x - 0.25,
        this.at.position.y - 0.25,
        0.5,
        0.5
      );
      const matrix = Matrix3.translation(
        this.at.position.x,
        this.at.position.y
      ).rotate_self(Angle.deg_to_rad(this.at.rotation));
      for (const item of this.drawings) {
        if (item instanceof FpText || item instanceof SymbolProperty) {
          continue;
        }
        bbox = BBox.combine([bbox, item.bbox.transform(matrix)]);
      }
      bbox.context = this;
      this.#bbox = bbox;
    }
    return this.#bbox;
  }
};
var SymbolProperty = class {
  constructor(expr, parent) {
    this.parent = parent;
    // symbol properties
    // https://dev-docs.kicad.org/en/file-formats/sexpr-intro/index.html#_symbol_properties
    this.id = 0;
    this.unlocked = false;
    this.hide = false;
    this.at = new At();
    this.effects = new Effects();
    this.layer = "F.SilkS";
    const is_newer = expr instanceof Array && expr.length > 3;
    if (is_newer) {
      this.has_symbol_prop = true;
      Object.assign(
        this,
        parse_expr(
          expr,
          P.positional("value", T.string),
          P.pair("id", T.number),
          P.item("at", At),
          P.pair("layer", T.string),
          P.pair("uuid", T.string),
          P.atom("unlocked"),
          P.atom("hide"),
          P.item("effects", Effects)
        )
      );
    } else {
      this.has_symbol_prop = false;
      Object.assign(
        this,
        parse_expr(expr, P.positional("value", T.string))
      );
    }
  }
  static {
    __name(this, "SymbolProperty");
  }
  get shown_text() {
    return expand_text_vars(this.value, this.parent);
  }
  get unique_id() {
    return this.uuid;
  }
};
var GraphicItem = class {
  constructor() {
    this.locked = false;
    this.stroke = Stroke.default_value();
  }
  static {
    __name(this, "GraphicItem");
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
  get stroke_params() {
    let pcb = void 0;
    if (this.parent instanceof KicadPCB) {
      pcb = this.parent;
    } else if (this.parent instanceof Footprint) {
      pcb = this.parent.parent;
    }
    const plot_cfg = pcb?.setup?.pcbplotparams;
    return {
      stroke: this.stroke,
      dashed_line_gap_ratio: plot_cfg?.dashed_line_gap_ratio ?? 3,
      dashed_line_dash_ratio: plot_cfg?.dashed_line_dash_ratio ?? 12
    };
  }
  /**
   * Get the nominal bounding box for the item. This does not include any
   * stroke or other expansion.
   */
  get bbox() {
    return new BBox(0, 0, 0, 0);
  }
};
var Line = class extends GraphicItem {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    const static_this = this.constructor;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start(static_this.expr_start),
        P.atom("locked"),
        P.pair("layer", T.string),
        P.vec2("start"),
        P.vec2("end"),
        P.pair("width", T.number),
        P.pair("uuid", T.string),
        P.pair("tstamp", T.string),
        P.item("stroke", Stroke)
      )
    );
    this.width ??= this.stroke?.width || 0;
  }
  static {
    __name(this, "Line");
  }
  static {
    this.expr_start = "unset";
  }
  get bbox() {
    return BBox.from_points([this.start, this.end]);
  }
};
var GrLine = class extends Line {
  static {
    __name(this, "GrLine");
  }
  static {
    this.expr_start = "gr_line";
  }
};
var FpLine = class extends Line {
  static {
    __name(this, "FpLine");
  }
  static {
    this.expr_start = "fp_line";
  }
};
var Circle = class extends GraphicItem {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    const static_this = this.constructor;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start(static_this.expr_start),
        P.atom("locked"),
        P.vec2("center"),
        P.vec2("end"),
        P.pair("width", T.number),
        P.pair("fill", T.string),
        P.pair("layer", T.string),
        P.pair("uuid", T.string),
        P.pair("tstamp", T.string),
        P.item("stroke", Stroke)
      )
    );
    this.width ??= this.stroke?.width || 0;
  }
  static {
    __name(this, "Circle");
  }
  static {
    this.expr_start = "unset";
  }
  get bbox() {
    const radius = this.center.sub(this.end).magnitude;
    const radial = new Vec2(radius, radius);
    return BBox.from_points([
      this.center.sub(radial),
      this.center.add(radial)
    ]);
  }
};
var GrCircle = class extends Circle {
  static {
    __name(this, "GrCircle");
  }
  static {
    this.expr_start = "gr_circle";
  }
};
var FpCircle = class extends Circle {
  static {
    __name(this, "FpCircle");
  }
  static {
    this.expr_start = "fp_circle";
  }
};
var Arc2 = class extends GraphicItem {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    const static_this = this.constructor;
    const parsed = parse_expr(
      expr,
      P.start(static_this.expr_start),
      P.atom("locked"),
      P.pair("layer", T.string),
      P.vec2("start"),
      P.vec2("mid"),
      P.vec2("end"),
      P.pair("angle", T.number),
      P.pair("width", T.number),
      P.pair("uuid", T.string),
      P.pair("tstamp", T.string),
      P.item("stroke", Stroke)
    );
    if (parsed["angle"] !== void 0) {
      const angle = Angle.from_degrees(parsed["angle"]).normalize720();
      const center = parsed["start"];
      let start = parsed["end"];
      let end = angle.negative().rotate_point(start, center);
      if (angle.degrees < 0) {
        [start, end] = [end, start];
      }
      this.#arc = Arc.from_center_start_end(
        center,
        start,
        end,
        parsed["width"]
      );
      parsed["start"] = this.#arc.start_point;
      parsed["mid"] = this.#arc.mid_point;
      parsed["end"] = this.#arc.end_point;
      delete parsed["angle"];
    } else {
      this.#arc = Arc.from_three_points(
        parsed["start"],
        parsed["mid"],
        parsed["end"],
        parsed["width"]
      );
    }
    Object.assign(this, parsed);
    this.width ??= this.stroke?.width ?? this.#arc.width;
    this.#arc.width = this.width;
  }
  static {
    __name(this, "Arc");
  }
  static {
    this.expr_start = "unset";
  }
  #arc;
  get arc() {
    return this.#arc;
  }
  get bbox() {
    return this.arc.bbox;
  }
};
var GrArc = class extends Arc2 {
  static {
    __name(this, "GrArc");
  }
  static {
    this.expr_start = "gr_arc";
  }
};
var FpArc = class extends Arc2 {
  static {
    __name(this, "FpArc");
  }
  static {
    this.expr_start = "fp_arc";
  }
};
var PolyArc = class {
  static {
    __name(this, "PolyArc");
  }
  #arc;
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("arc"),
        P.vec2("start"),
        P.vec2("mid"),
        P.vec2("end")
      )
    );
    this.#arc = Arc.from_three_points(this.start, this.mid, this.end);
  }
  get arc() {
    return this.#arc;
  }
  get bbox() {
    return this.#arc.bbox;
  }
};
var Poly = class extends GraphicItem {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    const static_this = this.constructor;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start(static_this.expr_start),
        P.atom("locked"),
        P.pair("layer", T.string),
        P.atom("island"),
        P.list(
          "pts",
          T.choice(["xy", T.vec2], ["arc", T.item(PolyArc)])
        ),
        P.pair("width", T.number),
        P.pair("fill", T.string),
        P.pair("uuid", T.string),
        P.pair("tstamp", T.string),
        P.item("stroke", Stroke)
      )
    );
    this.width ??= this.stroke?.width || 0;
    this.#polyline_pts = this.pts.flatMap((pt) => {
      if (pt instanceof Vec2) {
        return [pt];
      } else {
        return pt.arc.to_polyline();
      }
    });
  }
  static {
    __name(this, "Poly");
  }
  static {
    this.expr_start = "polygon";
  }
  #polyline_pts;
  get polyline() {
    return this.#polyline_pts;
  }
  get bbox() {
    return BBox.from_points(this.#polyline_pts);
  }
};
var FilledPolygon = class extends Poly {
  static {
    __name(this, "FilledPolygon");
  }
  static {
    this.expr_start = "filled_polygon";
  }
};
var GrPoly = class extends Poly {
  static {
    __name(this, "GrPoly");
  }
  static {
    this.expr_start = "gr_poly";
  }
};
var FpPoly = class extends Poly {
  static {
    __name(this, "FpPoly");
  }
  static {
    this.expr_start = "fp_poly";
  }
};
var Rect = class extends GraphicItem {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    const static_this = this.constructor;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start(static_this.expr_start),
        P.atom("locked"),
        P.vec2("start"),
        P.vec2("end"),
        P.pair("layer", T.string),
        P.pair("width", T.number),
        P.pair("fill", T.string),
        P.pair("uuid", T.string),
        P.pair("tstamp", T.string),
        P.item("stroke", Stroke)
      )
    );
    this.width ??= this.stroke?.width || 0;
  }
  static {
    __name(this, "Rect");
  }
  static {
    this.expr_start = "rect";
  }
  get bbox() {
    return BBox.from_points([this.start, this.end]);
  }
};
var GrRect = class extends Rect {
  static {
    __name(this, "GrRect");
  }
  static {
    this.expr_start = "gr_rect";
  }
};
var FpRect = class extends Rect {
  static {
    __name(this, "FpRect");
  }
  static {
    this.expr_start = "fp_rect";
  }
};
var TextRenderCache = class {
  static {
    __name(this, "TextRenderCache");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("render_cache"),
        P.positional("text", T.string),
        P.positional("angle", T.number),
        P.collection("polygons", "polygon", T.item(Poly))
      )
    );
    for (const poly of this.polygons) {
      poly.fill = "solid";
    }
  }
};
var Text2 = class {
  constructor() {
    this.unlocked = false;
    this.hide = false;
    this.effects = new Effects();
  }
  static {
    __name(this, "Text");
  }
  static {
    this.common_expr_defs = [
      P.item("at", At),
      P.atom("hide"),
      P.atom("unlocked"),
      P.object(
        "layer",
        {},
        P.positional("name", T.string),
        P.atom("knockout")
      ),
      P.pair("tstamp", T.string),
      P.pair("uuid", T.string),
      P.item("effects", Effects),
      P.item("render_cache", TextRenderCache)
    ];
  }
  get shown_text() {
    return expand_text_vars(this.text, this.parent);
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
};
var FpText = class extends Text2 {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("fp_text"),
        P.atom("locked"),
        P.positional("type", T.string),
        P.positional("text", T.string),
        ...Text2.common_expr_defs
      )
    );
  }
  static {
    __name(this, "FpText");
  }
};
var GrText = class extends Text2 {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("gr_text"),
        P.atom("locked"),
        P.positional("text", T.string),
        ...Text2.common_expr_defs
      )
    );
  }
  static {
    __name(this, "GrText");
  }
};
var Pad = class {
  constructor(expr, parent) {
    this.parent = parent;
    // I hate this
    this.type = "thru_hole";
    this.locked = false;
    this.remove_unused_layers = false;
    const parsed = parse_expr(
      expr,
      P.start("pad"),
      P.positional("number", T.string),
      P.positional("type", T.string),
      P.positional("shape", T.string),
      P.item("at", At),
      P.atom("locked"),
      P.vec2("size"),
      P.vec2("rect_delta"),
      P.list("layers", T.string),
      P.pair("roundrect_rratio", T.number),
      P.pair("chamfer_ratio", T.number),
      P.expr(
        "chamfer",
        T.object(
          {},
          P.atom("top_right"),
          P.atom("top_left"),
          P.atom("bottom_right"),
          P.atom("bottom_left")
        )
      ),
      P.pair("pinfunction", T.string),
      P.pair("pintype", T.string),
      P.pair("solder_mask_margin", T.number),
      P.pair("solder_paste_margin", T.number),
      P.pair("solder_paste_margin_ratio", T.number),
      P.pair("clearance", T.number),
      P.pair("thermal_width", T.number),
      P.pair("thermal_gap", T.number),
      P.pair("thermal_bridge_angle", T.number),
      P.pair("zone_connect", T.number),
      P.pair("tstamp", T.string),
      P.pair("uuid", T.string),
      P.pair("remove_unused_layers", T.boolean),
      P.item("drill", PadDrill),
      P.item("net", Net),
      P.item("options", PadOptions),
      P.expr("primitives", (obj, name, expr2) => {
        const parsed2 = parse_expr(
          expr2,
          P.start("primitives"),
          P.collection("items", "gr_line", T.item(GrLine, this)),
          P.collection("items", "gr_circle", T.item(GrCircle, this)),
          P.collection("items", "gr_arc", T.item(GrArc, this)),
          P.collection("items", "gr_rect", T.item(GrRect, this)),
          P.collection("items", "gr_poly", T.item(GrPoly, this))
        );
        return parsed2?.["items"];
      })
    );
    Object.assign(this, parsed);
  }
  static {
    __name(this, "Pad");
  }
  get unique_id() {
    return this.uuid ?? this.tstamp;
  }
  get netname() {
    return this.net?.name;
  }
};
var PadDrill = class {
  constructor(expr) {
    this.oval = false;
    this.diameter = 0;
    this.width = 0;
    this.offset = new Vec2(0, 0);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("drill"),
        P.atom("oval"),
        P.positional("diameter", T.number),
        P.positional("width", T.number),
        P.vec2("offset")
      )
    );
  }
  static {
    __name(this, "PadDrill");
  }
};
var PadOptions = class {
  static {
    __name(this, "PadOptions");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("options"),
        P.pair("clearance", T.string),
        P.pair("anchor", T.string)
      )
    );
  }
};
var Model = class {
  constructor(expr) {
    this.hide = false;
    this.opacity = 1;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("model"),
        P.positional("filename", T.string),
        P.atom("hide"),
        P.pair("opacity", T.number),
        P.object("offset", {}, P.list("xyz", T.number)),
        P.object("scale", {}, P.list("xyz", T.number)),
        P.object("rotate", {}, P.list("xyz", T.number))
      )
    );
  }
  static {
    __name(this, "Model");
  }
};
var Group = class {
  constructor(expr) {
    this.locked = false;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("group"),
        P.positional("name", T.string),
        P.atom("locked"),
        P.pair("id", T.string),
        P.pair("uuid", T.string),
        P.list("members", T.string)
      )
    );
  }
  static {
    __name(this, "Group");
  }
  get unique_id() {
    return this.uuid ?? this.id;
  }
};

// kicad/schematic.ts
var DefaultValues = {
  /* The size of the rectangle indicating an unconnected wire or label */
  dangling_symbol_size: 0.3048,
  // 12 mils
  /* The size of the rectangle indicating a connected, unselected wire end */
  unselected_end_size: 0.1016,
  // 4 mils
  pin_length: 2.54,
  // 100 mils
  pinsymbol_size: 0.635,
  // 25 mils
  pinnum_size: 1.27,
  // 50 mils
  pinname_size: 1.27,
  // 50 mils
  selection_thickness: 0.0762,
  // 3 mils
  line_width: 0.1524,
  // 6 mils
  wire_width: 0.1524,
  // 6 mils
  bus_width: 0.3048,
  // 12 mils
  noconnect_size: 1.2192,
  // 48 mils
  junction_diameter: 0.9144,
  // 36 mils
  target_pin_radius: 0.381,
  // 15 mils
  /* The default bus and wire entry size. */
  sch_entry_size: 2.54,
  // 100 mils
  text_size: 1.27,
  // 50 mils
  /* Ratio of the font height to the baseline of the text above the wire. */
  text_offset_ratio: 0.15,
  // unitless ratio
  /* Ratio of the font height to space around global labels */
  label_size_ratio: 0.375,
  // unitless ratio
  /* The offset of the pin name string from the end of the pin in mils. */
  pin_name_offset: 0.508
  // 20 mils
};
var KicadSch = class {
  constructor(filename, expr) {
    this.filename = filename;
    this.title_block = new TitleBlock();
    this.wires = [];
    this.buses = [];
    this.bus_entries = [];
    this.bus_aliases = [];
    this.junctions = [];
    this.net_labels = [];
    this.global_labels = [];
    this.hierarchical_labels = [];
    this.symbols = /* @__PURE__ */ new Map();
    this.no_connects = [];
    this.drawings = [];
    this.rule_areas = [];
    this.netclass_flags = [];
    this.images = [];
    this.sheets = [];
    this.embedded_fonts = false;
    this.embedded_files = [];
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("kicad_sch"),
        P.pair("version", T.number),
        P.pair("generator", T.string),
        P.pair("generator_version", T.string),
        P.pair("uuid", T.string),
        P.item("paper", Paper),
        P.item("title_block", TitleBlock),
        P.item("lib_symbols", LibSymbols, this),
        P.collection("wires", "wire", T.item(Wire)),
        P.collection("buses", "bus", T.item(Bus)),
        P.collection("bus_entries", "bus_entry", T.item(BusEntry)),
        P.collection("bus_aliases", "bus_alias", T.item(BusAlias)),
        P.collection("junctions", "junction", T.item(Junction)),
        P.collection("no_connects", "no_connect", T.item(NoConnect)),
        P.collection("net_labels", "label", T.item(NetLabel)),
        P.collection(
          "global_labels",
          "global_label",
          T.item(GlobalLabel, this)
        ),
        P.collection(
          "hierarchical_labels",
          "hierarchical_label",
          T.item(HierarchicalLabel, this)
        ),
        P.mapped_collection(
          "symbols",
          "symbol",
          (p) => p.uuid,
          T.item(SchematicSymbol, this)
        ),
        P.collection("drawings", "polyline", T.item(Polyline, this)),
        P.collection("drawings", "rectangle", T.item(Rectangle, this)),
        P.collection("drawings", "arc", T.item(Arc3, this)),
        P.collection("drawings", "text", T.item(Text3, this)),
        P.collection("drawings", "circle", T.item(Circle2, this)),
        P.collection("rule_areas", "rule_area", T.item(RuleArea, this)),
        P.collection(
          "netclass_flags",
          "netclass_flag",
          T.item(DirectiveLabel, this)
        ),
        P.collection("images", "image", T.item(Image)),
        P.item("sheet_instances", SheetInstances),
        P.item("symbol_instances", SymbolInstances),
        P.collection("sheets", "sheet", T.item(SchematicSheet, this)),
        P.pair("embedded_fonts", T.boolean),
        P.list("embedded_files", T.item(EmbeddedFile))
      )
    );
    this.update_hierarchical_data();
  }
  static {
    __name(this, "KicadSch");
  }
  update_hierarchical_data(path) {
    path ??= ``;
    const root_symbol_instances = this.project?.root_schematic_page?.document?.symbol_instances;
    const global_symbol_instances = this.symbol_instances;
    for (const s of this.symbols.values()) {
      const symbol_path = `${path}/${s.uuid}`;
      const instance_data = root_symbol_instances?.get(symbol_path) ?? global_symbol_instances?.get(symbol_path) ?? s.instances.get(path);
      if (!instance_data) {
        continue;
      }
      s.reference = instance_data.reference ?? s.reference;
      s.value = instance_data.value ?? s.value;
      s.footprint = instance_data.footprint ?? s.footprint;
      s.unit = instance_data.unit ?? s.unit;
    }
    const root_sheet_instances = this.project?.root_schematic_page?.document?.sheet_instances;
    const global_sheet_instances = this.sheet_instances;
    for (const s of this.sheets) {
      const sheet_path = `${path}/${s.uuid}`;
      const instance_data = root_sheet_instances?.get(sheet_path) ?? global_sheet_instances?.get(sheet_path) ?? s.instances.get(path);
      if (!instance_data) {
        continue;
      }
      s.page = instance_data.page;
      s.path = instance_data.path;
      if (!s.instances.size) {
        const inst = new SchematicSheetInstance();
        inst.page = instance_data.page;
        inst.path = instance_data.path;
        s.instances.set("", inst);
      }
    }
  }
  *items() {
    yield* this.wires;
    yield* this.buses;
    yield* this.bus_entries;
    yield* this.junctions;
    yield* this.net_labels;
    yield* this.global_labels;
    yield* this.netclass_flags;
    yield* this.hierarchical_labels;
    yield* this.no_connects;
    yield* this.symbols.values();
    yield* this.drawings;
    yield* this.rule_areas;
    yield* this.images;
    yield* this.sheets;
  }
  find_symbol(uuid_or_ref) {
    if (this.symbols.has(uuid_or_ref)) {
      return this.symbols.get(uuid_or_ref);
    }
    for (const sym of this.symbols.values()) {
      if (sym.uuid == uuid_or_ref || sym.reference == uuid_or_ref) {
        return sym;
      }
    }
    return null;
  }
  find_sheet(uuid) {
    for (const sheet of this.sheets) {
      if (sheet.uuid == uuid) {
        return sheet;
      }
    }
    return null;
  }
  resolve_text_var(name) {
    if (name == "FILENAME") {
      return this.filename;
    }
    if (name.includes(":")) {
      const [uuid, field_name] = name.split(":");
      const symbol = this.symbols.get(uuid);
      if (symbol) {
        return symbol.resolve_text_var(field_name);
      }
    }
    return this.title_block.resolve_text_var(name);
  }
};
var Fill = class {
  static {
    __name(this, "Fill");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("fill"),
        P.pair("type", T.string),
        P.color()
      )
    );
  }
};
var GraphicItem2 = class {
  constructor(parent) {
    this.private = false;
    this.parent = parent;
  }
  static {
    __name(this, "GraphicItem");
  }
  get stroke_params() {
    return {
      stroke: this.stroke ?? Stroke.default_value(),
      dashed_line_gap_ratio: 3,
      dashed_line_dash_ratio: 12
    };
  }
  static {
    this.common_expr_defs = [
      P.atom("private"),
      P.item("stroke", Stroke),
      P.item("fill", Fill),
      P.pair("uuid", T.string)
    ];
  }
};
var Wire = class {
  static {
    __name(this, "Wire");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("wire"),
        P.list("pts", T.vec2),
        P.item("stroke", Stroke),
        P.pair("uuid", T.string)
      )
    );
  }
};
var Bus = class {
  static {
    __name(this, "Bus");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("bus"),
        P.list("pts", T.vec2),
        P.item("stroke", Stroke),
        P.pair("uuid", T.string)
      )
    );
  }
};
var BusEntry = class {
  static {
    __name(this, "BusEntry");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("bus_entry"),
        P.item("at", At),
        P.vec2("size"),
        P.item("stroke", Stroke),
        P.pair("uuid", T.string)
      )
    );
  }
};
var BusAlias = class {
  constructor(expr) {
    this.members = [];
    Object.assign(
      this,
      parse_expr(expr, P.start("bus_alias"), P.list("members", T.string))
    );
  }
  static {
    __name(this, "BusAlias");
  }
};
var Junction = class {
  static {
    __name(this, "Junction");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("junction"),
        P.item("at", At),
        P.pair("diameter", T.number),
        P.color(),
        P.pair("uuid", T.string)
      )
    );
  }
};
var NoConnect = class {
  static {
    __name(this, "NoConnect");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("no_connect"),
        P.item("at", At),
        P.pair("uuid", T.string)
      )
    );
  }
};
var Arc3 = class extends GraphicItem2 {
  static {
    __name(this, "Arc");
  }
  constructor(expr, parent) {
    super(parent);
    const parsed = parse_expr(
      expr,
      P.start("arc"),
      P.vec2("start"),
      P.vec2("mid"),
      P.vec2("end"),
      P.object(
        "radius",
        {},
        P.start("radius"),
        P.vec2("at"),
        P.pair("length"),
        P.vec2("angles")
      ),
      ...GraphicItem2.common_expr_defs
    );
    if (parsed["radius"]?.["length"]) {
      const arc = Arc.from_center_start_end(
        parsed["radius"]["at"],
        parsed["end"],
        parsed["start"],
        1
      );
      if (arc.arc_angle.degrees > 180) {
        [arc.start_angle, arc.end_angle] = [
          arc.end_angle,
          arc.start_angle
        ];
      }
      parsed["start"] = arc.start_point;
      parsed["mid"] = arc.mid_point;
      parsed["end"] = arc.end_point;
    }
    delete parsed["radius"];
    Object.assign(this, parsed);
  }
};
var Bezier = class extends GraphicItem2 {
  static {
    __name(this, "Bezier");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("bezier"),
        P.list("pts", T.vec2),
        ...GraphicItem2.common_expr_defs
      )
    );
  }
  get start() {
    return this.pts[0];
  }
  get c1() {
    return this.pts[1];
  }
  get c2() {
    return this.pts[2];
  }
  get end() {
    return this.pts[3];
  }
};
var Circle2 = class extends GraphicItem2 {
  static {
    __name(this, "Circle");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("circle"),
        P.vec2("center"),
        P.pair("radius", T.number),
        ...GraphicItem2.common_expr_defs
      )
    );
  }
};
var Polyline = class extends GraphicItem2 {
  static {
    __name(this, "Polyline");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("polyline"),
        P.list("pts", T.vec2),
        ...GraphicItem2.common_expr_defs
      )
    );
  }
};
var Rectangle = class extends GraphicItem2 {
  static {
    __name(this, "Rectangle");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("rectangle"),
        P.vec2("start"),
        P.vec2("end"),
        ...GraphicItem2.common_expr_defs
      )
    );
  }
};
var Image = class {
  static {
    __name(this, "Image");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("image"),
        P.item("at", At),
        P.pair("data", T.string),
        P.pair("uuid", T.string)
      )
    );
  }
};
var Text3 = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.private = false;
    this.effects = new Effects();
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("text"),
        P.positional("text"),
        P.item("at", At),
        P.item("effects", Effects),
        P.pair("uuid", T.string)
      )
    );
    if (this.text.endsWith("\n")) {
      this.text = this.text.slice(0, this.text.length - 1);
    }
  }
  static {
    __name(this, "Text");
  }
  get shown_text() {
    return expand_text_vars(this.text, this.parent);
  }
};
var LibText = class extends Text3 {
  constructor(expr, parent) {
    super(expr, parent);
    this.parent = parent;
    if (parent instanceof LibSymbol || parent instanceof SchematicSymbol) {
      this.at.rotation /= 10;
    }
  }
  static {
    __name(this, "LibText");
  }
};
var TextBox = class extends GraphicItem2 {
  constructor(expr, parent) {
    super(parent);
    this.effects = new Effects();
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("text"),
        P.positional("text"),
        P.item("at", At),
        P.vec2("size"),
        P.item("effects", Effects),
        ...GraphicItem2.common_expr_defs
      )
    );
  }
  static {
    __name(this, "TextBox");
  }
};
var Label = class {
  constructor() {
    this.private = false;
    this.at = new At();
    this.effects = new Effects();
    this.fields_autoplaced = false;
  }
  static {
    __name(this, "Label");
  }
  static {
    this.common_expr_defs = [
      P.positional("text"),
      P.item("at", At),
      P.item("effects", Effects),
      P.atom("fields_autoplaced"),
      P.pair("uuid", T.string)
    ];
  }
  get shown_text() {
    return unescape_string(this.text);
  }
};
var NetLabel = class extends Label {
  static {
    __name(this, "NetLabel");
  }
  constructor(expr) {
    super();
    Object.assign(
      this,
      parse_expr(expr, P.start("label"), ...Label.common_expr_defs)
    );
  }
};
var GlobalLabel = class extends Label {
  constructor(expr) {
    super();
    this.shape = "input";
    this.properties = [];
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("global_label"),
        ...Label.common_expr_defs,
        P.pair("shape", T.string),
        P.collection("properties", "property", T.item(Property2))
      )
    );
  }
  static {
    __name(this, "GlobalLabel");
  }
};
var HierarchicalLabel = class extends Label {
  constructor(expr) {
    super();
    this.shape = "input";
    if (expr) {
      Object.assign(
        this,
        parse_expr(
          expr,
          P.start("hierarchical_label"),
          ...Label.common_expr_defs,
          P.pair("shape", T.string)
        )
      );
    }
  }
  static {
    __name(this, "HierarchicalLabel");
  }
};
var DirectiveLabel = class extends Label {
  constructor(expr, parent) {
    super();
    this.parent = parent;
    this.properties = [];
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("netclass_flag"),
        ...Label.common_expr_defs,
        P.pair("shape", T.string),
        P.pair("length", T.number),
        P.collection("properties", "property", T.item(Property2, this))
      )
    );
  }
  static {
    __name(this, "DirectiveLabel");
  }
};
var LibSymbols = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.symbols = [];
    this.#symbols_by_name = /* @__PURE__ */ new Map();
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("lib_symbols"),
        P.collection("symbols", "symbol", T.item(LibSymbol, parent))
      )
    );
    for (const symbol of this.symbols) {
      this.#symbols_by_name.set(symbol.name, symbol);
    }
  }
  static {
    __name(this, "LibSymbols");
  }
  #symbols_by_name;
  by_name(name) {
    return this.#symbols_by_name.get(name);
  }
};
var LibSymbol = class _LibSymbol {
  constructor(expr, parent) {
    this.parent = parent;
    this.power = false;
    this.pin_numbers = { hide: false };
    this.pin_names = {
      offset: DefaultValues.pin_name_offset,
      hide: false
    };
    this.in_bom = false;
    this.on_board = false;
    this.in_pos_files = true;
    this.exclude_from_sim = false;
    this.duplicate_pin_numbers_are_jumpers = false;
    this.properties = /* @__PURE__ */ new Map();
    this.children = [];
    this.drawings = [];
    this.pins = [];
    this.units = /* @__PURE__ */ new Map();
    this.embedded_fonts = false;
    this.embedded_files = [];
    this.#pins_by_number = /* @__PURE__ */ new Map();
    this.#properties_by_id = /* @__PURE__ */ new Map();
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("symbol"),
        P.positional("name"),
        P.atom("power"),
        P.object("pin_numbers", this.pin_numbers, P.atom("hide")),
        P.object(
          "pin_names",
          this.pin_names,
          P.pair("offset", T.number),
          P.atom("hide")
        ),
        P.pair("in_bom", T.boolean),
        P.pair("on_board", T.boolean),
        P.pair("in_pos_files", T.boolean),
        P.pair("duplicate_pin_numbers_are_jumpers", T.boolean),
        P.pair("exclude_from_sim", T.boolean),
        P.mapped_collection(
          "properties",
          "property",
          (p) => p.name,
          T.item(Property2, this)
        ),
        P.collection("pins", "pin", T.item(PinDefinition, this)),
        P.collection("children", "symbol", T.item(_LibSymbol, this)),
        P.collection("drawings", "arc", T.item(Arc3, this)),
        P.collection("drawings", "bezier", T.item(Bezier, this)),
        P.collection("drawings", "circle", T.item(Circle2, this)),
        P.collection("drawings", "polyline", T.item(Polyline, this)),
        P.collection("drawings", "rectangle", T.item(Rectangle, this)),
        P.collection("drawings", "text", T.item(LibText, this)),
        P.collection("drawings", "textbox", T.item(TextBox, this)),
        P.pair("embedded_fonts", T.boolean),
        P.collection("embedded_files", "file", T.item(EmbeddedFile))
      )
    );
    for (const pin of this.pins) {
      this.#pins_by_number.set(pin.number.text, pin);
    }
    for (const property of this.properties.values()) {
      this.#properties_by_id.set(property.id, property);
    }
    for (const child of this.children) {
      const unit_num = child.unit;
      if (unit_num !== null) {
        const list = this.units.get(unit_num) ?? [];
        list.push(child);
        this.units.set(unit_num, list);
      }
    }
  }
  static {
    __name(this, "LibSymbol");
  }
  #pins_by_number;
  #properties_by_id;
  get root() {
    if (this.parent instanceof _LibSymbol) {
      return this.parent.root;
    }
    return this;
  }
  has_pin(number) {
    return this.#pins_by_number.has(number);
  }
  pin_by_number(number, style = 1) {
    if (this.has_pin(number)) {
      return this.#pins_by_number.get(number);
    }
    for (const child of this.children) {
      if ((child.style == 0 || child.style == style) && child.has_pin(number)) {
        return child.pin_by_number(number);
      }
    }
    throw new Error(
      `No pin numbered ${number} on library symbol ${this.name}`
    );
  }
  has_property_with_id(id) {
    return this.#properties_by_id.has(id);
  }
  property_by_id(id) {
    if (this.#properties_by_id.has(id)) {
      return this.#properties_by_id.get(id);
    }
    for (const child of this.children) {
      if (child.has_property_with_id(id)) {
        return child.property_by_id(id);
      }
    }
    return null;
  }
  get library_name() {
    if (this.name.includes(":")) {
      return this.name.split(":").at(0);
    }
    return "";
  }
  get library_item_name() {
    if (this.name.includes(":")) {
      return this.name.split(":").at(1);
    }
    return "";
  }
  get unit_count() {
    let count = this.units.size;
    if (this.units.has(0)) {
      count -= 1;
    }
    return count;
  }
  get unit() {
    const parts = this.name.split("_");
    if (parts.length < 3) {
      return 0;
    }
    return parseInt(parts.at(-2), 10);
  }
  get style() {
    const parts = this.name.split("_");
    if (parts.length < 3) {
      return 0;
    }
    return parseInt(parts.at(-1), 10);
  }
  get description() {
    return this.properties.get("ki_description")?.text ?? "";
  }
  get keywords() {
    return this.properties.get("ki_keywords")?.text ?? "";
  }
  get footprint_filters() {
    return this.properties.get("ki_fp_filters")?.text ?? "";
  }
  get units_interchangable() {
    return this.properties.get("ki_locked")?.text ? false : true;
  }
  resolve_text_var(name) {
    return this.parent?.resolve_text_var(name);
  }
};
var Property2 = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.hide = false;
    this.show_name = false;
    this.do_not_autoplace = false;
    const parsed = parse_expr(
      expr,
      P.start("property"),
      P.positional("name", T.string),
      P.positional("text", T.string),
      P.pair("id", T.number),
      P.pair("hide", T.boolean),
      P.item("at", At),
      P.item("effects", Effects),
      P.atom("show_name"),
      P.atom("do_not_autoplace")
    );
    this.#effects = parsed["effects"];
    delete parsed["effects"];
    this.hide = this.hide || (this.#effects?.hide ?? false);
    Object.assign(this, parsed);
  }
  static {
    __name(this, "Property");
  }
  #effects;
  get effects() {
    if (this.#effects) {
      return this.#effects;
    } else if (this.parent instanceof SchematicSymbol) {
      this.#effects = new Effects();
    } else {
      warn(`Couldn't determine Effects for Property ${this.name}`);
    }
    return this.#effects;
  }
  set effects(e) {
    this.#effects = e;
  }
  get shown_text() {
    return expand_text_vars(this.text, this.parent);
  }
};
var PinDefinition = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.hide = false;
    this.name = {
      text: "",
      effects: new Effects()
    };
    this.number = {
      text: "",
      effects: new Effects()
    };
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("pin"),
        P.positional("type", T.string),
        P.positional("shape", T.string),
        P.atom("hide"),
        P.item("at", At),
        P.pair("length", T.number),
        P.object(
          "name",
          this.name,
          P.positional("text", T.string),
          P.item("effects", Effects)
        ),
        P.object(
          "number",
          this.number,
          P.positional("text", T.string),
          P.item("effects", Effects)
        ),
        P.collection("alternates", "alternate", T.item(PinAlternate))
      )
    );
  }
  static {
    __name(this, "PinDefinition");
  }
  get unit() {
    return this.parent.unit;
  }
};
var PinAlternate = class {
  static {
    __name(this, "PinAlternate");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("alternate"),
        P.positional("name"),
        P.positional("type", T.string),
        P.positional("shaped", T.string)
      )
    );
  }
};
var RuleArea = class {
  constructor(expr, parent) {
    this.parent = parent;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("rule_area"),
        P.item("polyline", Polyline)
      )
    );
  }
  static {
    __name(this, "RuleArea");
  }
};
var SchematicSymbol = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.in_bom = false;
    this.on_board = false;
    this.exclude_from_sim = false;
    this.dnp = false;
    this.fields_autoplaced = false;
    this.properties = /* @__PURE__ */ new Map();
    this.pins = [];
    this.instances = /* @__PURE__ */ new Map();
    const parsed = parse_expr(
      expr,
      P.start("symbol"),
      P.pair("lib_name", T.string),
      P.pair("lib_id", T.string),
      P.item("at", At),
      P.pair("mirror", T.string),
      P.pair("unit", T.number),
      P.pair("convert", T.number),
      P.pair("in_bom", T.boolean),
      P.pair("on_board", T.boolean),
      P.pair("exclude_from_sim", T.boolean),
      P.pair("dnp", T.boolean),
      P.atom("fields_autoplaced"),
      P.pair("uuid", T.string),
      P.mapped_collection(
        "properties",
        "property",
        (p) => p.name,
        T.item(Property2, this)
      ),
      P.collection("pins", "pin", T.item(PinInstance, this)),
      P.object(
        "default_instance",
        this.default_instance,
        P.pair("reference", T.string),
        P.pair("unit", T.string),
        P.pair("value", T.string),
        P.pair("footprint", T.string)
      ),
      // (instances
      //    (project "kit-dev-coldfire-xilinx_5213"
      //      (path "/f5d7a48d-4587-4550-a504-c505ca11d375" (reference "R111") (unit 1))))
      P.object(
        "instances",
        {},
        P.collection(
          "projects",
          "project",
          T.object(
            null,
            P.start("project"),
            P.positional("name", T.string),
            P.collection(
              "paths",
              "path",
              T.object(
                null,
                P.start("path"),
                P.positional("path"),
                P.pair("reference", T.string),
                P.pair("value", T.string),
                P.pair("unit", T.number),
                P.pair("footprint", T.string)
              )
            )
          )
        )
      )
    );
    const parsed_instances = parsed["instances"];
    delete parsed["instances"];
    Object.assign(this, parsed);
    for (const project of parsed_instances?.["projects"] ?? []) {
      for (const path of project?.["paths"] ?? []) {
        const inst = new SchematicSymbolInstance();
        inst.path = path["path"];
        inst.reference = path["reference"];
        inst.value = path["value"];
        inst.unit = path["unit"];
        inst.footprint = path["footprint"];
        this.instances.set(inst.path, inst);
      }
    }
    if (this.get_property_text("Value") == void 0) {
      this.set_property_text("Value", this.default_instance.value);
    }
    if (!this.get_property_text("Footprint") == void 0) {
      this.set_property_text(
        "Footprint",
        this.default_instance.footprint
      );
    }
  }
  static {
    __name(this, "SchematicSymbol");
  }
  get lib_symbol() {
    return this.parent.lib_symbols.by_name(this.lib_name ?? this.lib_id);
  }
  get_property_text(name) {
    return this.properties.get(name)?.text;
  }
  set_property_text(name, val) {
    const prop = this.properties.get(name);
    if (prop) {
      prop.text = val;
    }
  }
  get reference() {
    return this.get_property_text("Reference") ?? "?";
  }
  set reference(val) {
    this.set_property_text("Reference", val);
  }
  get value() {
    return this.get_property_text("Value") ?? "";
  }
  set value(val) {
    this.set_property_text("Value", val);
  }
  get footprint() {
    return this.get_property_text("Footprint") ?? "";
  }
  set footprint(val) {
    this.set_property_text("Footprint", val);
  }
  get unit_suffix() {
    if (!this.unit || this.lib_symbol.unit_count <= 1) {
      return "";
    }
    const A = "A".charCodeAt(0);
    let unit = this.unit;
    let suffix = "";
    do {
      const x = (unit - 1) % 26;
      suffix = String.fromCharCode(A + x) + suffix;
      unit = Math.trunc((unit - x) / 26);
    } while (unit > 0);
    return suffix;
  }
  get unit_pins() {
    return this.pins.filter((pin) => {
      if (this.unit && pin.unit && this.unit != pin.unit) {
        return false;
      }
      return true;
    });
  }
  resolve_text_var(name) {
    if (this.properties.has(name)) {
      return this.properties.get(name)?.shown_text;
    }
    switch (name) {
      case "REFERENCE":
        return this.reference;
      case "VALUE":
        return this.value;
      case "FOOTPRINT":
        return this.footprint;
      case "DATASHEET":
        return this.properties.get("Datasheet")?.name;
      case "FOOTPRINT_LIBRARY":
        return this.footprint.split(":").at(0);
      case "FOOTPRINT_NAME":
        return this.footprint.split(":").at(-1);
      case "UNIT":
        return this.unit_suffix;
      case "SYMBOL_LIBRARY":
        return this.lib_symbol.library_name;
      case "SYMBOL_NAME":
        return this.lib_symbol.library_item_name;
      case "SYMBOL_DESCRIPTION":
        return this.lib_symbol.description;
      case "SYMBOL_KEYWORDS":
        return this.lib_symbol.keywords;
      case "EXCLUDE_FROM_BOM":
        return this.in_bom ? "" : "Excluded from BOM";
      case "EXCLUDE_FROM_BOARD":
        return this.on_board ? "" : "Excluded from board";
      case "DNP":
        return this.dnp ? "DNP" : "";
    }
    return this.parent.resolve_text_var(name);
  }
};
var SchematicSymbolInstance = class {
  static {
    __name(this, "SchematicSymbolInstance");
  }
  constructor() {
  }
};
var PinInstance = class {
  constructor(expr, parent) {
    this.parent = parent;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("pin"),
        P.positional("number", T.string),
        P.pair("uuid", T.string),
        P.pair("alternate", T.string)
      )
    );
  }
  static {
    __name(this, "PinInstance");
  }
  get definition() {
    return this.parent.lib_symbol.pin_by_number(
      this.number,
      this.parent.convert
    );
  }
  get unit() {
    return this.definition.unit;
  }
};
var SheetInstances = class {
  constructor(expr) {
    this.sheet_instances = /* @__PURE__ */ new Map();
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("sheet_instances"),
        P.mapped_collection(
          "sheet_instances",
          "path",
          (obj) => obj.path,
          T.item(SheetInstance)
        )
      )
    );
  }
  static {
    __name(this, "SheetInstances");
  }
  get(key) {
    return this.sheet_instances.get(key);
  }
};
var SheetInstance = class {
  static {
    __name(this, "SheetInstance");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        // note: start is "path"
        P.start("path"),
        P.positional("path", T.string),
        P.pair("page", T.string)
      )
    );
  }
};
var SymbolInstances = class {
  constructor(expr) {
    this.symbol_instances = /* @__PURE__ */ new Map();
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("symbol_instances"),
        P.mapped_collection(
          "symbol_instances",
          "path",
          (obj) => obj.path,
          T.item(SymbolInstance)
        )
      )
    );
  }
  static {
    __name(this, "SymbolInstances");
  }
  get(key) {
    return this.symbol_instances.get(key);
  }
};
var SymbolInstance = class {
  static {
    __name(this, "SymbolInstance");
  }
  constructor(expr) {
    Object.assign(
      this,
      parse_expr(
        expr,
        // note: start is "path"
        P.start("path"),
        P.positional("path", T.string),
        P.pair("reference", T.string),
        P.pair("unit", T.number),
        P.pair("value", T.string),
        P.pair("footprint", T.string)
      )
    );
  }
};
var SchematicSheet = class {
  constructor(expr, parent) {
    this.parent = parent;
    this.properties = /* @__PURE__ */ new Map();
    this.pins = [];
    this.instances = /* @__PURE__ */ new Map();
    const parsed = parse_expr(
      expr,
      P.start("sheet"),
      P.item("at", At),
      P.vec2("size"),
      P.item("stroke", Stroke),
      P.item("fill", Fill),
      P.pair("fields_autoplaced", T.boolean),
      P.pair("uuid", T.string),
      P.mapped_collection(
        "properties",
        "property",
        (prop) => prop.name,
        T.item(Property2, this)
      ),
      P.collection("pins", "pin", T.item(SchematicSheetPin, this)),
      // (instances
      //   (project "kit-dev-coldfire-xilinx_5213"
      //     (path "/f5d7a48d-4587-4550-a504-c505ca11d375" (page "3"))))
      P.object(
        "instances",
        {},
        P.collection(
          "projects",
          "project",
          T.object(
            null,
            P.start("project"),
            P.positional("name", T.string),
            P.collection(
              "paths",
              "path",
              T.object(
                null,
                P.start("path"),
                P.positional("path"),
                P.pair("page", T.string)
              )
            )
          )
        )
      )
    );
    const parsed_instances = parsed["instances"];
    delete parsed["instances"];
    Object.assign(this, parsed);
    for (const project of parsed_instances?.["projects"] ?? []) {
      for (const path of project?.["paths"] ?? []) {
        const inst = new SchematicSheetInstance();
        inst.path = path["path"];
        inst.page = path["page"];
        this.instances.set(inst.path, inst);
      }
    }
  }
  static {
    __name(this, "SchematicSheet");
  }
  get_property_text(name) {
    return this.properties.get(name)?.text;
  }
  get sheetname() {
    return this.get_property_text("Sheetname") ?? this.get_property_text("Sheet name");
  }
  get sheetfile() {
    return this.get_property_text("Sheetfile") ?? this.get_property_text("Sheet file");
  }
  resolve_text_var(name) {
    return this.parent?.resolve_text_var(name);
  }
};
var SchematicSheetPin = class {
  constructor(expr, parent) {
    this.parent = parent;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("pin"),
        P.positional("name", T.string),
        P.positional("shape", T.string),
        P.item("at", At),
        P.item("effects", Effects),
        P.pair("uuid", T.string)
      )
    );
  }
  static {
    __name(this, "SchematicSheetPin");
  }
};
var SchematicSheetInstance = class {
  static {
    __name(this, "SchematicSheetInstance");
  }
};

// kicad/default_drawing_sheet.kicad_wks
var default_drawing_sheet_default = '(kicad_wks (version 20210606) (generator pl_editor)\n  (setup\n    (textsize 1.5 1.5) (linewidth 0.15) (textlinewidth 0.15)\n    (left_margin 10) (right_margin 10) (top_margin 10) (bottom_margin 10))\n  (rect (name "") (start 110 34) (end 2 2) (comment "rect around the title block"))\n  (rect (name "") (start 0 0 ltcorner) (end 0 0) (repeat 2) (incrx 2) (incry 2))\n  (line (name "") (start 50 2 ltcorner) (end 50 0 ltcorner) (repeat 30) (incrx 50))\n  (tbtext "1" (name "") (pos 25 1 ltcorner) (font (size 1.3 1.3)) (repeat 100) (incrx 50))\n  (line (name "") (start 50 2 lbcorner) (end 50 0 lbcorner) (repeat 30) (incrx 50))\n  (tbtext "1" (name "") (pos 25 1 lbcorner) (font (size 1.3 1.3)) (repeat 100) (incrx 50))\n  (line (name "") (start 0 50 ltcorner) (end 2 50 ltcorner) (repeat 30) (incry 50))\n  (tbtext "A" (name "") (pos 1 25 ltcorner) (font (size 1.3 1.3)) (justify center) (repeat 100) (incry 50))\n  (line (name "") (start 0 50 rtcorner) (end 2 50 rtcorner) (repeat 30) (incry 50))\n  (tbtext "A" (name "") (pos 1 25 rtcorner) (font (size 1.3 1.3)) (justify center) (repeat 100) (incry 50))\n  (tbtext "Date: ${ISSUE_DATE}" (name "") (pos 87 6.9))\n  (line (name "") (start 110 5.5) (end 2 5.5))\n  (tbtext "${KICAD_VERSION}" (name "") (pos 109 4.1) (comment "KiCad version"))\n  (line (name "") (start 110 8.5) (end 2 8.5))\n  (tbtext "Rev: ${REVISION}" (name "") (pos 24 6.9) (font bold))\n  (tbtext "Size: ${PAPER}" (name "") (pos 109 6.9) (comment "Paper format name"))\n  (tbtext "Id: ${#}/${##}" (name "") (pos 24 4.1) (comment "Sheet id"))\n  (line (name "") (start 110 12.5) (end 2 12.5))\n  (tbtext "Title: ${TITLE}" (name "") (pos 109 10.7) (font (size 2 2) bold italic))\n  (tbtext "File: ${FILENAME}" (name "") (pos 109 14.3))\n  (line (name "") (start 110 18.5) (end 2 18.5))\n  (tbtext "Sheet: ${SHEETPATH}" (name "") (pos 109 17))\n  (tbtext "${COMPANY}" (name "") (pos 109 20) (font bold) (comment "Company name"))\n  (tbtext "${COMMENT1}" (name "") (pos 109 23) (comment "Comment 0"))\n  (tbtext "${COMMENT2}" (name "") (pos 109 26) (comment "Comment 1"))\n  (tbtext "${COMMENT3}" (name "") (pos 109 29) (comment "Comment 2"))\n  (tbtext "${COMMENT4}" (name "") (pos 109 32) (comment "Comment 3"))\n  (line (name "") (start 90 8.5) (end 90 5.5))\n  (line (name "") (start 26 8.5) (end 26 2))\n)\n';

// kicad/drawing-sheet.ts
var DrawingSheet = class _DrawingSheet {
  constructor(expr) {
    this.setup = new Setup2();
    this.drawings = [];
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("kicad_wks"),
        P.pair("version", T.number),
        P.pair("generator", T.string),
        P.item("setup", Setup2),
        P.collection("drawings", "line", T.item(Line2, this)),
        P.collection("drawings", "rect", T.item(Rect2, this)),
        P.collection("drawings", "polygon", T.item(Polygon, this)),
        P.collection("drawings", "bitmap", T.item(Bitmap, this)),
        P.collection("drawings", "tbtext", T.item(TbText, this))
      )
    );
  }
  static {
    __name(this, "DrawingSheet");
  }
  static default() {
    return new _DrawingSheet(default_drawing_sheet_default);
  }
  *items() {
    yield new Rect2(
      `(rect (name "") (start ${-this.setup.left_margin} ${-this.setup.right_margin} ltcorner) (end ${-this.setup.right_margin} ${-this.setup.bottom_margin} rbcorner) (comment "page outline"))`,
      this
    );
    yield* this.drawings;
  }
  get paper() {
    return this.document?.paper;
  }
  get width() {
    return this.paper?.width ?? 297;
  }
  get height() {
    return this.paper?.height ?? 210;
  }
  get size() {
    return new Vec2(this.width, this.height);
  }
  get top_left() {
    return new Vec2(this.setup.left_margin, this.setup.top_margin);
  }
  get top_right() {
    return new Vec2(
      this.width - this.setup.right_margin,
      this.setup?.top_margin
    );
  }
  get bottom_right() {
    return new Vec2(
      this.width - this.setup.right_margin,
      this.height - this.setup.bottom_margin
    );
  }
  get bottom_left() {
    return new Vec2(
      this.setup.left_margin,
      this.height - this.setup.bottom_margin
    );
  }
  get margin_bbox() {
    return BBox.from_points([this.top_left, this.bottom_right]);
  }
  get page_bbox() {
    return BBox.from_corners(0, 0, this.width, this.height);
  }
  resolve_text_var(name) {
    switch (name) {
      case "PAPER":
        return this.paper?.size || "";
      // TODO: Mock values for now, should be provided by the project
      // when that's implemented.
      case "#":
        return "1";
      case "##":
        return "1";
      case "SHEETPATH":
        return "/";
      case "KICAD_VERSION":
        return "KiCanvas Alpha";
    }
    return this.document?.resolve_text_var(name);
  }
};
var Setup2 = class {
  constructor(expr) {
    this.linewidth = 0.15;
    this.textsize = new Vec2(1.5, 1.5);
    this.textlinewidth = 0.15;
    this.top_margin = 10;
    this.left_margin = 10;
    this.bottom_margin = 10;
    this.right_margin = 10;
    if (expr) {
      Object.assign(
        this,
        parse_expr(
          expr,
          P.start("setup"),
          P.pair("linewidth", T.number),
          P.vec2("textsize"),
          P.pair("textlinewidth", T.number),
          P.pair("top_margin", T.number),
          P.pair("left_margin", T.number),
          P.pair("bottom_margin", T.number),
          P.pair("right_margin", T.number)
        )
      );
    }
  }
  static {
    __name(this, "Setup");
  }
};
var Coordinate = class {
  constructor(expr) {
    this.position = new Vec2(0, 0);
    this.anchor = "rbcorner";
    const parsed = parse_expr(
      expr,
      P.positional("start_token"),
      P.positional("x", T.number),
      P.positional("y", T.number),
      P.positional("anchor", T.string)
    );
    this.position.x = parsed["x"];
    this.position.y = parsed["y"];
    this.anchor = parsed["anchor"] ?? this.anchor;
  }
  static {
    __name(this, "Coordinate");
  }
};
var DrawingSheetItem = class {
  constructor(parent) {
    this.repeat = 1;
    this.incry = 0;
    this.incrx = 0;
    this.parent = parent;
  }
  static {
    __name(this, "DrawingSheetItem");
  }
  static {
    this.common_expr_defs = [
      P.pair("name", T.string),
      P.pair("comment", T.string),
      P.pair("option", T.string),
      P.pair("repeat", T.number),
      P.pair("incrx", T.number),
      P.pair("incry", T.number),
      P.pair("linewidth", T.number)
    ];
  }
};
var Line2 = class extends DrawingSheetItem {
  static {
    __name(this, "Line");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("line"),
        P.item("start", Coordinate),
        P.item("end", Coordinate),
        ...DrawingSheetItem.common_expr_defs
      )
    );
  }
};
var Rect2 = class extends DrawingSheetItem {
  static {
    __name(this, "Rect");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("rect"),
        P.item("start", Coordinate),
        P.item("end", Coordinate),
        ...DrawingSheetItem.common_expr_defs
      )
    );
  }
};
var Polygon = class extends DrawingSheetItem {
  static {
    __name(this, "Polygon");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("polygon"),
        P.item("pos", Coordinate),
        P.pair("rotate", T.number),
        P.list("pts", T.vec2),
        ...DrawingSheetItem.common_expr_defs
      )
    );
  }
};
var Bitmap = class extends DrawingSheetItem {
  static {
    __name(this, "Bitmap");
  }
  constructor(expr, parent) {
    super(parent);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("bitmap"),
        P.item("pos", Coordinate),
        P.pair("scale", T.number),
        P.pair("pngdata", T.string),
        ...DrawingSheetItem.common_expr_defs
      )
    );
  }
};
var TbText = class extends DrawingSheetItem {
  constructor(expr, parent) {
    super(parent);
    this.incrlabel = 1;
    this.rotate = 0;
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("tbtext"),
        P.positional("text"),
        P.item("pos", Coordinate),
        P.pair("incrlabel", T.number),
        P.pair("maxlen", T.number),
        P.pair("maxheight", T.number),
        P.item("font", Font2),
        P.pair("rotate", T.number),
        P.pair("justify", T.string),
        ...DrawingSheetItem.common_expr_defs
      )
    );
  }
  static {
    __name(this, "TbText");
  }
  get shown_text() {
    return expand_text_vars(this.text, this.parent);
  }
};
var Font2 = class {
  constructor(expr) {
    this.color = Color.transparent_black;
    this.size = new Vec2(1.27, 1.27);
    Object.assign(
      this,
      parse_expr(
        expr,
        P.start("font"),
        P.pair("face", T.string),
        P.atom("bold"),
        P.atom("italic"),
        P.vec2("size"),
        P.pair("linewidth", T.number)
      )
    );
  }
  static {
    __name(this, "Font");
  }
};

// base/object.ts
function merge(dst, src) {
  if (src == null || src == void 0) {
    return;
  }
  for (const key of Object.keys(src)) {
    if (is_object(dst[key])) {
      merge(dst[key], src[key]);
    } else {
      dst[key] = src[key];
    }
  }
}
__name(merge, "merge");

// kicad/project-settings.ts
var ProjectSettings = class _ProjectSettings {
  constructor() {
    this.board = new BoardSettings();
    this.boards = [];
    this.libraries = { pinned_footprint_libs: [], pinned_symbol_libs: [] };
    this.meta = { filename: "unknown.kicad_pro", version: 1 };
    this.pcbnew = { page_layout_descr_file: "" };
    this.schematic = new SchematicSettings();
    this.sheets = [];
    this.text_variables = {};
  }
  static {
    __name(this, "ProjectSettings");
  }
  static load(src) {
    const project = new _ProjectSettings();
    merge(project, src);
    return project;
  }
};
var BoardSettings = class {
  constructor() {
    // board_design_settings.cpp
    this.design_settings = new BoardDesignSettings();
  }
  static {
    __name(this, "BoardSettings");
  }
};
var BoardDesignSettings = class {
  constructor() {
    this.defaults = new BoardDesignSettingsDefaults();
  }
  static {
    __name(this, "BoardDesignSettings");
  }
};
var BoardDesignSettingsDefaults = class {
  constructor() {
    this.board_outline_line_width = 0.1;
    this.copper_line_width = 0.2;
    this.copper_text_size_h = 1.5;
    this.copper_text_size_v = 1.5;
    this.copper_text_thickness = 0.3;
    this.other_line_width = 0.15;
    this.silk_line_width = 0.15;
    this.silk_text_size_h = 1;
    this.silk_text_size_v = 1;
    this.silk_text_thickness = 0.15;
  }
  static {
    __name(this, "BoardDesignSettingsDefaults");
  }
};
var SchematicSettings = class {
  constructor() {
    this.drawing = new SchematicDrawingSettings();
    this.meta = { version: 1 };
  }
  static {
    __name(this, "SchematicSettings");
  }
};
var SchematicDrawingSettings = class {
  constructor() {
    this.dashed_lines_dash_length_ratio = 12;
    this.dashed_lines_gap_length_ratio = 3;
    this.default_line_thickness = 6;
    this.default_text_size = 50;
    this.intersheets_ref_own_page = false;
    this.intersheets_ref_prefix = "";
    this.intersheets_ref_short = false;
    this.intersheets_ref_show = false;
    this.intersheets_ref_suffix = "";
    this.junction_size_choice = 3;
    this.label_size_ratio = 0.375;
    this.pin_symbol_size = 25;
    this.text_offset_ratio = 0.15;
  }
  static {
    __name(this, "SchematicDrawingSettings");
  }
};

// kicanvas/project.ts
var log2 = new Logger("kicanvas:project");
var Project = class extends EventTarget {
  constructor() {
    super(...arguments);
    this.#files_by_name = /* @__PURE__ */ new Map();
    this.#pages_by_path = /* @__PURE__ */ new Map();
    this.loaded = new Barrier();
    this.settings = new ProjectSettings();
    this.#active_page = null;
  }
  static {
    __name(this, "Project");
  }
  #fs;
  #files_by_name;
  #pages_by_path;
  #root_schematic_page;
  dispose() {
    this.#files_by_name.clear();
    this.#pages_by_path.clear();
  }
  async load(fs) {
    log2.info(`Loading project from ${fs.constructor.name}`);
    this.settings = new ProjectSettings();
    this.#files_by_name.clear();
    this.#pages_by_path.clear();
    this.#fs = fs;
    const proj_promises = [];
    for (const filename of this.#fs.list()) {
      proj_promises.push(this.#load_file(filename));
    }
    await Promise.all(proj_promises);
    let load_new = true;
    const loaded_files = [];
    while (load_new) {
      load_new = false;
      const pending = [];
      for (const sch of this.schematics()) {
        const base_dir = dirname(sch.filename);
        for (const subsch of sch.sheets) {
          if (!subsch.sheetfile) {
            continue;
          }
          const new_file = normalize_join(base_dir, subsch.sheetfile);
          if (loaded_files.includes(new_file)) {
            continue;
          }
          load_new = true;
          loaded_files.push(new_file);
          if (await this.#fs.has(new_file)) {
            pending.push(this.#load_file(new_file));
          } else {
            log2.warn(`file "${new_file}" is not existed, skip it.`);
          }
        }
      }
      await Promise.all(pending);
    }
    this.#determine_schematic_hierarchy();
    this.loaded.open();
    this.dispatchEvent(
      new CustomEvent("load", {
        detail: this
      })
    );
  }
  async #load_file(filename) {
    log2.info(`Loading file ${filename}`);
    if (filename.endsWith(".kicad_sch")) {
      return await this.#load_doc(KicadSch, filename);
    }
    if (filename.endsWith(".kicad_pcb")) {
      return await this.#load_doc(KicadPCB, filename);
    }
    if (filename.endsWith(".kicad_pro")) {
      return this.#load_meta(filename);
    }
    log2.warn(`Couldn't load ${filename}: unknown file type`);
  }
  async #load_doc(document_class, filename) {
    if (this.#files_by_name.has(filename)) {
      return this.#files_by_name.get(filename);
    }
    const text = await this.#get_file_text(filename);
    const doc = new document_class(filename, text);
    doc.project = this;
    this.#files_by_name.set(filename, doc);
    if (doc instanceof KicadPCB) {
      const page = new ProjectPage(
        this,
        "pcb",
        doc.filename,
        "",
        "Board",
        ""
      );
      this.#pages_by_path.set(page.project_path, page);
    }
    return doc;
  }
  async #load_meta(filename) {
    const text = await this.#get_file_text(filename);
    const data = JSON.parse(text);
    this.settings = ProjectSettings.load(data);
  }
  async #get_file_text(filename) {
    return await (await this.#fs.get(filename)).text();
  }
  #determine_schematic_hierarchy() {
    log2.info("Determining schematic hierarchy");
    const paths_to_schematics = /* @__PURE__ */ new Map();
    const paths_to_sheet_instances = /* @__PURE__ */ new Map();
    for (const schematic of this.schematics()) {
      paths_to_schematics.set(`/${schematic.uuid}`, schematic);
      for (const sheet of schematic.sheets) {
        const sheet_sch = this.#files_by_name.get(
          sheet.sheetfile ?? ""
        );
        if (!sheet_sch) {
          continue;
        }
        for (const instance of sheet.instances.values()) {
          paths_to_schematics.set(instance.path, schematic);
          paths_to_sheet_instances.set(
            `${instance.path}/${sheet.uuid}`,
            {
              sheet,
              instance
            }
          );
        }
      }
    }
    const paths = Array.from(paths_to_sheet_instances.keys()).sort(
      (a, b) => a.length - b.length
    );
    let root;
    for (const path of paths) {
      const parent_path = path.split("/").slice(0, -1).join("/");
      if (!parent_path) {
        continue;
      }
      root = paths_to_schematics.get(parent_path);
      if (root) {
        break;
      }
    }
    let pages = [];
    if (root) {
      this.#root_schematic_page = new ProjectPage(
        this,
        "schematic",
        root.filename,
        `/${root.uuid}`,
        "Root",
        "1"
      );
      pages.push(this.#root_schematic_page);
      for (const [path, sheet] of paths_to_sheet_instances.entries()) {
        pages.push(
          new ProjectPage(
            this,
            "schematic",
            sheet.sheet.sheetfile,
            path,
            sheet.sheet.sheetname ?? sheet.sheet.sheetfile,
            sheet.instance.page ?? ""
          )
        );
      }
    }
    pages = sorted_by_numeric_strings(pages, (p) => p.page);
    for (const page of pages) {
      this.#pages_by_path.set(page.project_path, page);
    }
    const seen_schematic_files = new Set(
      map(this.#pages_by_path.values(), (p) => p.filename)
    );
    for (const schematic of this.schematics()) {
      if (!seen_schematic_files.has(schematic.filename)) {
        const page = new ProjectPage(
          this,
          "schematic",
          schematic.filename,
          `/${schematic.uuid}`,
          schematic.filename
        );
        this.#pages_by_path.set(page.project_path, page);
      }
    }
    this.#root_schematic_page = first(this.#pages_by_path.values());
    if (!this.#root_schematic_page) {
      log2.error("No vaild root schematic was found.");
    }
  }
  *files() {
    yield* this.#files_by_name.values();
  }
  file_by_name(name) {
    return this.#files_by_name.get(name);
  }
  *boards() {
    for (const value of this.#files_by_name.values()) {
      if (value instanceof KicadPCB) {
        yield value;
      }
    }
  }
  get has_boards() {
    return length(this.boards()) > 0;
  }
  *schematics() {
    for (const value of this.#files_by_name.values()) {
      if (value instanceof KicadSch) {
        yield value;
      }
    }
  }
  get has_schematics() {
    return length(this.schematics()) > 0;
  }
  *pages() {
    yield* this.#pages_by_path.values();
  }
  get first_page() {
    return first(this.pages());
  }
  get root_schematic_page() {
    return this.#root_schematic_page;
  }
  page_by_path(project_path) {
    return this.#pages_by_path.get(project_path);
  }
  async download(name) {
    if (this.#pages_by_path.has(name)) {
      name = this.#pages_by_path.get(name).filename;
    }
    return await this.#fs.download(name);
  }
  #active_page;
  get active_page() {
    return this.#active_page;
  }
  set_active_page(page_or_path) {
    let page;
    if (is_string(page_or_path)) {
      page = this.page_by_path(page_or_path);
    } else {
      page = page_or_path;
    }
    if (!page) {
      page = this.first_page;
    }
    if (!page) {
      throw new Error(`Unable to find ${page_or_path}`);
    }
    this.#active_page = page;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: this
      })
    );
  }
};
var ProjectPage = class {
  constructor(project, type, filename, sheet_path, name, page) {
    this.project = project;
    this.type = type;
    this.filename = filename;
    this.sheet_path = sheet_path;
    this.name = name;
    this.page = page;
  }
  static {
    __name(this, "ProjectPage");
  }
  /**
   * A unique identifier for this page within the project,
   * made from the filename and sheet path.
   */
  get project_path() {
    if (this.sheet_path) {
      return `${this.filename}:${this.sheet_path}`;
    } else {
      return this.filename;
    }
  }
  get document() {
    return this.project.file_by_name(this.filename);
  }
};

// kicanvas/services/api-error.ts
var BaseAPIError = class extends Error {
  constructor(name, url, description, response) {
    super(`API Error: ${name}: ${url}: ${description}`);
    this.name = name;
    this.url = url;
    this.description = description;
    this.response = response;
  }
  static {
    __name(this, "BaseAPIError");
  }
};
var UnknownError = class extends BaseAPIError {
  static {
    __name(this, "UnknownError");
  }
  constructor(url, description, response) {
    super(`UnknownError`, url, description, response);
  }
};
var NotFoundError = class extends BaseAPIError {
  static {
    __name(this, "NotFoundError");
  }
  constructor(url, response) {
    super(`NotFoundError`, url, "not found", response);
  }
};
var ForbiddenError = class extends BaseAPIError {
  static {
    __name(this, "ForbiddenError");
  }
  constructor(url, response) {
    super(`ForbiddenError`, url, "forbidden", response);
  }
};
async function request_error_handler(response) {
  switch (response.status) {
    case 200:
      return;
    case 403:
      throw new ForbiddenError(response.url, response);
    case 404:
      throw new NotFoundError(response.url, response);
    case 500:
      throw new UnknownError(
        response.url,
        await response.text(),
        response
      );
  }
}
__name(request_error_handler, "request_error_handler");

// kicanvas/services/github.ts
var GitHub = class _GitHub {
  static {
    __name(this, "GitHub");
  }
  static {
    this.host_name = "github.com";
  }
  static {
    this.html_base_url = "https://github.com";
  }
  static {
    this.base_url = "https://api.github.com/";
  }
  static {
    this.api_version = "2022-11-28";
  }
  static {
    this.accept_header = "application/vnd.github+json";
  }
  constructor() {
    this.headers = {
      Accept: _GitHub.accept_header,
      "X-GitHub-Api-Version": _GitHub.api_version
    };
  }
  /**
   * Parse an html (user-facing) URL
   */
  static parse_url(url) {
    url = new URL(url, _GitHub.html_base_url);
    if (url.hostname != _GitHub.host_name) {
      return null;
    }
    const path_parts = url.pathname.split("/").map((s) => decodeURI(s));
    if (path_parts.length < 3) {
      return null;
    }
    const [, owner, repo, ...parts] = path_parts;
    if (!owner || !repo) {
      return null;
    }
    let type;
    let ref;
    let path;
    if (parts.length) {
      if (parts[0] == "blob" || parts[0] == "tree") {
        type = parts.shift();
        ref = parts.shift();
        path = parts.join("/");
      }
    } else {
      type = "root";
    }
    if (!type) {
      return null;
    }
    return {
      owner,
      repo,
      type,
      ref,
      path
    };
  }
  async request(path, params, data) {
    const static_this = this.constructor;
    const url = new URL(path, static_this.base_url);
    if (params) {
      const url_params = new URLSearchParams(params).toString();
      url.search = `?${url_params}`;
    }
    const request = new Request(url, {
      method: data ? "POST" : "GET",
      headers: this.headers,
      body: data ? JSON.stringify(data) : void 0
    });
    const response = await fetch(request);
    await request_error_handler(response);
    this.last_response = response;
    this.rate_limit_remaining = parseInt(
      response.headers.get("x-ratelimit-remaining") ?? "",
      10
    );
    if (response.headers.get("content-type") == "application/json; charset=utf-8") {
      return await response.json();
    } else {
      return await response.text();
    }
  }
  async repos_contents(owner, repo, path, ref) {
    const result = await this.request(
      `repos/${owner}/${repo}/contents/${path}`,
      {
        ref: ref ?? ""
      }
    );
    return is_array(result) ? result : [result];
  }
};
var GitHubUserContent = class _GitHubUserContent {
  static {
    __name(this, "GitHubUserContent");
  }
  static {
    this.base_url = "https://raw.githubusercontent.com/";
  }
  constructor() {
  }
  async get(url_or_path) {
    const url = new URL(url_or_path, _GitHubUserContent.base_url);
    const request = new Request(url, { method: "GET" });
    const response = await fetch(request);
    const blob = await response.blob();
    const name = basename(url) ?? "unknown";
    return new File([blob], name);
  }
  /**
   * Converts GitHub UI paths to valid paths for raw.githubusercontent.com.
   *
   * https://github.com/wntrblm/Helium/blob/main/hardware/board/board.kicad_sch
   * becomes
   * https://raw.githubusercontent.com/wntrblm/Helium/main/hardware/board/board.kicad_sch
   */
  convert_url(url) {
    const u = new URL(url, "https://github.com/");
    if (u.host == "raw.githubusercontent.com") {
      return u;
    }
    const parts = u.pathname.split("/");
    if (parts.length < 4) {
      throw new Error(
        `URL ${url} can't be converted to a raw.githubusercontent.com URL`
      );
    }
    const [_, user, repo, blob, ref, ...path_parts] = parts;
    if (blob != "blob") {
      throw new Error(
        `URL ${url} can't be converted to a raw.githubusercontent.com URL`
      );
    }
    const path = [user, repo, ref, ...path_parts].join("/");
    return new URL(path, _GitHubUserContent.base_url);
  }
};

// kicanvas/services/github-vfs.ts
var gh_user_content = new GitHubUserContent();
var gh = new GitHub();
var GitHubFileSystem = class _GitHubFileSystem extends FileSystemBase {
  constructor(url, gh_repo, single_file = false) {
    super();
    this.gh_repo = gh_repo;
    this.single_file = single_file;
    this.download_urls = /* @__PURE__ */ new Map();
    if (single_file) {
      const guc_url = gh_user_content.convert_url(url);
      const name = basename(guc_url);
      this.download_urls.set(name, guc_url);
    }
  }
  static {
    __name(this, "GitHubFileSystem");
  }
  async load_file(path) {
    const download_url = this.download_urls.get(path);
    if (!download_url) {
      throw new Error(`File ${path} not found!`);
    }
    return await gh_user_content.get(download_url);
  }
  async enumerate(cur_dir) {
    if (this.single_file) {
      return Array.from(this.download_urls.keys()).map((v) => ({
        type: "file",
        path: v
      }));
    }
    const base_dir = this.gh_repo.path ?? "";
    const full_path = normalize_join(base_dir, cur_dir);
    const contents = await gh.repos_contents(
      this.gh_repo.owner,
      this.gh_repo.repo,
      full_path,
      this.gh_repo.ref
    );
    const result = [];
    for (const it of contents) {
      if (it.type === "file" && _GitHubFileSystem.is_kicad_file(it.name)) {
        const path = decodeURI(it.path);
        const file_path = based_on(base_dir, path);
        this.download_urls.set(file_path, new URL(it.download_url));
        result.push({
          type: "file",
          path: file_path
        });
      } else if (it.type === "dir") {
        const path = decodeURI(it.path);
        const dir_path = based_on(base_dir, path);
        result.push({
          type: "directory",
          path: dir_path
        });
      }
    }
    return result;
  }
  static async fromURLs(url) {
    const info = GitHub.parse_url(url);
    if (!info) {
      return null;
    }
    if (info.type == "root") {
      info.ref = "HEAD";
      info.type = "tree";
    }
    let single_file = false;
    if (info.type === "blob") {
      const ext_name = extension(info.path);
      if (["kicad_sch", "kicad_pcb"].includes(ext_name)) {
        single_file = true;
      } else {
        info.type = "tree";
        if (ext_name.length !== 0) {
          info.path = dirname(info.path);
        }
      }
    }
    return new _GitHubFileSystem(url, info, single_file);
  }
};

// base/base64.ts
var BaseDecodeError = class extends Error {
  static {
    __name(this, "BaseDecodeError");
  }
  constructor(message) {
    super(message);
  }
};
function base64_decode(str) {
  try {
    return atob(str);
  } catch (error) {
    throw new BaseDecodeError("Failed to decode base64 string: " + error);
  }
}
__name(base64_decode, "base64_decode");

// kicanvas/services/codeberg.ts
var Codeberg = class _Codeberg {
  static {
    __name(this, "Codeberg");
  }
  static {
    this.host_name = "codeberg.org";
  }
  static {
    this.html_base_url = "https://codeberg.org/";
  }
  static {
    this.base_url = "https://codeberg.org/api/v1/";
  }
  static {
    this.accept_header = "application/json";
  }
  static parse_url(url) {
    url = new URL(url, _Codeberg.html_base_url);
    if (url.hostname !== _Codeberg.host_name) {
      return null;
    }
    const path_parts = url.pathname.split("/").map((s) => decodeURI(s));
    if (path_parts.length < 3) {
      return null;
    }
    const [, owner, repo, ...parts] = path_parts;
    if (!owner || !repo) {
      return null;
    }
    let ref, path;
    if (parts.length > 0) {
      const typ = parts.shift();
      if (typ !== "src") {
        return null;
      }
      const ref_type = parts.shift();
      if (ref_type !== "commit" && ref_type !== "branch") {
        return null;
      }
      ref = parts.shift();
      if (!ref) {
        return null;
      }
      path = parts.join("/");
    } else {
      ref = "main";
      path = ".";
    }
    return {
      owner,
      repo,
      ref,
      path
    };
  }
  static async request(path, params, data) {
    const url = new URL(path, _Codeberg.base_url);
    if (params) {
      const url_params = new URLSearchParams(params).toString();
      url.search = `?${url_params}`;
    }
    const request = new Request(url, {
      method: data ? "POST" : "GET",
      headers: {
        Accept: _Codeberg.accept_header
      },
      body: data ? JSON.stringify(data) : void 0
    });
    const response = await fetch(request);
    await request_error_handler(response);
    return await response.text();
  }
  static async request_json(path, params, data) {
    const text = await _Codeberg.request(path, params, data);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("Failed to parse JSON response: " + error);
    }
  }
};

// kicanvas/services/codeberg-vfs.ts
var CodebergFileSystem = class _CodebergFileSystem extends FileSystemBase {
  constructor(repo) {
    super();
    this.repo = repo;
    this.download_urls = /* @__PURE__ */ new Map();
  }
  static {
    __name(this, "CodebergFileSystem");
  }
  async load_file(path) {
    const url = this.download_urls.get(path);
    if (!url) {
      throw new Error(`File ${path} not found.`);
    }
    const blob = await Codeberg.request_json(url.pathname);
    if (blob.content.length === 0) {
      throw new Error(`Blob returns empty when loading file ${path}`);
    }
    if (blob.encoding !== "base64") {
      throw new Error(`Unsupported encoding: ${blob.encoding}`);
    }
    const content = base64_decode(blob.content);
    const file = new File([content], path);
    return file;
  }
  async enumerate(cur_path) {
    const info = this.repo;
    const base_dir = info.path;
    const base_api = `repos/${info.owner}/${info.repo}/contents`;
    const api_url = normalize_join(base_api, base_dir, cur_path);
    let files = await Codeberg.request_json(api_url);
    if (!Array.isArray(files)) {
      files = [files];
    }
    const result = [];
    for (const it of files) {
      if (it.type === "file" && _CodebergFileSystem.is_kicad_file(it.name)) {
        const path = decodeURI(it.path);
        const file_path = based_on(base_dir, path);
        this.download_urls.set(file_path, new URL(it.git_url));
        result.push({
          type: "file",
          path: file_path
        });
      } else if (it.type === "dir") {
        const path = decodeURI(it.path);
        const dir_path = based_on(base_dir, path);
        result.push({
          type: "directory",
          path: dir_path
        });
      }
    }
    return result;
  }
  static async fromURLs(url) {
    const info = Codeberg.parse_url(url);
    if (!info) {
      return null;
    }
    return new _CodebergFileSystem(info);
  }
};

// base/web-components/flag-attribute.ts
function parseFlagAttribute(value, dst) {
  const value_parts = (value ?? "").split(" ");
  const flag_values = {};
  const flag_names = Object.getOwnPropertyNames(dst);
  for (const flag of flag_names) {
    flag_values[flag] = false;
    flag_values[`no${flag}`] = false;
  }
  for (const part of value_parts) {
    flag_values[part] = true;
  }
  const dst_as_record = dst;
  for (const flag of flag_names) {
    dst_as_record[flag] = ((flag_values[flag] || dst_as_record[flag]) && !flag_values[`no${flag}`]) ?? false;
  }
  return dst;
}
__name(parseFlagAttribute, "parseFlagAttribute");

// viewers/base/events.ts
var KiCanvasEvent = class extends CustomEvent {
  static {
    __name(this, "KiCanvasEvent");
  }
  constructor(name, detail, bubbles = false) {
    super(name, { detail, composed: true, bubbles });
  }
};
var KiCanvasLoadEvent = class _KiCanvasLoadEvent extends KiCanvasEvent {
  static {
    __name(this, "KiCanvasLoadEvent");
  }
  static {
    this.type = "kicanvas:load";
  }
  constructor() {
    super(_KiCanvasLoadEvent.type, null);
  }
};
var KiCanvasSelectEvent = class _KiCanvasSelectEvent extends KiCanvasEvent {
  static {
    __name(this, "KiCanvasSelectEvent");
  }
  static {
    this.type = "kicanvas:select";
  }
  constructor(detail) {
    super(_KiCanvasSelectEvent.type, detail, true);
  }
};
var KiCanvasMouseMoveEvent = class _KiCanvasMouseMoveEvent extends KiCanvasEvent {
  static {
    __name(this, "KiCanvasMouseMoveEvent");
  }
  static {
    this.type = "kicanvas:mousemove";
  }
  constructor(detail) {
    super(_KiCanvasMouseMoveEvent.type, detail, true);
  }
};

// graphics/shapes.ts
var Circle3 = class {
  /**
   * Create a filled circle
   * @param center - center of circle
   * @param radius - circle radius
   * @param color - fill color
   */
  constructor(center, radius, color) {
    this.center = center;
    this.radius = radius;
    this.color = color;
  }
  static {
    __name(this, "Circle");
  }
};
var Arc4 = class {
  /**
   * Create a stroked arc
   * @param center - center of arc circle
   * @param radius - arc circle radius
   * @param start_angle - arc start angle
   * @param end_angle - arc end angle
   * @param color - stroke color
   */
  constructor(center, radius, start_angle, end_angle, width, color) {
    this.center = center;
    this.radius = radius;
    this.start_angle = start_angle;
    this.end_angle = end_angle;
    this.width = width;
    this.color = color;
  }
  static {
    __name(this, "Arc");
  }
};
var Polyline2 = class _Polyline {
  /**
   * Create a stroked polyline
   * @param points - line segment points
   * @param width - thickness of the rendered lines
   * @param color - stroke color
   */
  constructor(points, width, color) {
    this.points = points;
    this.width = width;
    this.color = color;
  }
  static {
    __name(this, "Polyline");
  }
  /**
   * Create a rectangular outline from a bounding box.
   * @param bb
   * @param width - thickness of the rendered lines
   * @param color - fill color
   */
  static from_BBox(bb, width, color) {
    return new _Polyline(
      [
        bb.top_left,
        bb.top_right,
        bb.bottom_right,
        bb.bottom_left,
        bb.top_left
      ],
      width,
      color
    );
  }
};
var Polygon2 = class _Polygon {
  /**
   * Create a filled polygon
   * @param points - point cloud representing the polygon
   * @param color - fill color
   */
  constructor(points, color) {
    this.points = points;
    this.color = color;
  }
  static {
    __name(this, "Polygon");
  }
  /**
   * Create a filled polygon from a bounding box.
   * @param bb
   * @param color - fill color
   */
  static from_BBox(bb, color) {
    return new _Polygon(
      [bb.top_left, bb.top_right, bb.bottom_right, bb.bottom_left],
      color
    );
  }
};

// graphics/renderer.ts
var Renderer = class {
  constructor(canvas) {
    this.canvas_size = new Vec2(0, 0);
    this.state = new RenderStateStack();
    this.#background_color = Color.black.copy();
    this.canvas = canvas;
    this.background_color = this.#background_color;
  }
  static {
    __name(this, "Renderer");
  }
  #current_bbox;
  #background_color;
  get background_color() {
    return this.#background_color;
  }
  set background_color(color) {
    this.#background_color = color;
    this.canvas.style.backgroundColor = this.background_color.to_css();
  }
  /**
   * Start a new bbox for automatically tracking bounding boxes of drawn objects.
   */
  start_bbox() {
    this.#current_bbox = new BBox(0, 0, 0, 0);
  }
  /**
   * Adds a bbox to the current bbox.
   */
  add_bbox(bb) {
    if (!this.#current_bbox) {
      return;
    }
    this.#current_bbox = BBox.combine([this.#current_bbox, bb], bb.context);
  }
  /**
   * Stop adding drawing to the current bbox and return it.
   */
  end_bbox(context) {
    const bb = this.#current_bbox;
    if (bb == null) {
      throw new Error("No current bbox");
    }
    bb.context = context;
    this.#current_bbox = null;
    return bb;
  }
  prep_circle(circle_or_center, radius, color) {
    let circle;
    if (circle_or_center instanceof Circle3) {
      circle = circle_or_center;
    } else {
      circle = new Circle3(
        circle_or_center,
        radius,
        color ?? this.state.fill
      );
    }
    if (!circle.color || circle.color.is_transparent_black) {
      circle.color = this.state.fill ?? Color.transparent_black;
    }
    circle.center = this.state.matrix.transform(circle.center);
    const radial = new Vec2(circle.radius, circle.radius);
    this.add_bbox(
      BBox.from_points([
        circle.center.add(radial),
        circle.center.sub(radial)
      ])
    );
    return circle;
  }
  prep_arc(arc_or_center, radius, start_angle, end_angle, width, color) {
    let arc;
    if (arc_or_center instanceof Arc4) {
      arc = arc_or_center;
    } else {
      arc = new Arc4(
        arc_or_center,
        radius,
        start_angle ?? new Angle(0),
        end_angle ?? new Angle(Math.PI * 2),
        width ?? this.state.stroke_width,
        color ?? this.state.stroke
      );
    }
    if (!arc.color || arc.color.is_transparent_black) {
      arc.color = this.state.stroke ?? Color.transparent_black;
    }
    const math_arc = new Arc(
      arc.center,
      arc.radius,
      arc.start_angle,
      arc.end_angle,
      arc.width
    );
    const points = math_arc.to_polyline();
    this.line(new Polyline2(points, arc.width, arc.color));
    return arc;
  }
  prep_line(line_or_points, width, color) {
    let line;
    if (line_or_points instanceof Polyline2) {
      line = line_or_points;
    } else {
      line = new Polyline2(
        line_or_points,
        width ?? this.state.stroke_width,
        color ?? this.state.stroke
      );
    }
    if (!line.color || line.color.is_transparent_black) {
      line.color = this.state.stroke ?? Color.transparent_black;
    }
    line.points = Array.from(this.state.matrix.transform_all(line.points));
    let bbox = BBox.from_points(line.points);
    bbox = bbox.grow(line.width);
    this.add_bbox(bbox);
    return line;
  }
  prep_polygon(polygon_or_points, color) {
    let polygon;
    if (polygon_or_points instanceof Polygon2) {
      polygon = polygon_or_points;
    } else {
      polygon = new Polygon2(polygon_or_points, color ?? this.state.fill);
    }
    if (!polygon.color || polygon.color.is_transparent_black) {
      polygon.color = this.state.fill ?? Color.transparent_black;
    }
    polygon.points = Array.from(
      this.state.matrix.transform_all(polygon.points)
    );
    this.add_bbox(BBox.from_points(polygon.points));
    return polygon;
  }
  /** Draw a list of glyphs */
  glyphs(glyphs) {
  }
};
var RenderLayer = class {
  constructor(renderer, name) {
    this.renderer = renderer;
    this.name = name;
    this.composite_operation = "source-over";
  }
  static {
    __name(this, "RenderLayer");
  }
  dispose() {
    this.renderer.remove_layer(this);
  }
};
var RenderState = class _RenderState {
  constructor(matrix = Matrix3.identity(), fill = Color.black, stroke = Color.black, stroke_width = 0, flipped = false) {
    this.matrix = matrix;
    this.fill = fill;
    this.stroke = stroke;
    this.stroke_width = stroke_width;
    this.flipped = flipped;
  }
  static {
    __name(this, "RenderState");
  }
  copy() {
    return new _RenderState(
      this.matrix.copy(),
      this.fill?.copy(),
      this.stroke?.copy(),
      this.stroke_width,
      this.flipped
    );
  }
};
var RenderStateStack = class {
  static {
    __name(this, "RenderStateStack");
  }
  #stack;
  constructor() {
    this.#stack = [new RenderState()];
  }
  get top() {
    return this.#stack.at(-1);
  }
  /**
   * @returns the current transformation matrix
   */
  get matrix() {
    return this.top.matrix;
  }
  /**
   * Set the transformation matrix stack.
   */
  set matrix(mat) {
    this.top.matrix = mat;
  }
  get stroke() {
    return this.top.stroke;
  }
  set stroke(c) {
    this.top.stroke = c;
  }
  get fill() {
    return this.top.fill;
  }
  set fill(c) {
    this.top.fill = c;
  }
  get stroke_width() {
    return this.top.stroke_width;
  }
  set stroke_width(n) {
    this.top.stroke_width = n;
  }
  get flipped() {
    return this.top.flipped;
  }
  set flipped(f) {
    this.top.flipped = f;
  }
  /**
   * Multiply the current matrix with the given one
   */
  multiply(mat) {
    this.top.matrix.multiply_self(mat);
  }
  /**
   * Save the current state to the stack.
   */
  push() {
    this.#stack.push(this.top.copy());
  }
  /**
   * Pop the current transformation matrix off the stack and restore the
   * previous one.
   */
  pop() {
    this.#stack.pop();
  }
};

// third_party/earcut/earcut.js
function earcut(data, holeIndices, dim) {
  dim = dim || 2;
  var hasHoles = holeIndices && holeIndices.length, outerLen = hasHoles ? holeIndices[0] * dim : data.length, outerNode = linkedList(data, 0, outerLen, dim, true), triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  var minX, minY, maxX, maxY, x, y, invSize;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
  if (data.length > 80 * dim) {
    minX = maxX = data[0];
    minY = maxY = data[1];
    for (var i = dim; i < outerLen; i += dim) {
      x = data[i];
      y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }
  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
  return triangles;
}
__name(earcut, "earcut");
function linkedList(data, start, end, dim, clockwise) {
  var i, last;
  if (clockwise === signedArea(data, start, end, dim) > 0) {
    for (i = start; i < end; i += dim)
      last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (i = end - dim; i >= start; i -= dim)
      last = insertNode(i, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}
__name(linkedList, "linkedList");
function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  var p = start, again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);
  return end;
}
__name(filterPoints, "filterPoints");
function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
  if (!ear) return;
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  var stop = ear, prev, next;
  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i / dim | 0);
      triangles.push(ear.i / dim | 0);
      triangles.push(next.i / dim | 0);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) {
        earcutLinked(
          filterPoints(ear),
          triangles,
          dim,
          minX,
          minY,
          invSize,
          1
        );
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}
__name(earcutLinked, "earcutLinked");
function isEar(ear) {
  var a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  var ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  var x0 = ax < bx ? ax < cx ? ax : cx : bx < cx ? bx : cx, y0 = ay < by ? ay < cy ? ay : cy : by < cy ? by : cy, x1 = ax > bx ? ax > cx ? ax : cx : bx > cx ? bx : cx, y1 = ay > by ? ay > cy ? ay : cy : by > cy ? by : cy;
  var p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0)
      return false;
    p = p.next;
  }
  return true;
}
__name(isEar, "isEar");
function isEarHashed(ear, minX, minY, invSize) {
  var a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  var ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  var x0 = ax < bx ? ax < cx ? ax : cx : bx < cx ? bx : cx, y0 = ay < by ? ay < cy ? ay : cy : by < cy ? by : cy, x1 = ax > bx ? ax > cx ? ax : cx : bx > cx ? bx : cx, y1 = ay > by ? ay > cy ? ay : cy : by > cy ? by : cy;
  var minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
  var p = ear.prevZ, n = ear.nextZ;
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0)
      return false;
    p = p.prevZ;
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0)
      return false;
    n = n.nextZ;
  }
  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0)
      return false;
    p = p.prevZ;
  }
  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0)
      return false;
    n = n.nextZ;
  }
  return true;
}
__name(isEarHashed, "isEarHashed");
function cureLocalIntersections(start, triangles, dim) {
  var p = start;
  do {
    var a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i / dim | 0);
      triangles.push(p.i / dim | 0);
      triangles.push(b.i / dim | 0);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}
__name(cureLocalIntersections, "cureLocalIntersections");
function splitEarcut(start, triangles, dim, minX, minY, invSize) {
  var a = start;
  do {
    var b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        var c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
__name(splitEarcut, "splitEarcut");
function eliminateHoles(data, holeIndices, outerNode, dim) {
  var queue = [], i, len, start, end, list;
  for (i = 0, len = holeIndices.length; i < len; i++) {
    start = holeIndices[i] * dim;
    end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    list = linkedList(data, start, end, dim, false);
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort(compareX);
  for (i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i], outerNode);
  }
  return outerNode;
}
__name(eliminateHoles, "eliminateHoles");
function compareX(a, b) {
  return a.x - b.x;
}
__name(compareX, "compareX");
function eliminateHole(hole, outerNode) {
  var bridge = findHoleBridge(hole, outerNode);
  if (!bridge) {
    return outerNode;
  }
  var bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}
__name(eliminateHole, "eliminateHole");
function findHoleBridge(hole, outerNode) {
  var p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;
  var stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(
      hy < my ? hx : qx,
      hy,
      mx,
      my,
      hy < my ? qx : hx,
      hy,
      p.x,
      p.y
    )) {
      tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || tan === tanMin && (p.x > m.x || p.x === m.x && sectorContainsSector(m, p)))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}
__name(findHoleBridge, "findHoleBridge");
function sectorContainsSector(m, p) {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}
__name(sectorContainsSector, "sectorContainsSector");
function indexCurve(start, minX, minY, invSize) {
  var p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);
  p.prevZ.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}
__name(indexCurve, "indexCurve");
function sortLinked(list) {
  var i, p, q, e, tail, numMerges, pSize, qSize, inSize = 1;
  do {
    p = list;
    list = null;
    tail = null;
    numMerges = 0;
    while (p) {
      numMerges++;
      q = p;
      pSize = 0;
      for (i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      qSize = inSize;
      while (pSize > 0 || qSize > 0 && q) {
        if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
          e = p;
          p = p.nextZ;
          pSize--;
        } else {
          e = q;
          q = q.nextZ;
          qSize--;
        }
        if (tail) tail.nextZ = e;
        else list = e;
        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }
    tail.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);
  return list;
}
__name(sortLinked, "sortLinked");
function zOrder(x, y, minX, minY, invSize) {
  x = (x - minX) * invSize | 0;
  y = (y - minY) * invSize | 0;
  x = (x | x << 8) & 16711935;
  x = (x | x << 4) & 252645135;
  x = (x | x << 2) & 858993459;
  x = (x | x << 1) & 1431655765;
  y = (y | y << 8) & 16711935;
  y = (y | y << 4) & 252645135;
  y = (y | y << 2) & 858993459;
  y = (y | y << 1) & 1431655765;
  return x | y << 1;
}
__name(zOrder, "zOrder");
function getLeftmost(start) {
  var p = start, leftmost = start;
  do {
    if (p.x < leftmost.x || p.x === leftmost.x && p.y < leftmost.y)
      leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}
__name(getLeftmost, "getLeftmost");
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}
__name(pointInTriangle, "pointInTriangle");
function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && // dones't intersect other edges
  (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && // locally visible
  (area(a.prev, a, b.prev) || area(a, b.prev, b)) || // does not create opposite-facing sectors
  equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
}
__name(isValidDiagonal, "isValidDiagonal");
function area(p, q, r) {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}
__name(area, "area");
function equals(p1, p2) {
  return p1.x === p2.x && p1.y === p2.y;
}
__name(equals, "equals");
function intersects(p1, q1, p2, q2) {
  var o1 = sign(area(p1, q1, p2));
  var o2 = sign(area(p1, q1, q2));
  var o3 = sign(area(p2, q2, p1));
  var o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}
__name(intersects, "intersects");
function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}
__name(onSegment, "onSegment");
function sign(num) {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}
__name(sign, "sign");
function intersectsPolygon(a, b) {
  var p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b))
      return true;
    p = p.next;
  } while (p !== a);
  return false;
}
__name(intersectsPolygon, "intersectsPolygon");
function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}
__name(locallyInside, "locallyInside");
function middleInside(a, b) {
  var p = a, inside = false, px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next.y > py && p.next.y !== p.y && px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)
      inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}
__name(middleInside, "middleInside");
function splitPolygon(a, b) {
  var a2 = new Node2(a.i, a.x, a.y), b2 = new Node2(b.i, b.x, b.y), an = a.next, bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}
__name(splitPolygon, "splitPolygon");
function insertNode(i, x, y, last) {
  var p = new Node2(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}
__name(insertNode, "insertNode");
function removeNode(p) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}
__name(removeNode, "removeNode");
function Node2(i, x, y) {
  this.i = i;
  this.x = x;
  this.y = y;
  this.prev = null;
  this.next = null;
  this.z = 0;
  this.prevZ = null;
  this.nextZ = null;
  this.steiner = false;
}
__name(Node2, "Node");
earcut.deviation = function(data, holeIndices, dim, triangles) {
  var hasHoles = holeIndices && holeIndices.length;
  var outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  var polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
  if (hasHoles) {
    for (var i = 0, len = holeIndices.length; i < len; i++) {
      var start = holeIndices[i] * dim;
      var end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
      polygonArea -= Math.abs(signedArea(data, start, end, dim));
    }
  }
  var trianglesArea = 0;
  for (i = 0; i < triangles.length; i += 3) {
    var a = triangles[i] * dim;
    var b = triangles[i + 1] * dim;
    var c = triangles[i + 2] * dim;
    trianglesArea += Math.abs(
      (data[a] - data[c]) * (data[b + 1] - data[a + 1]) - (data[a] - data[b]) * (data[c + 1] - data[a + 1])
    );
  }
  return polygonArea === 0 && trianglesArea === 0 ? 0 : Math.abs((trianglesArea - polygonArea) / polygonArea);
};
function signedArea(data, start, end, dim) {
  var sum = 0;
  for (var i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}
__name(signedArea, "signedArea");
earcut.flatten = function(data) {
  var dim = data[0][0].length, result = { vertices: [], holes: [], dimensions: dim }, holeIndex = 0;
  for (var i = 0; i < data.length; i++) {
    for (var j = 0; j < data[i].length; j++) {
      for (var d = 0; d < dim; d++) result.vertices.push(data[i][j][d]);
    }
    if (i > 0) {
      holeIndex += data[i - 1].length;
      result.holes.push(holeIndex);
    }
  }
  return result;
};

// graphics/webgl/helpers.ts
var Uniform = class {
  constructor(gl, name, location2, type) {
    this.gl = gl;
    this.name = name;
    this.location = location2;
    this.type = type;
  }
  static {
    __name(this, "Uniform");
  }
  f1(x) {
    this.gl.uniform1f(this.location, x);
  }
  f1v(data, srcOffset, srcLength) {
    this.gl.uniform1fv(this.location, data, srcOffset, srcLength);
  }
  f2(...args) {
    this.gl.uniform2f(this.location, ...args);
  }
  f2v(...args) {
    this.gl.uniform2fv(this.location, ...args);
  }
  f3(...args) {
    this.gl.uniform3f(this.location, ...args);
  }
  f3v(...args) {
    this.gl.uniform3fv(this.location, ...args);
  }
  f4(...args) {
    this.gl.uniform4f(this.location, ...args);
  }
  f4v(...args) {
    this.gl.uniform4fv(this.location, ...args);
  }
  mat3f(...args) {
    this.gl.uniformMatrix3fv(this.location, ...args);
  }
  mat3fv(...args) {
    this.gl.uniformMatrix3fv(this.location, ...args);
  }
};
var ShaderProgram = class _ShaderProgram {
  /**
   * Create and compile a shader program
   * @param name - used for caching and identifying the shader
   * @param vertex - vertex shader source code
   * @param fragment - fragment shader source code
   */
  constructor(gl, name, vertex, fragment) {
    this.gl = gl;
    this.name = name;
    this.vertex = vertex;
    this.fragment = fragment;
    /** Shader uniforms */
    this.uniforms = {};
    /** Shader attributes */
    this.attribs = {};
    if (is_string(vertex)) {
      vertex = _ShaderProgram.compile(gl, gl.VERTEX_SHADER, vertex);
    }
    this.vertex = vertex;
    if (is_string(fragment)) {
      fragment = _ShaderProgram.compile(gl, gl.FRAGMENT_SHADER, fragment);
    }
    this.fragment = fragment;
    this.program = _ShaderProgram.link(gl, vertex, fragment);
    this.#discover_uniforms();
    this.#discover_attribs();
  }
  static {
    __name(this, "ShaderProgram");
  }
  static #shader_cache = /* @__PURE__ */ new WeakMap();
  /**
   * Load vertex and fragment shader sources from URLs and compile them
   * into a new ShaderProgram
   * @param name used for caching and identifying the shader.
   */
  static async load(gl, name, vert_src, frag_src) {
    let cache = _ShaderProgram.#shader_cache.get(gl);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      _ShaderProgram.#shader_cache.set(gl, cache);
    }
    if (!cache.has(name)) {
      if (vert_src instanceof URL) {
        vert_src = await (await fetch(vert_src)).text();
      }
      if (frag_src instanceof URL) {
        frag_src = await (await fetch(frag_src)).text();
      }
      const prog = new _ShaderProgram(gl, name, vert_src, frag_src);
      cache.set(name, prog);
    }
    return cache.get(name);
  }
  /**
   * Compiles a shader
   *
   * Typically not used directly, use load() instead.
   *
   * @param gl
   * @param type - gl.FRAGMENT_SHADER or gl.VERTEX_SHADER
   * @param source
   */
  static compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (shader == null) {
      throw new Error("Could not create new shader");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return shader;
    }
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Error compiling ${type} shader: ${info}`);
  }
  /**
   * Link a vertex and fragment shader into a shader program.
   *
   * Typically not used directly, use load() instead.
   */
  static link(gl, vertex, fragment) {
    const program = gl.createProgram();
    if (program == null) {
      throw new Error("Could not create new shader program");
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return program;
    }
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Error linking shader program: ${info}`);
  }
  #discover_uniforms() {
    this.uniforms = {};
    for (let u_n = 0; u_n < this.gl.getProgramParameter(this.program, this.gl.ACTIVE_UNIFORMS); u_n++) {
      const info = this.gl.getActiveUniform(this.program, u_n);
      if (info == null) {
        throw new Error(
          `Could not get uniform info for uniform number ${u_n} for program ${this.program}`
        );
      }
      const location2 = this.gl.getUniformLocation(
        this.program,
        info.name
      );
      if (location2 == null) {
        throw new Error(
          `Could not get uniform location for uniform number ${u_n} for program ${this.program}`
        );
      }
      this[info.name] = this.uniforms[info.name] = new Uniform(
        this.gl,
        info.name,
        location2,
        info.type
      );
    }
  }
  #discover_attribs() {
    this.attribs = {};
    for (let a_n = 0; a_n < this.gl.getProgramParameter(
      this.program,
      this.gl.ACTIVE_ATTRIBUTES
    ); a_n++) {
      const info = this.gl.getActiveAttrib(this.program, a_n);
      if (info == null) {
        throw new Error(
          `Could not get attribute info for attribute number ${a_n} for program ${this.program}`
        );
      }
      this.attribs[info.name] = info;
      this[info.name] = this.gl.getAttribLocation(
        this.program,
        info.name
      );
    }
  }
  /** use this shader for drawing */
  bind() {
    this.gl.useProgram(this.program);
  }
};
var VertexArray = class {
  /**
   * Create a VertexArray
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;
    this.buffers = [];
    this.gl = gl;
    const vao = this.gl.createVertexArray();
    if (!vao) {
      throw new Error(`Could not create new VertexArray`);
    }
    this.vao = vao;
    this.bind();
  }
  static {
    __name(this, "VertexArray");
  }
  /**
   * Free WebGL resources
   * @param include_buffers
   */
  dispose(include_buffers = true) {
    this.gl.deleteVertexArray(this.vao ?? null);
    this.vao = void 0;
    if (include_buffers) {
      for (const buf of this.buffers) {
        buf.dispose();
      }
    }
  }
  bind() {
    this.gl.bindVertexArray(this.vao);
  }
  /**
   * Create a new buffer bound to this vertex array
   * @param attrib - shader attribute location
   * @param size - number of components per vertex attribute
   * @param type - data type for each component, if unspecified it's gl.FLOAT.
   * @param normalized - whether or not to normalize integer types when converting to float
   * @param stride - offset between consecutive attributes
   * @param offset - offset from the beginning of the array to the first attribute
   * @param target - binding point, typically gl.ARRAY_BUFFER (the default if unspecified)
   *      or gl.ELEMENT_ARRAY_BUFFER
   */
  buffer(attrib, size, type, normalized = false, stride = 0, offset = 0, target) {
    type ??= this.gl.FLOAT;
    const b = new Buffer2(this.gl, target);
    b.bind();
    this.gl.vertexAttribPointer(
      attrib,
      size,
      type,
      normalized,
      stride,
      offset
    );
    this.gl.enableVertexAttribArray(attrib);
    this.buffers.push(b);
    return b;
  }
};
var Buffer2 = class {
  /**
   * Create a new buffer
   * @param target - binding point, typically gl.ARRAY_BUFFER (the default if unspecified)
   *      or gl.ELEMENT_ARRAY_BUFFER
   */
  constructor(gl, target) {
    this.gl = gl;
    this.gl = gl;
    this.target = target ?? gl.ARRAY_BUFFER;
    const buf = gl.createBuffer();
    if (!buf) {
      throw new Error("Unable to create new Buffer");
    }
    this.#buf = buf;
  }
  static {
    __name(this, "Buffer");
  }
  #buf;
  dispose() {
    if (this.#buf) {
      this.gl.deleteBuffer(this.#buf);
    }
    this.#buf = void 0;
  }
  /**
   * Binds the buffer to the current context
   */
  bind() {
    this.gl.bindBuffer(this.target, this.#buf);
  }
  /**
   * Uploads data to the GPU buffer
   *
   * @param usage - intended usage pattern, typically gl.STATIC_DRAW
   *      (the default if unspecified) or gl.DYNAMIC_DRAW
   */
  set(data, usage) {
    this.bind();
    usage ??= this.gl.STATIC_DRAW;
    this.gl.bufferData(this.target, data, usage);
  }
  /**
   * Gets the length of the buffer as reported by WebGL.
   */
  get length() {
    this.bind();
    return this.gl.getBufferParameter(
      this.target,
      this.gl.BUFFER_SIZE
    );
  }
};

// graphics/webgl/polygon.frag.glsl
var polygon_frag_default = "#version 300 es\n\nprecision highp float;\n\nuniform float u_depth;\nuniform float u_alpha;\n\nin vec4 v_color;\n\nout vec4 o_color;\n\nvoid main() {\n    vec4 i_color = v_color;\n    i_color.a *= u_alpha;\n    o_color = i_color;\n    gl_FragDepth = u_depth;\n}\n";

// graphics/webgl/polygon.vert.glsl
var polygon_vert_default = "#version 300 es\n\nuniform mat3 u_matrix;\nin vec2 a_position;\nin vec4 a_color;\nout vec4 v_color;\n\nvoid main() {\n    v_color = a_color;\n    gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);;\n}\n";

// graphics/webgl/polyline.frag.glsl
var polyline_frag_default = "#version 300 es\n\nprecision highp float;\n\nuniform float u_depth;\nuniform float u_alpha;\n\nin vec2 v_linespace;\nin float v_cap_region;\nin vec4 v_color;\n\nout vec4 outColor;\n\nvoid main() {\n    vec4 i_color = v_color;\n    i_color.a *= u_alpha;\n\n    float v = abs(v_linespace.x);\n    float x = v_linespace.x;\n    float y = v_linespace.y;\n\n    if(x < (-1.0 + v_cap_region)) {\n        float a = (1.0 + x) / v_cap_region;\n        x = mix(-1.0, 0.0, a);\n        if(x * x + y * y < 1.0) {\n            outColor = i_color;\n        } else {\n            discard;\n        }\n    } else if (x > (1.0 - v_cap_region)) {\n        float a = (x - (1.0 - v_cap_region)) / v_cap_region;\n        x = mix(0.0, 1.0, a);\n        if(x * x + y * y < 1.0) {\n            outColor = i_color;\n        } else {\n            discard;\n        }\n    } else {\n        outColor = i_color;\n    }\n\n    gl_FragDepth = u_depth;\n}\n";

// graphics/webgl/polyline.vert.glsl
var polyline_vert_default = "#version 300 es\n\nuniform mat3 u_matrix;\n\nin vec2 a_position;\nin vec4 a_color;\nin float a_cap_region;\n\nout vec2 v_linespace;\nout float v_cap_region;\nout vec4 v_color;\n\nvec2 c_linespace[6] = vec2[](\n    // first triangle\n    vec2(-1, -1),\n    vec2( 1, -1),\n    vec2(-1,  1),\n    // second triangle\n    vec2(-1,  1),\n    vec2( 1, -1),\n    vec2( 1,  1)\n);\n\nvoid main() {\n    int triangle_vertex_num = int(gl_VertexID % 6);\n\n    v_linespace = c_linespace[triangle_vertex_num];\n    v_cap_region = a_cap_region;\n\n    gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);\n\n    v_color = a_color;\n}\n";

// graphics/webgl/vector.ts
var Tesselator = class {
  static {
    __name(this, "Tesselator");
  }
  static {
    // Each line segment or circle is a two-triangle quad.
    this.vertices_per_quad = 2 * 3;
  }
  /**
   * Convert a quad to two triangles that cover the same area
   * @param quad four points defining the quad
   * @returns six points representing two triangles
   */
  static quad_to_triangles(quad) {
    const positions = [
      ...quad[0],
      ...quad[2],
      ...quad[1],
      ...quad[1],
      ...quad[2],
      ...quad[3]
    ];
    if (positions.filter((v) => Number.isNaN(v)).length) {
      throw new Error("Degenerate quad");
    }
    return positions;
  }
  /**
   * Populate an array with repeated copies of the given color
   */
  static populate_color_data(dest, color, offset, length2) {
    if (!color) {
      color = new Color(1, 0, 0, 1);
    }
    const color_data = color.to_array();
    for (let i = 0; i < length2; i++) {
      dest[offset + i] = color_data[i % color_data.length];
    }
  }
  /**
   * Tesselate a line segment into a quad
   * @returns four points representing the line segment.
   */
  static tesselate_segment(p1, p2, width) {
    const line = p2.sub(p1);
    const norm = line.normal.normalize();
    const n = norm.multiply(width / 2);
    const n2 = n.normal;
    const a = p1.add(n).add(n2);
    const b = p1.sub(n).add(n2);
    const c = p2.add(n).sub(n2);
    const d = p2.sub(n).sub(n2);
    return [a, b, c, d];
  }
  /**
   * Tesselate a Polyline into renderable data.
   */
  static tesselate_polyline(polyline) {
    const width = polyline.width || 0;
    const points = polyline.points;
    const color = polyline.color;
    const segment_count = points.length - 1;
    const vertex_count = segment_count * this.vertices_per_quad;
    const position_data = new Float32Array(vertex_count * 2);
    const color_data = new Float32Array(vertex_count * 4);
    const cap_data = new Float32Array(vertex_count);
    let vertex_index = 0;
    for (let segment_num = 1; segment_num < points.length; segment_num++) {
      const p1 = points[segment_num - 1];
      const p2 = points[segment_num];
      const length2 = p2.sub(p1).magnitude;
      if (length2 == 0) {
        continue;
      }
      const quad = this.tesselate_segment(p1, p2, width);
      const cap_region = width / (length2 + width);
      position_data.set(this.quad_to_triangles(quad), vertex_index * 2);
      cap_data.set(
        Array(this.vertices_per_quad).fill(cap_region),
        vertex_index
      );
      this.populate_color_data(
        color_data,
        color,
        vertex_index * 4,
        this.vertices_per_quad * 4
      );
      vertex_index += this.vertices_per_quad;
    }
    return {
      position_array: position_data.slice(0, vertex_index * 2),
      cap_array: cap_data.slice(0, vertex_index),
      color_array: color_data.slice(0, vertex_index * 4)
    };
  }
  /**
   * Tessellate a circle into a quad
   * @returns four points representing the quad
   */
  static tesselate_circle(circle) {
    const n = new Vec2(circle.radius, 0);
    const n2 = n.normal;
    const a = circle.center.add(n).add(n2);
    const b = circle.center.sub(n).add(n2);
    const c = circle.center.add(n).sub(n2);
    const d = circle.center.sub(n).sub(n2);
    return [a, b, c, d];
  }
  /**
   * Tessellate an array of circles into renderable data
   */
  static tesselate_circles(circles) {
    const vertex_count = circles.length * this.vertices_per_quad;
    const position_data = new Float32Array(vertex_count * 2);
    const cap_data = new Float32Array(vertex_count);
    const color_data = new Float32Array(vertex_count * 4);
    let vertex_index = 0;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const cap_region = 1;
      const quad = this.tesselate_circle(c);
      position_data.set(this.quad_to_triangles(quad), vertex_index * 2);
      cap_data.set(
        Array(this.vertices_per_quad).fill(cap_region),
        vertex_index
      );
      this.populate_color_data(
        color_data,
        c.color,
        vertex_index * 4,
        this.vertices_per_quad * 4
      );
      vertex_index += this.vertices_per_quad;
    }
    return {
      position_array: position_data.slice(0, vertex_index * 2),
      cap_array: cap_data.slice(0, vertex_index),
      color_array: color_data.slice(0, vertex_index * 4)
    };
  }
  /**
   * Convert a point cloud polygon into an array of triangles.
   * Populates this.vertices with the triangles and clears this.points.
   */
  static triangulate_polygon(polygon) {
    if (polygon.vertices) {
      return polygon;
    }
    const points = polygon.points;
    const points_flattened = new Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      points_flattened[i * 2] = pt.x;
      points_flattened[i * 2 + 1] = pt.y;
    }
    if (points.length == 3) {
      polygon.points = [];
      polygon.vertices = new Float32Array(points_flattened);
      return polygon;
    }
    const triangle_indexes = earcut(points_flattened);
    const vertices = new Float32Array(triangle_indexes.length * 2);
    for (let i = 0; i < triangle_indexes.length; i++) {
      const index = triangle_indexes[i];
      vertices[i * 2] = points_flattened[index * 2];
      vertices[i * 2 + 1] = points_flattened[index * 2 + 1];
    }
    polygon.points = [];
    polygon.vertices = vertices;
    return polygon;
  }
};
var CircleSet = class _CircleSet {
  /**
   * Create a new circle set.
   * @param shader - optional override for the shader program used when drawing.
   */
  constructor(gl, shader) {
    this.gl = gl;
    this.shader = shader ?? _CircleSet.shader;
    this.vao = new VertexArray(gl);
    this.position_buf = this.vao.buffer(this.shader["a_position"], 2);
    this.cap_region_buf = this.vao.buffer(this.shader["a_cap_region"], 1);
    this.color_buf = this.vao.buffer(this.shader["a_color"], 4);
    this.vertex_count = 0;
  }
  static {
    __name(this, "CircleSet");
  }
  /**
   * Load the shader program required to render this primitive.
   */
  static async load_shader(gl) {
    this.shader = await ShaderProgram.load(
      gl,
      "polyline",
      polyline_vert_default,
      polyline_frag_default
    );
  }
  /**
   * Release GPU resources
   */
  dispose() {
    this.vao.dispose();
    this.position_buf.dispose();
    this.cap_region_buf.dispose();
    this.color_buf.dispose();
  }
  /**
   * Tesselate an array of circles and upload them to the GPU.
   */
  set(circles) {
    const { position_array, cap_array, color_array } = Tesselator.tesselate_circles(circles);
    this.position_buf.set(position_array);
    this.cap_region_buf.set(cap_array);
    this.color_buf.set(color_array);
    this.vertex_count = position_array.length / 2;
  }
  render() {
    if (!this.vertex_count) {
      return;
    }
    this.vao.bind();
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertex_count);
  }
};
var PolylineSet = class _PolylineSet {
  /**
   * Create a new polyline set.
   * @param {WebGL2RenderingContext} gl
   * @param {ShaderProgram?} shader - optional override for the shader program used when drawing.
   */
  constructor(gl, shader) {
    this.gl = gl;
    this.shader = shader ?? _PolylineSet.shader;
    this.vao = new VertexArray(gl);
    this.position_buf = this.vao.buffer(this.shader["a_position"], 2);
    this.cap_region_buf = this.vao.buffer(this.shader["a_cap_region"], 1);
    this.color_buf = this.vao.buffer(this.shader["a_color"], 4);
    this.vertex_count = 0;
  }
  static {
    __name(this, "PolylineSet");
  }
  /**
   * Load the shader program required to render this primitive.
   */
  static async load_shader(gl) {
    this.shader = await ShaderProgram.load(
      gl,
      "polyline",
      polyline_vert_default,
      polyline_frag_default
    );
  }
  /**
   * Release GPU resources
   */
  dispose() {
    this.vao.dispose();
    this.position_buf.dispose();
    this.cap_region_buf.dispose();
    this.color_buf.dispose();
  }
  /**
   * Tessellate an array of polylines and upload them to the GPU.
   */
  set(lines) {
    if (!lines.length) {
      return;
    }
    const vertex_count = lines.reduce((v, e) => {
      return v + (e.points.length - 1) * Tesselator.vertices_per_quad;
    }, 0);
    const position_data = new Float32Array(vertex_count * 2);
    const cap_data = new Float32Array(vertex_count);
    const color_data = new Float32Array(vertex_count * 4);
    let position_idx = 0;
    let cap_idx = 0;
    let color_idx = 0;
    for (const line of lines) {
      const { position_array, cap_array, color_array } = Tesselator.tesselate_polyline(line);
      position_data.set(position_array, position_idx);
      position_idx += position_array.length;
      cap_data.set(cap_array, cap_idx);
      cap_idx += cap_array.length;
      color_data.set(color_array, color_idx);
      color_idx += color_array.length;
    }
    this.position_buf.set(position_data);
    this.cap_region_buf.set(cap_data);
    this.color_buf.set(color_data);
    this.vertex_count = position_idx / 2;
  }
  render() {
    if (!this.vertex_count) {
      return;
    }
    this.vao.bind();
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertex_count);
  }
};
var PolygonSet = class _PolygonSet {
  /**
   * Create a new polygon set.
   * @param {WebGL2RenderingContext} gl
   * @param {ShaderProgram?} shader - optional override for the shader program used when drawing.
   */
  constructor(gl, shader) {
    this.gl = gl;
    this.shader = shader ?? _PolygonSet.shader;
    this.vao = new VertexArray(gl);
    this.position_buf = this.vao.buffer(this.shader["a_position"], 2);
    this.color_buf = this.vao.buffer(this.shader["a_color"], 4);
    this.vertex_count = 0;
  }
  static {
    __name(this, "PolygonSet");
  }
  /**
   * Load the shader program required to render this primitive.
   */
  static async load_shader(gl) {
    this.shader = await ShaderProgram.load(
      gl,
      "polygon",
      polygon_vert_default,
      polygon_frag_default
    );
  }
  /**
   * Release GPU resources
   */
  dispose() {
    this.vao.dispose();
    this.position_buf.dispose();
    this.color_buf.dispose();
  }
  /**
   * Convert an array of triangle vertices to polylines.
   *
   * This is a helper function for debugging. It allows for easy drawing of the
   * outlines of the results of triangulation.
   *
   */
  static polyline_from_triangles(triangles, width, color) {
    const lines = [];
    for (let i = 0; i < triangles.length; i += 6) {
      const a = new Vec2(triangles[i], triangles[i + 1]);
      const b = new Vec2(triangles[i + 2], triangles[i + 3]);
      const c = new Vec2(triangles[i + 4], triangles[i + 5]);
      lines.push(new Polyline2([a, b, c, a], width, color));
    }
    return lines;
  }
  /**
   * Tessellate (triangulate) and upload a list of polygons to the GPU.
   */
  set(polygons) {
    let total_vertex_data_length = 0;
    for (const polygon of polygons) {
      Tesselator.triangulate_polygon(polygon);
      total_vertex_data_length += polygon.vertices?.length ?? 0;
    }
    const total_vertices = total_vertex_data_length / 2;
    const vertex_data = new Float32Array(total_vertex_data_length);
    const color_data = new Float32Array(total_vertices * 4);
    let vertex_data_idx = 0;
    let color_data_idx = 0;
    for (const polygon of polygons) {
      if (polygon.vertices == null) {
        continue;
      }
      const polygon_vertex_count = polygon.vertices.length / 2;
      vertex_data.set(polygon.vertices, vertex_data_idx);
      vertex_data_idx += polygon.vertices.length;
      Tesselator.populate_color_data(
        color_data,
        polygon.color,
        color_data_idx,
        polygon_vertex_count * 4
      );
      color_data_idx += polygon_vertex_count * 4;
    }
    this.position_buf.set(vertex_data);
    this.color_buf.set(color_data);
    this.vertex_count = vertex_data_idx / 2;
  }
  render() {
    if (!this.vertex_count) {
      return;
    }
    this.vao.bind();
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertex_count);
  }
};
var PrimitiveSet = class {
  /**
   * Create a new primitive set
   */
  constructor(gl) {
    this.gl = gl;
    this.gl = gl;
  }
  static {
    __name(this, "PrimitiveSet");
  }
  #polygons = [];
  #circles = [];
  #lines = [];
  #polygon_set;
  #circle_set;
  #polyline_set;
  /**
   * Load all shader programs required to render primitives.
   */
  static async load_shaders(gl) {
    await Promise.all([
      PolygonSet.load_shader(gl),
      PolylineSet.load_shader(gl),
      CircleSet.load_shader(gl)
    ]);
  }
  /**
   * Release GPU resources
   */
  dispose() {
    this.#polygon_set?.dispose();
    this.#circle_set?.dispose();
    this.#polyline_set?.dispose();
  }
  /**
   * Clear committed geometry
   */
  clear() {
    this.#polygon_set?.dispose();
    this.#circle_set?.dispose();
    this.#polyline_set?.dispose();
    this.#polygon_set = void 0;
    this.#circle_set = void 0;
    this.#polyline_set = void 0;
    this.#polygons = [];
    this.#circles = [];
    this.#lines = [];
  }
  /**
   * Collect a new filled circle
   */
  add_circle(circle) {
    this.#circles.push(circle);
  }
  /**
   * Collect a new filled polygon
   */
  add_polygon(polygon) {
    this.#polygons.push(polygon);
  }
  /**
   * Collect a new polyline
   */
  add_line(line) {
    this.#lines.push(line);
  }
  /**
   * Tessellate all collected primitives and upload their data to the GPU.
   */
  commit() {
    if (this.#polygons.length) {
      this.#polygon_set = new PolygonSet(this.gl);
      this.#polygon_set.set(this.#polygons);
      this.#polygons = void 0;
    }
    if (this.#lines.length) {
      this.#polyline_set = new PolylineSet(this.gl);
      this.#polyline_set.set(this.#lines);
      this.#lines = void 0;
    }
    if (this.#circles.length) {
      this.#circle_set = new CircleSet(this.gl);
      this.#circle_set.set(this.#circles);
      this.#circles = void 0;
    }
  }
  /**
   * Draw all the previously commit()ed primitives
   * @param matrix - complete view/projection matrix
   * @param depth - used for depth testing
   * @parama alpha - overrides the alpha for colors
   */
  render(matrix, depth = 0, alpha = 1) {
    if (this.#polygon_set) {
      this.#polygon_set.shader.bind();
      this.#polygon_set.shader["u_matrix"].mat3f(false, matrix.elements);
      this.#polygon_set.shader["u_depth"].f1(depth);
      this.#polygon_set.shader["u_alpha"].f1(alpha);
      this.#polygon_set.render();
    }
    if (this.#circle_set) {
      this.#circle_set.shader.bind();
      this.#circle_set.shader["u_matrix"].mat3f(false, matrix.elements);
      this.#circle_set.shader["u_depth"].f1(depth);
      this.#circle_set.shader["u_alpha"].f1(alpha);
      this.#circle_set.render();
    }
    if (this.#polyline_set) {
      this.#polyline_set.shader.bind();
      this.#polyline_set.shader["u_matrix"].mat3f(false, matrix.elements);
      this.#polyline_set.shader["u_depth"].f1(depth);
      this.#polyline_set.shader["u_alpha"].f1(alpha);
      this.#polyline_set.render();
    }
  }
};

// graphics/webgl/renderer.ts
var WebGL2Renderer = class extends Renderer {
  /**
   * Create a new WebGL2Renderer
   */
  constructor(canvas) {
    super(canvas);
    /** Graphics layers */
    this.#layers = [];
    /** Projection matrix for clip -> screen */
    this.projection_matrix = Matrix3.identity();
  }
  static {
    __name(this, "WebGL2Renderer");
  }
  #layers;
  /** The layer currently being drawn to. */
  #active_layer;
  /**
   * Create and configure the WebGL2 context.
   */
  async setup() {
    const gl = this.canvas.getContext("webgl2", { alpha: false });
    if (gl == null) {
      throw new Error("Unable to create WebGL2 context");
    }
    this.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GREATER);
    gl.clearColor(...this.background_color.to_array());
    gl.clearDepth(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.update_canvas_size();
    await PrimitiveSet.load_shaders(gl);
  }
  dispose() {
    for (const layer of this.layers) {
      layer.dispose();
    }
    this.gl = void 0;
  }
  update_canvas_size() {
    if (!this.gl) {
      return;
    }
    const dpr = window.devicePixelRatio;
    const rect = this.canvas.getBoundingClientRect();
    const logical_w = rect.width;
    const logical_h = rect.height;
    const pixel_w = Math.round(rect.width * dpr);
    const pixel_h = Math.round(rect.height * dpr);
    if (this.canvas_size.x == pixel_w && this.canvas_size.y == pixel_h) {
      return;
    }
    this.canvas.width = pixel_w;
    this.canvas.height = pixel_h;
    this.gl.viewport(0, 0, pixel_w, pixel_h);
    this.projection_matrix = Matrix3.orthographic(logical_w, logical_h);
  }
  clear_canvas() {
    if (this.gl == null) throw new Error("Uninitialized");
    this.update_canvas_size();
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }
  start_layer(name, depth = 0) {
    if (this.gl == null) throw new Error("Uninitialized");
    this.#active_layer = new WebGL2RenderLayer(
      this,
      name,
      new PrimitiveSet(this.gl)
    );
  }
  end_layer() {
    if (this.#active_layer == null) throw new Error("No active layer");
    this.#active_layer.geometry.commit();
    this.#layers.push(this.#active_layer);
    this.#active_layer = null;
    return this.#layers.at(-1);
  }
  arc(arc_or_center, radius, start_angle, end_angle, width, color) {
    super.prep_arc(
      arc_or_center,
      radius,
      start_angle,
      end_angle,
      width,
      color
    );
  }
  circle(circle_or_center, radius, color) {
    const circle = super.prep_circle(circle_or_center, radius, color);
    if (!circle.color) {
      return;
    }
    this.#active_layer.geometry.add_circle(circle);
  }
  line(line_or_points, width, color) {
    const line = super.prep_line(line_or_points, width, color);
    if (!line.color) {
      return;
    }
    this.#active_layer.geometry.add_line(line);
  }
  polygon(polygon_or_points, color) {
    const polygon = super.prep_polygon(polygon_or_points, color);
    if (!polygon.color) {
      return;
    }
    this.#active_layer.geometry.add_polygon(polygon);
  }
  get layers() {
    const layers = this.#layers;
    return {
      *[Symbol.iterator]() {
        for (const layer of layers) {
          yield layer;
        }
      }
    };
  }
  remove_layer(layer) {
    const idx = this.#layers.indexOf(layer);
    if (idx == -1) {
      return;
    }
    this.#layers.splice(idx, 1);
  }
};
var WebGL2RenderLayer = class extends RenderLayer {
  constructor(renderer, name, geometry) {
    super(renderer, name);
    this.renderer = renderer;
    this.name = name;
    this.geometry = geometry;
  }
  static {
    __name(this, "WebGL2RenderLayer");
  }
  dispose() {
    this.clear();
  }
  clear() {
    this.geometry?.dispose();
  }
  render(transform, depth, global_alpha = 1) {
    const gl = this.renderer.gl;
    const total_transform = this.renderer.projection_matrix.multiply(transform);
    if (this.composite_operation != "source-over") {
      gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    }
    this.geometry.render(total_transform, depth, global_alpha);
    if (this.composite_operation != "source-over") {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }
};

// kicad/text/glyph.ts
var Glyph = class {
  static {
    __name(this, "Glyph");
  }
};
var StrokeGlyph = class _StrokeGlyph extends Glyph {
  constructor(strokes, bbox) {
    super();
    this.strokes = strokes;
    this.bbox = bbox;
  }
  static {
    __name(this, "StrokeGlyph");
  }
  transform(glyph_size, offset, tilt, angle, mirror2, origin) {
    const bb = this.bbox.copy();
    bb.x = offset.x + bb.x * glyph_size.x;
    bb.y = offset.y + bb.y * glyph_size.y;
    bb.w = bb.w * glyph_size.x;
    bb.h = bb.h * glyph_size.y;
    if (tilt) {
      bb.w += bb.h * tilt;
    }
    const strokes = [];
    for (const src_stroke of this.strokes) {
      const points = [];
      for (const src_point of src_stroke) {
        let point = src_point.multiply(glyph_size);
        if (tilt > 0) {
          point.x -= point.y * tilt;
        }
        point = point.add(offset);
        if (mirror2) {
          point.x = origin.x - (point.x - origin.x);
        }
        if (angle.degrees != 0) {
          point = angle.rotate_point(point, origin);
        }
        points.push(point);
      }
      strokes.push(points);
    }
    return new _StrokeGlyph(strokes, bb);
  }
};

// kicad/text/markup.ts
var Markup = class {
  constructor(text) {
    this.text = text;
    this.root = parse(tokenize2(text));
    this.root.is_root = true;
  }
  static {
    __name(this, "Markup");
  }
};
var MarkupNode = class {
  constructor() {
    this.is_root = false;
    this.subscript = false;
    this.superscript = false;
    this.overbar = false;
    this.text = "";
    this.children = [];
  }
  static {
    __name(this, "MarkupNode");
  }
};
function* tokenize2(str) {
  const EOF2 = "";
  let start_idx = 0;
  let control_char = null;
  let bracket_count = 0;
  for (let i = 0; i < str.length + 1; i++) {
    const c = i < str.length ? str[i] : EOF2;
    switch (c) {
      case "_":
      case "^":
      case "~":
        control_char = c;
        break;
      case "{":
        if (control_char) {
          bracket_count++;
          yield { text: str.slice(start_idx, i - 1) };
          yield { open: bracket_count, control: control_char };
          control_char = null;
          start_idx = i + 1;
        }
        break;
      case "}":
        if (bracket_count) {
          yield { text: str.slice(start_idx, i) };
          yield { close: bracket_count };
          start_idx = i + 1;
          bracket_count--;
        }
        break;
      case EOF2:
        yield { text: str.slice(start_idx, i) };
        break;
      default:
        control_char = null;
        break;
    }
  }
}
__name(tokenize2, "tokenize");
function parse(tokens) {
  let token;
  const node = new MarkupNode();
  while (token = tokens.next().value) {
    if (token.text) {
      const c = new MarkupNode();
      c.text = token.text;
      node.children.push(c);
      continue;
    }
    if (token.open) {
      const c = parse(tokens);
      switch (token.control) {
        case "^":
          c.superscript = true;
          break;
        case "_":
          c.subscript = true;
          break;
        case "~":
          c.overbar = true;
          break;
      }
      node.children.push(c);
      continue;
    }
    if (token.close) {
      return node;
    }
  }
  return node;
}
__name(parse, "parse");

// kicad/text/font.ts
var Font3 = class {
  constructor(name) {
    this.name = name;
  }
  static {
    __name(this, "Font");
  }
  static {
    /** Used to apply italic slant to stroke fonts and to estimate size of italic outline fonts. */
    this.italic_tilt = 1 / 8;
  }
  static {
    /** Used to determine the spacing between two lines */
    this.interline_pitch_ratio = 1.62;
  }
  draw(gfx, text, position, attributes) {
    if (!gfx || !text) {
      return;
    }
    const lines = this.get_line_positions(text, position, attributes);
    gfx.state.stroke_width = attributes.stroke_width;
    for (const line of lines) {
      this.draw_line(gfx, line.text, line.position, position, attributes);
    }
  }
  /**
   * Computes the width and height of a single line of marked up text.
   *
   * Corresponds to KiCad's FONT::StringBoundaryLimits
   *
   * Used by EDAText.get_text_box(), which, inexplicably, doesn't use
   * get_line_bbox() for what I can only assume is historical reasons.
   *
   * @param text - the text, should be a single line of markup.
   * @param size - width and height of a glyph
   * @param thickness - text thickness, used only to inflate the bounding box.
   * @param bold - note: currently ignored by stroke font, as boldness is
   *               applied by increasing the thickness.
   */
  get_line_extents(text, size, thickness, bold, italic) {
    const style = new TextStyle();
    style.bold = bold;
    style.italic = italic;
    const { bbox } = this.get_markup_as_glyphs(
      text,
      new Vec2(0, 0),
      size,
      new Angle(0),
      false,
      new Vec2(0, 0),
      style
    );
    return new Vec2(bbox.w, bbox.h);
  }
  /**
   * Adds additional line breaks to the given marked up text in order to limit
   * the overall width to the given column_width.
   *
   * Note: this behaves like KiCad's FONT::LinebreakText in that it only
   * breaks on spaces, it does not break within superscript, subscript, or
   * overbar, and it doesn't bother with justification.
   *
   * Used by SCH_TEXTBOX & PCB_TEXTBOX.
   *
   * @param bold - note: ignored by stroke font, as boldness is applied by
   *               increasing the thickness.
   */
  break_lines(text, column_width, glyph_size, thickness, bold, italic) {
    const style = new TextStyle();
    style.bold = bold;
    style.italic = italic;
    const space_width = this.get_text_as_glyphs(
      " ",
      glyph_size,
      new Vec2(0, 0),
      new Angle(0),
      false,
      new Vec2(0, 0),
      style
    ).cursor.x;
    const in_lines = text.split("\n");
    let out_text = "";
    for (let line_n = 0; line_n < in_lines.length; line_n++) {
      const in_line = in_lines[line_n];
      let unset_line = true;
      let line_width = 0;
      const words = this.wordbreak_markup(in_line, glyph_size, style);
      for (const { word, width } of words) {
        if (unset_line) {
          out_text += word;
          line_width += width;
          unset_line = false;
        } else if (line_width + space_width + width < column_width - thickness) {
          out_text += " " + word;
          line_width += space_width + width;
        } else {
          out_text += "\n";
          line_width = 0;
          unset_line = true;
        }
      }
      if (line_n != in_lines.length - 1) {
        out_text += "\n";
      }
    }
    return out_text;
  }
  // protected interfaces below.
  /**
   * Draws a single line of text.
   *
   * Multitext text must be split before calling this function.
   *
   * Corresponds to KiCad's Font::DrawSingleLineText
   *
   * Used by draw()
   */
  draw_line(gfx, text, position, origin, attributes) {
    if (!gfx) {
      return new BBox(0, 0, 0, 0);
    }
    const style = new TextStyle();
    style.italic = attributes.italic;
    style.underline = attributes.underlined;
    const { glyphs, bbox } = this.get_markup_as_glyphs(
      text,
      position,
      attributes.size,
      attributes.angle,
      attributes.mirrored,
      origin,
      style
    );
    const transform = Matrix3.scaling(1e-4, 1e-4);
    for (const glyph of glyphs) {
      for (const stroke of glyph.strokes) {
        const stroke_pts = Array.from(transform.transform_all(stroke));
        gfx.line(
          new Polyline2(
            stroke_pts,
            attributes.stroke_width / 1e4,
            attributes.color
          )
        );
      }
    }
    return bbox;
  }
  /**
   * Computes the bounding box for a single line of text.
   *
   * Corresponds to KiCad's FONT::boundingBoxSingleLine
   *
   * Used by get_line_positions() and draw()
   */
  get_line_bbox(text, position, size, italic) {
    const style = new TextStyle();
    style.italic = italic;
    const { bbox, next_position } = this.get_markup_as_glyphs(
      text,
      position,
      size,
      new Angle(0),
      false,
      new Vec2(0, 0),
      style
    );
    return { bbox, cursor: next_position };
  }
  /**
   * Get positions for each line in a multiline text.
   *
   * Used by draw()
   */
  get_line_positions(text, position, attributes) {
    const extents = [];
    const positions = [];
    const lines = text.split("\n");
    const num_lines = lines.length;
    const interline = this.get_interline(
      attributes.size.y,
      attributes.line_spacing
    );
    let height = 0;
    for (let n = 0; n < num_lines; n++) {
      const line = lines[n];
      const line_position = new Vec2(
        position.x,
        position.y + n * interline
      );
      const { cursor: line_end } = this.get_line_bbox(
        line,
        line_position,
        attributes.size,
        attributes.italic
      );
      const line_extents = line_end.sub(line_position);
      extents.push(line_extents);
      if (n == 0) {
        height += attributes.size.y * 1.17;
      } else {
        height += interline;
      }
    }
    const offset = new Vec2(0, attributes.size.y);
    switch (attributes.v_align) {
      case "top":
        break;
      case "center":
        offset.y -= height / 2;
        break;
      case "bottom":
        offset.y -= height;
        break;
    }
    for (let n = 0; n < num_lines; n++) {
      const line_extents = extents[n];
      const line_offset = offset.copy();
      line_offset.y += n * interline;
      switch (attributes.h_align) {
        case "left":
          break;
        case "center":
          line_offset.x = -line_extents.x / 2;
          break;
        case "right":
          line_offset.x = -line_extents.x;
          break;
      }
      positions.push(position.add(line_offset));
    }
    const out = [];
    for (let n = 0; n < num_lines; n++) {
      out.push({
        text: lines[n],
        position: positions[n],
        extents: extents[n]
      });
    }
    return out;
  }
  /**
   * Converts marked up text to glyphs
   *
   * Corresponds to KiCad's FONT::drawMarkup, which doesn't actually draw,
   * just converts to glyphs.
   *
   * Used by string_boundary_limits(), draw_single_line_text(), and
   * bbox_single_line()
   */
  get_markup_as_glyphs(text, position, size, angle, mirror2, origin, style) {
    const markup = new Markup(text);
    return this.get_markup_node_as_glyphs(
      markup.root,
      position,
      size,
      angle,
      mirror2,
      origin,
      style
    );
  }
  /** Internal method used by get_markup_as_glyphs */
  get_markup_node_as_glyphs(node, position, size, angle, mirror2, origin, style) {
    let glyphs = [];
    const bboxes = [];
    const next_position = position.copy();
    let node_style = style.copy();
    if (!node.is_root) {
      if (node.subscript) {
        node_style = new TextStyle();
        node_style.subscript = true;
      }
      if (node.superscript) {
        node_style = new TextStyle();
        node_style.superscript = true;
      }
      node_style.overbar ||= node.overbar;
      if (node.text) {
        const {
          glyphs: node_glyphs,
          cursor,
          bbox
        } = this.get_text_as_glyphs(
          node.text,
          size,
          position,
          angle,
          mirror2,
          origin,
          node_style
        );
        glyphs = node_glyphs;
        bboxes.push(bbox);
        next_position.set(cursor);
      }
    }
    for (const child of node.children) {
      const {
        next_position: child_next_position,
        bbox: child_bbox,
        glyphs: child_glyphs
      } = this.get_markup_node_as_glyphs(
        child,
        next_position,
        size,
        angle,
        mirror2,
        origin,
        node_style
      );
      next_position.set(child_next_position);
      bboxes.push(child_bbox);
      glyphs = glyphs.concat(child_glyphs);
    }
    return {
      next_position,
      bbox: BBox.combine(bboxes),
      glyphs
    };
  }
  /** Breaks text up into words, accounting for markup.
   *
   * Corresponds to KiCad's FONT::wordbreakMarkup
   *
   * As per KiCad, a word can represent an actual word or a run of text
   * with subscript, superscript, or overbar applied.
   *
   * Used by SCH_TEXTBOX & PCB_TEXTBOX
   */
  wordbreak_markup(text, size, style) {
    const markup = new Markup(text);
    return this.wordbreak_markup_node(markup.root, size, style);
  }
  /** Internal method used by wordbreak_markup */
  wordbreak_markup_node(node, size, style) {
    const node_style = style.copy();
    let output = [];
    if (!node.is_root) {
      let escape_char = "";
      if (node.subscript) {
        escape_char = "_";
        node_style.subscript = true;
      }
      if (node.superscript) {
        escape_char = "^";
        node_style.superscript = true;
      }
      if (node.overbar) {
        escape_char = "~";
        node_style.overbar = true;
      }
      if (escape_char) {
        let word = `${escape_char}{`;
        let width = 0;
        if (node.text) {
          const { cursor } = this.get_text_as_glyphs(
            node.text,
            size,
            new Vec2(0, 0),
            new Angle(0),
            false,
            new Vec2(0, 0),
            node_style
          );
          word += node.text;
          width += cursor.x;
        }
        for (const child of node.children) {
          const child_words = this.wordbreak_markup_node(
            child,
            size,
            node_style
          );
          for (const {
            word: child_word,
            width: child_width
          } of child_words) {
            word += child_word;
            width += child_width;
          }
        }
        word += "}";
        return [{ word, width }];
      } else {
        const words = node.text.trim().split(" ");
        if (node.text.endsWith(" ")) {
          words.push(" ");
        }
        for (const word of words) {
          const { cursor } = this.get_text_as_glyphs(
            word,
            size,
            new Vec2(0, 0),
            new Angle(0),
            false,
            new Vec2(0, 0),
            node_style
          );
          output.push({ word, width: cursor.x });
        }
      }
    }
    for (const child of node.children) {
      output = output.concat(
        this.wordbreak_markup_node(child, size, style)
      );
    }
    return output;
  }
};
var TextStyle = class _TextStyle {
  constructor(bold = false, italic = false, subscript = false, superscript = false, overbar = false, underline = false) {
    this.bold = bold;
    this.italic = italic;
    this.subscript = subscript;
    this.superscript = superscript;
    this.overbar = overbar;
    this.underline = underline;
  }
  static {
    __name(this, "TextStyle");
  }
  copy() {
    return new _TextStyle(
      this.bold,
      this.italic,
      this.subscript,
      this.superscript,
      this.overbar,
      this.underline
    );
  }
};
var TextAttributes = class _TextAttributes {
  constructor() {
    this.font = null;
    this.h_align = "center";
    this.v_align = "center";
    this.angle = new Angle(0);
    this.line_spacing = 1;
    this.stroke_width = 0;
    this.italic = false;
    this.bold = false;
    this.underlined = false;
    this.color = Color.transparent_black;
    this.visible = true;
    this.mirrored = false;
    this.multiline = true;
    this.size = new Vec2(0, 0);
    /** Used to keep the text from being rotated upside-down
     * or backwards and becoming difficult to read. */
    this.keep_upright = false;
  }
  static {
    __name(this, "TextAttributes");
  }
  copy() {
    const a = new _TextAttributes();
    a.font = this.font;
    a.h_align = this.h_align;
    a.v_align = this.v_align;
    a.angle = this.angle.copy();
    a.line_spacing = this.line_spacing;
    a.stroke_width = this.stroke_width;
    a.italic = this.italic;
    a.bold = this.bold;
    a.underlined = this.underlined;
    a.color = this.color.copy();
    a.visible = this.visible;
    a.mirrored = this.mirrored;
    a.multiline = this.multiline;
    a.size = this.size.copy();
    return a;
  }
};

// kicad/text/newstroke-glyphs.ts
var shared_glyphs = ["E_JSZS", "G][EI`", "H\\KFXFQNTNVOWPXRXWWYVZT[N[LZKY", "I[MUWU RK[RFY[", "G\\SPVQWRXTXWWYVZT[L[LFSFUGVHWJWLVNUOSPLP", "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH", "H[MPTP RW[M[MFWF", "G]L[LF RLPXP RX[XF", "MWR[RF", "G\\L[LF RX[OO RXFLR", "F^K[KFRUYFY[", "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF", "G\\L[LFTFVGWHXJXMWOVPTQLQ", "JZLFXF RR[RF", "H\\KFY[ RYFK[", "I[RQR[ RKFRQYF", "NVPESH", "HZVZT[P[NZMYLWLQMONNPMTMVN", "MWRMR_QaObNb RRFQGRHSGRFRH", "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[", "JZMMR[WM", "G]JMN[RQV[ZM", "H\\RbRD", "F^K[KFYFY[K[", "RR", "NVTEQH", "JZRRQSRTSSRRRT", "MWR[RF RN?O@NAM@N?NA RV?W@VAU@V?VA", "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RIPQP", "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RTEQH", "I[MUWU RK[RFY[ RN>O@QASAU@V>", "IZNMN[ RPSV[ RVMNU", "G]KPYP RPFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF", "I[NNPMTMVNWPWXVZT[P[NZMXMVWT", "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[", "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN", "MXRMRXSZU[", "H[LTWT RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[", "G]RFRb RPMTMVNXPYRYVXXVZT[P[NZLXKVKRLPNNPM", "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RTEQH", "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RTEQH", "I\\NMN[ RNOONQMTMVNWPWb RTEQH", "MXRMRXSZU[ RTEQH", "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM", "H[MMMXNZP[S[UZVYWWWPVNUM RTEQH", "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RTEQH", "LXOTUT", "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RPQRPTQUSTURVPUOSPQ", "Pf"];
var glyph_data = [
  "JZ",
  "MWRYSZR[QZRYR[ RRSQGRFSGRSRF",
  "JZNFNJ RVFVJ",
  "H]LM[M RRDL_ RYVJV RS_YD",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RRCR^",
  "F^J[ZF RMFOGPIOKMLKKJIKGMF RYZZXYVWUUVTXUZW[YZ",
  "E_[[Z[XZUWPQNNMKMINGPFQFSGTITJSLRMLQKRJTJWKYLZN[Q[SZTYWUXRXP",
  "MWSFQJ",
  "KYVcUbS_R]QZPUPQQLRISGUDVC",
  "KYNcObQ_R]SZTUTQSLRIQGODNC",
  "JZRFRK RMIRKWI ROORKUO",
  "E_JSZS RR[RK",
  "MWSZS[R]Q^",
  0,
  "MWRYSZR[QZRYR[",
  1,
  "H\\QFSFUGVHWJXNXSWWVYUZS[Q[OZNYMWLSLNMJNHOGQF",
  "H\\X[L[ RR[RFPINKLL",
  "H\\LHMGOFTFVGWHXJXLWOK[X[",
  2,
  "H\\VMV[ RQELTYT",
  "H\\WFMFLPMOONTNVOWPXRXWWYVZT[O[MZLY",
  "H\\VFRFPGOHMKLOLWMYNZP[T[VZWYXWXRWPVOTNPNNOMPLR",
  "H\\KFYFP[",
  "H\\PONNMMLKLJMHNGPFTFVGWHXJXKWMVNTOPONPMQLSLWMYNZP[T[VZWYXWXSWQVPTO",
  "H\\N[R[TZUYWVXRXJWHVGTFPFNGMHLJLOMQNRPSTSVRWQXO",
  "MWRYSZR[QZRYR[ RRNSORPQORNRP",
  "MWSZS[R]Q^ RRNSORPQORNRP",
  "E_ZMJSZY",
  "E_JPZP RZVJV",
  "E_JMZSJY",
  "I[QYRZQ[PZQYQ[ RMGOFTFVGWIWKVMUNSORPQRQS",
  "D_VQUPSOQOOPNQMSMUNWOXQYSYUXVW RVOVWWXXXZW[U[PYMVKRJNKKMIPHTIXK[N]R^V]Y[",
  3,
  4,
  5,
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[",
  6,
  "HZTPMP RM[MFWF",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR",
  7,
  8,
  "JZUFUUTXRZO[M[",
  9,
  "HYW[M[MF",
  10,
  "G]L[LFX[XF",
  11,
  12,
  "G]Z]X\\VZSWQVOV RP[NZLXKTKMLINGPFTFVGXIYMYTXXVZT[P[",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG",
  13,
  "G]LFLWMYNZP[T[VZWYXWXF",
  "I[KFR[YF",
  "F^IFN[RLV[[F",
  14,
  15,
  "H\\KFYFK[Y[",
  "KYVbQbQDVD",
  "KYID[_",
  "KYNbSbSDND",
  "LXNHREVH",
  "JZJ]Z]",
  16,
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR",
  "H[M[MF RMNOMSMUNVOWQWWVYUZS[O[MZ",
  17,
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT",
  "MYOMWM RR[RISGUFWF",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN",
  "H[M[MF RV[VPUNSMPMNNMO",
  "MWR[RM RRFQGRHSGRFRH",
  18,
  "IZN[NF RPSV[ RVMNU",
  "MXU[SZRXRF",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[",
  "I\\NMN[ RNOONQMTMVNWPW[",
  19,
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ",
  "I\\WMWb RWZU[Q[OZNYMWMQNOONQMUMWN",
  "KXP[PM RPQQORNTMVM",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN",
  "MYOMWM RRFRXSZU[W[",
  "H[VMV[ RMMMXNZP[S[UZVY",
  20,
  21,
  "IZL[WM RLMW[",
  "JZMMR[ RWMR[P`OaMb",
  "IZLMWML[W[",
  "KYVcUcSbR`RVQTOSQRRPRFSDUCVC",
  22,
  "KYNcOcQbR`RVSTUSSRRPRFQDOCNC",
  "KZMSNRPQTSVRWQ",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "JZ",
  "MWROQNRMSNRORM RRUSaRbQaRURb",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RRJR^",
  "H[LMTM RL[W[ RO[OIPGRFUFWG",
  "H]LYOV RLLOO RVVYY RVOYL RVVTWQWOVNTNQOOQNTNVOWQWTVV",
  "F^JTZT RJMZM RRQR[ RKFRQYF",
  "MWRbRW RRFRQ",
  "I[N]P^S^U]V[UYOSNQNPONQM RVGTFQFOGNIOKUQVSVTUVSW",
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH",
  "@dVKTJPJNKLMKOKSLUNWPXTXVW RRCMDHGELDQEVH[M^R_W^\\[_V`Q_L\\GWDRC",
  "KZOEQDSDUEVGVN RVMTNQNOMNKOIQHVH",
  "H\\RMLSRY RXWTSXO",
  "E_JQZQZV",
  24,
  "@dWXRR RNXNJTJVKWMWOVQTRNR RRCMDHGELDQEVH[M^R_W^\\[_V`Q_L\\GWDRC",
  "LXMGWG",
  "JZRFPGOIPKRLTKUITGRF",
  "E_JOZO RRWRG RZ[J[",
  "JZNAP@S@UAVCVEUGNNVN",
  "JZN@V@RESEUFVHVKUMSNPNNM",
  25,
  "H^MMMb RWXXZZ[ RMXNZP[T[VZWXWM",
  "F]VMV[ ROMOXNZL[ RZMMMKNJP",
  26,
  "MWR\\T]U_TaRbOb",
  "JZVNNN RNCPBR@RN",
  "KYQNOMNKNGOEQDSDUEVGVKUMSNQN",
  "H\\RMXSRY RLWPSLO",
  "G]KQYQ RVNNN RNCPBR@RN RUYUa RQSN]W]",
  "G]KQYQ RVNNN RNCPBR@RN RNTPSSSUTVVVXUZNaVa",
  "G]KQYQ RN@V@RESEUFVHVKUMSNPNNM RUYUa RQSN]W]",
  "I[SORNSMTNSOSM RWaUbPbNaM_M]N[OZQYRXSVSU",
  "I[MUWU RK[RFY[ RP>SA",
  "I[MUWU RK[RFY[ RT>QA",
  "I[MUWU RK[RFY[ RNAR>VA",
  "I[MUWU RK[RFY[ RMAN@P?TAV@W?",
  "I[MUWU RK[RFY[ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "I[MUWU RK[RFY[ RRFPEOCPAR@TAUCTERF",
  "F`JURU RRPYP RH[OF\\F RRFR[\\[",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RR\\T]U_TaRbOb",
  "H[MPTP RW[M[MFWF RP>SA",
  "H[MPTP RW[M[MFWF RT>QA",
  "H[MPTP RW[M[MFWF RNAR>VA",
  "H[MPTP RW[M[MFWF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "MWR[RF RP>SA",
  "MWR[RF RT>QA",
  "MWR[RF RNAR>VA",
  27,
  28,
  "G]L[LFX[XF RMAN@P?TAV@W?",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RP>SA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RT>QA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RNAR>VA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RMAN@P?TAV@W?",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "E_LMXY RXMLY",
  "G]ZFJ[ RP[NZLXKTKMLINGPFTFVGXIYMYTXXVZT[P[",
  "G]LFLWMYNZP[T[VZWYXWXF RP>SA",
  "G]LFLWMYNZP[T[VZWYXWXF RT>QA",
  "G]LFLWMYNZP[T[VZWYXWXF RNAR>VA",
  "G]LFLWMYNZP[T[VZWYXWXF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "I[RQR[ RKFRQYF RT>QA",
  "G\\LFL[ RLKTKVLWMXOXRWTVUTVLV",
  "F]K[KJLHMGOFRFTGUHVJVMSMQNPPPQQSSTVTXUYWYXXZV[R[PZ",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RPESH",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RTEQH",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNHREVH",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RMHNGPFTHVGWF",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RRHPGOEPCRBTCUETGRH",
  "D`INKMOMQNRP R[ZY[U[SZRXRPSNUMYM[N\\P\\RRSKSITHVHXIZK[O[QZRX",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RR\\T]U_TaRbOb",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RPESH",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RTEQH",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNHREVH",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "MWR[RM RPESH",
  "MWR[RM RTEQH",
  "LXNHREVH RR[RM",
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH RR[RM",
  "I\\SCQI RWNUMQMONNOMQMXNZP[T[VZWXWLVITGRFNE",
  "I\\NMN[ RNOONQMTMVNWPW[ RMHNGPFTHVGWF",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RPESH",
  29,
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNHREVH",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMHNGPFTHVGWF",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "E_ZSJS RRXSYRZQYRXRZ RRLSMRNQMRLRN",
  "H[XMK[ RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[",
  "H[VMV[ RMMMXNZP[S[UZVY RPESH",
  "H[VMV[ RMMMXNZP[S[UZVY RTEQH",
  "H[VMV[ RMMMXNZP[S[UZVY RNHREVH",
  "H[VMV[ RMMMXNZP[S[UZVY RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "JZMMR[ RWMR[P`OaMb RTEQH",
  "H[MFMb RMNOMSMUNVOWQWWVYUZS[O[MZ",
  "JZMMR[ RWMR[P`OaMb RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I[MUWU RK[RFY[ RM@W@",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RMGWG",
  30,
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE",
  "I[MUWU RK[RFY[ RY[W]V_WaYb[b",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RW[U]T_UaWbYb",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RT>QA",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RTEQH",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RNAR>VA",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RNHREVH",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RR?Q@RAS@R?RA",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RRFQGRHSGRFRH",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RN>RAV>",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RNERHVE",
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RN>RAV>",
  "IfW[WF RWZU[Q[OZNYMWMQNOONQMUMWN RbF`J",
  28,
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RRHZH",
  "H[MPTP RW[M[MFWF RM@W@",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RMGWG",
  "H[MPTP RW[M[MFWF RN>O@QASAU@V>",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNEOGQHSHUGVE",
  "H[MPTP RW[M[MFWF RR?Q@RAS@R?RA",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RRFQGRHSGRFRH",
  "H[MPTP RW[M[MFWF RR[P]O_PaRbTb",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RR[P]O_PaRbTb",
  "H[MPTP RW[M[MFWF RN>RAV>",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNERHVE",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RNAR>VA",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RNHREVH",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RN>O@QASAU@V>",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RNEOGQHSHUGVE",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RR?Q@RAS@R?RA",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RRFQGRHSGRFRH",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RR\\T]U_TaRbOb",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RRGPFODPBRAUA",
  "G]L[LF RLPXP RX[XF RNAR>VA",
  "H[M[MF RV[VPUNSMPMNNMO RIAM>QA",
  "G]IJ[J RL[LF RLPXP RX[XF",
  "H[M[MF RV[VPUNSMPMNNMO RJHRH",
  "MWR[RF RMAN@P?TAV@W?",
  "MWR[RM RMHNGPFTHVGWF",
  "MWR[RF RM@W@",
  "MWR[RM RMGWG",
  "MWR[RF RN>O@QASAU@V>",
  "MWR[RM RNEOGQHSHUGVE",
  "MWR[RF RR[P]O_PaRbTb",
  "MWR[RM RR[P]O_PaRbTb",
  "MWR[RF RR?Q@RAS@R?RA",
  "MWR[RM",
  "MgR[RF RbFbUaX_Z\\[Z[",
  "MaR[RM RRFQGRHSGRFRH R\\M\\_[aYbXb R\\F[G\\H]G\\F\\H",
  "JZUFUUTXRZO[M[ RQAU>YA",
  "MWRMR_QaObNb RNHREVH",
  "G\\L[LF RX[OO RXFLR RR\\T]U_TaRbOb",
  "IZN[NF RPSV[ RVMNU RR\\T]U_TaRbOb",
  31,
  "HYW[M[MF RO>LA",
  "MXU[SZRXRF RTEQH",
  "HYW[M[MF RR\\T]U_TaRbOb",
  "MXU[SZRXRF RR\\T]U_TaRbOb",
  "HYW[M[MF RVHSK",
  "M^U[SZRXRF RZFXJ",
  "HYW[M[MF RUNTOUPVOUNUP",
  "M\\U[SZRXRF RYOZPYQXPYOYQ",
  "HYW[M[MF RJQPM",
  "MXU[SZRXRF ROQUM",
  "G]L[LFX[XF RT>QA",
  "I\\NMN[ RNOONQMTMVNWPW[ RTEQH",
  "G]L[LFX[XF RR\\T]U_TaRbOb",
  "I\\NMN[ RNOONQMTMVNWPW[ RR\\T]U_TaRbOb",
  "G]L[LFX[XF RN>RAV>",
  "I\\NMN[ RNOONQMTMVNWPW[ RNERHVE",
  "MjSFQJ R\\M\\[ R\\O]N_MbMdNePe[",
  "G]LFL[ RLINGPFTFVGWHXJX^W`VaTbQb",
  "I\\NMN[ RNOONQMTMVNWPW_VaTbRb",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RM@W@",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMGWG",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RN>O@QASAU@V>",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNEOGQHSHUGVE",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RQ>NA RX>UA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RQENH RXEUH",
  "E`RPYP RRFR[ R\\FNFLGJIIMITJXLZN[\\[",
  "C`[ZY[U[SZRXRPSNUMYM[N\\P\\RRT RRQQOPNNMKMINHOGQGWHYIZK[N[PZQYRW",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RT>QA",
  "KXP[PM RPQQORNTMVM RTEQH",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RR\\T]U_TaRbOb",
  "KXP[PM RPQQORNTMVM RR\\T]U_TaRbOb",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RN>RAV>",
  "KXP[PM RPQQORNTMVM RNERHVE",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RT>QA",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RTEQH",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RNAR>VA",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RNHREVH",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RR\\T]U_TaRbOb",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RR\\T]U_TaRbOb",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RN>RAV>",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RNERHVE",
  "JZLFXF RR[RF RR\\T]U_TaRbOb",
  "MYOMWM RRFRXSZU[W[ RR\\T]U_TaRbOb",
  "JZLFXF RR[RF RN>RAV>",
  "M[OMWM RYFXI RRFRXSZU[W[",
  "JZLFXF RR[RF RNQVQ",
  "MYOMWM RRFRXSZU[W[ ROSUS",
  "G]LFLWMYNZP[T[VZWYXWXF RMAN@P?TAV@W?",
  "H[VMV[ RMMMXNZP[S[UZVY RMHNGPFTHVGWF",
  "G]LFLWMYNZP[T[VZWYXWXF RM@W@",
  "H[VMV[ RMMMXNZP[S[UZVY RMGWG",
  "G]LFLWMYNZP[T[VZWYXWXF RN>O@QASAU@V>",
  "H[VMV[ RMMMXNZP[S[UZVY RNEOGQHSHUGVE",
  "G]LFLWMYNZP[T[VZWYXWXF RRAP@O>P<R;T<U>T@RA",
  "H[VMV[ RMMMXNZP[S[UZVY RRHPGOEPCRBTCUETGRH",
  "G]LFLWMYNZP[T[VZWYXWXF RQ>NA RX>UA",
  "H[VMV[ RMMMXNZP[S[UZVY RQENH RXEUH",
  "G]LFLWMYNZP[T[VZWYXWXF RR[P]O_PaRbTb",
  "H[VMV[ RMMMXNZP[S[UZVY RV[T]S_TaVbXb",
  "F^IFN[RLV[[F RNAR>VA",
  "G]JMN[RQV[ZM RNHREVH",
  "I[RQR[ RKFRQYF RNAR>VA",
  "JZMMR[ RWMR[P`OaMb RNHREVH",
  "JZLFXF RR[RF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "H\\KFYFK[Y[ RT>QA",
  "IZLMWML[W[ RTEQH",
  "H\\KFYFK[Y[ RR?Q@RAS@R?RA",
  "IZLMWML[W[ RRFQGRHSGRFRH",
  "H\\KFYFK[Y[ RN>RAV>",
  "IZLMWML[W[ RNERHVE",
  "MYR[RISGUFWF",
  "H[M[MF RMNOMSMUNVOWQWWVYUZS[O[MZ RJHRH",
  "C\\LFL[T[VZWYXWXTWRVQSPLP RFKFIGGIFSFUGVHWJWLVNUOSP",
  "G\\VFLFL[R[UZWXXVXSWQUORNLN",
  "H[WFMFM[ RMNOMSMUNVOWQWWVYUZS[O[MZ",
  "H]MFM[S[VZXXYVYSXQVOSNMN",
  "IZNMN[S[UZVXVUUSSRNR",
  "I^MHNGQFSFVGXIYKZOZRYVXXVZS[Q[NZMY",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RMHKGJEKCLB",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RTMTIUGWFYF",
  28,
  "C\\FKFIGGIFQFTGVIWKXOXRWVVXTZQ[L[LF",
  "H]NFXFX[R[OZMXLVLSMQOORNXN",
  "I\\MFWFW[ RWNUMQMONNOMQMWNYOZQ[U[WZ",
  "I\\Q[T[VZWYXWXQWOVNTMQMONNOMQMWNYOZQ[T\\V]W_VaTbPbNa",
  "I\\WPPP RM[W[WFMF",
  "F^MHNGQFSFVGXIYKZOZRYVXXVZS[Q[NZLXKVJRZP",
  "G[PPTP RWGUFPFNGMHLJLLMNNOPPMQLRKTKWLYMZO[U[WZ",
  "HZTPMP RM[MFWF RM[M_LaJbHb",
  "MYOMWM RR[RISGUFWF RR[R_QaObMb",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RMHKGJEKCLB",
  "I[KFU[U_TaRbPaO_O[YF",
  "D`I[IF RIOJNLMOMQNRPRXSZU[X[ZZ[Y\\W\\P[NZM",
  "MZRFRWSYTZV[X[",
  "MWR[RF RNPVP",
  "G_L[LF RX[OO RLRWGYF[G\\I\\K",
  "IZNMN[ RPSV[ RVMNU RNMNIOGQFSF",
  "MXU[SZRXRF RNOVO",
  "JZRMM[ RMFOFPGRMW[ RNLTH",
  "Ca\\F\\[ R\\XZZX[V[TZSYRWRF RRWQYPZN[L[JZIYHWHF",
  "G]L[LFX[XF RL[L_KaIbGb",
  "I\\NMN[ RNOONQMTMVNWPWb",
  32,
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RVGXFYDXBWA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUNWMXKWIVH",
  "DaSGQFMFKGIIHMHTIXKZM[Q[SZUXVTVMUISGUFYF[G\\I\\b",
  "E^RNPMMMKNJOIQIWJYKZM[P[RZSYTWTQSORNTMVMXNYPYb",
  "C\\LFL[ RFKFIGGIFTFVGWHXJXMWOVPTQLQ",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ RRMRISGUFWF",
  "G\\LFL[ RQVXb RLKTKVLWMXOXRWTVUTVLV",
  "H\\XZU[P[NZMYLWLUMSNRPQTPVOWNXLXJWHVGTFOFLG",
  "IZVZT[P[NZMXMWNUPTSTUSVQVPUNSMPMNN",
  "H[W[L[SPLFWF",
  "JYWbUbSaR_RIQGOFMGLIMKOLQKRI",
  "MYOMWM RRFRXSZU[W[ RW[W_VaTbRb",
  "HZR[RF RKKKILGNFXF",
  "MYOMWM RWFUFSGRIRXSZU[W[",
  "JZLFXF RR[RF RR[R_SaUbWb",
  "G]LFLWMYNZP[T[VZWYXWXF RXFZE[CZAY@",
  "H[VMV[ RMMMXNZP[S[UZVY RVMXLYJXHWG",
  "F^ZFUFUJWKYMZPZUYXWZT[P[MZKXJUJPKMMKOJOFJF",
  "G]LFLWMYNZP[T[VZXXYVYIXGWF",
  "I`RQR[ RKFRQXGZF\\G]I]K",
  "J^MMR[ RMbOaP`R[VNXMZN[P[R",
  "H\\KFYFK[Y[ RNPVP",
  "IZLMWML[W[ RNTVT",
  2,
  "H\\YFLFSNPNNOMPLRLWMYNZP[V[XZYY",
  "JZWMNMUVRVPWOXNZN^O`PaRbUbWa",
  "JZMMVMOTSTUUVWVXUZS[Q[O\\N^N_OaQbVb",
  "H\\LHMGOFTFVGWHXJXLWOK[X[ RNSVS",
  "H\\WFMFLPMOONTNVOWPXRXWWYVZT[O[MZLY",
  "JZVMOMNSPRSRUSVUVXUZS[P[NZ",
  "J^MZP[T[WZYXZVZSYQWOTNPNPF RLITI",
  "H[MMMb RMONNPMTMVNWPWSVUM^",
  "MWRFRb",
  "JZOFOb RUFUb",
  "MWRFRb ROWUW ROQUQ",
  "MWRYSZR[QZRYR[ RRSQGRFSGRSRF",
  "GpL[LFQFTGVIWKXOXRWVVXTZQ[L[ R_FmF_[m[ Rb>fAj>",
  "GmL[LFQFTGVIWKXOXRWVVXTZQ[L[ R_MjM_[j[ RaEeHiE",
  "ImW[WF RWZU[Q[OZNYMWMQNOONQMUMWN R_MjM_[j[ RaEeHiE",
  "HiW[M[MF RdFdUcXaZ^[\\[",
  "HcW[M[MF R^M^_]a[bZb R^F]G^H_G^F^H",
  "MbU[SZRXRF R]M]_\\aZbYb R]F\\G]H^G]F]H",
  "GmL[LFX[XF RhFhUgXeZb[`[",
  "GgL[LFX[XF RbMb_aa_b^b RbFaGbHcGbFbH",
  "IfNMN[ RNOONQMTMVNWPW[ RaMa_`a^b]b RaF`GaHbGaFaH",
  "I[MUWU RK[RFY[ RN>RAV>",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNERHVE",
  "MWR[RF RN>RAV>",
  "MWR[RM RNERHVE",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RN>RAV>",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNERHVE",
  "G]LFLWMYNZP[T[VZWYXWXF RN>RAV>",
  "H[VMV[ RMMMXNZP[S[UZVY RNERHVE",
  "G]LFLWMYNZP[T[VZWYXWXF RN?O@NAM@N?NA RV?W@VAU@V?VA RM;W;",
  "H[VMV[ RMMMXNZP[S[UZVY RNFOGNHMGNFNH RVFWGVHUGVFVH RM@W@",
  "G]LFLWMYNZP[T[VZWYXWXF RN?O@NAM@N?NA RV?W@VAU@V?VA RT9Q<",
  "H[VMV[ RMMMXNZP[S[UZVY RNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  "G]LFLWMYNZP[T[VZWYXWXF RN?O@NAM@N?NA RV?W@VAU@V?VA RN9R<V9",
  "H[VMV[ RMMMXNZP[S[UZVY RNFOGNHMGNFNH RVFWGVHUGVFVH RN>RAV>",
  "G]LFLWMYNZP[T[VZWYXWXF RN?O@NAM@N?NA RV?W@VAU@V?VA RP9S<",
  "H[VMV[ RMMMXNZP[S[UZVY RNFOGNHMGNFNH RVFWGVHUGVFVH RP>SA",
  33,
  "I[MUWU RK[RFY[ RN?O@NAM@N?NA RV?W@VAU@V?VA RM;W;",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNFOGNHMGNFNH RVFWGVHUGVFVH RM@W@",
  "I[MUWU RK[RFY[ RR?Q@RAS@R?RA RM;W;",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RRFQGRHSGRFRH RM@W@",
  "F`JURU RRPYP RH[OF\\F RRFR[\\[ RO@Y@",
  "D`INKMOMQNRP R[ZY[U[SZRXRPSNUMYM[N\\P\\RRSKSITHVHXIZK[O[QZRX RMGWG",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RSV[V",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RS^[^",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RN>RAV>",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RNERHVE",
  "G\\L[LF RX[OO RXFLR RN>RAV>",
  "IZN[NF RPSV[ RVMNU RJANDRA",
  "G]R[P]O_PaRbTb RPFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF",
  "H[R[P]O_PaRbTb RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[",
  "G]R[P]O_PaRbTb RPFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RM@W@",
  "H[R[P]O_PaRbTb RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMGWG",
  "H\\KFXFQNTNVOWPXRXWWYVZT[N[LZKY RN>RAV>",
  "JZMMVMOVRVTWUXVZV^U`TaRbObMa RNERHVE",
  "MWRMR_QaObNb RNERHVE",
  "GpL[LFQFTGVIWKXOXRWVVXTZQ[L[ R_FmF_[m[",
  "GmL[LFQFTGVIWKXOXRWVVXTZQ[L[ R_MjM_[j[",
  "ImW[WF RWZU[Q[OZNYMWMQNOONQMUMWN R_MjM_[j[",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RT>QA",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RTEQH",
  "CaH[HF RHPTP RTFTXUZW[Z[\\Z]X]M",
  "G\\LFLb RLINGPFTFVGWHXJXOWRUUL^",
  "G]L[LFX[XF RP>SA",
  "I\\NMN[ RNOONQMTMVNWPW[ RPESH",
  "I[MUWU RK[RFY[ RZ9X< RR;P<O>P@RAT@U>T<R;",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RZ@XC RRBPCOEPGRHTGUETCRB",
  "F`JURU RRPYP RH[OF\\F RRFR[\\[ RV>SA",
  "D`INKMOMQNRP R[ZY[U[SZRXRPSNUMYM[N\\P\\RRSKSITHVHXIZK[O[QZRX RTEQH",
  "G]ZFJ[ RP[NZLXKTKMLINGPFTFVGXIYMYTXXVZT[P[ RT>QA",
  "H[XMK[ RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RTEQH",
  "I[MUWU RK[RFY[ ROAL> RVAS>",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR ROHLE RVHSE",
  "I[MUWU RK[RFY[ RNAO?Q>S>U?VA",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNHOFQESEUFVH",
  "H[MPTP RW[M[MFWF ROAL> RVAS>",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT ROHLE RVHSE",
  "H[MPTP RW[M[MFWF RNAO?Q>S>U?VA",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNHOFQESEUFVH",
  "MWR[RF ROAL> RVAS>",
  "MWR[RM ROHLE RVHSE",
  "MWR[RF RNAO?Q>S>U?VA",
  "MWR[RM RNHOFQESEUFVH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF ROAL> RVAS>",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ ROHLE RVHSE",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RNAO?Q>S>U?VA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNHOFQESEUFVH",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ ROAL> RVAS>",
  "KXP[PM RPQQORNTMVM RPHME RWHTE",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RNAO?Q>S>U?VA",
  "KXP[PM RPQQORNTMVM ROHPFRETEVFWH",
  "G]LFLWMYNZP[T[VZWYXWXF ROAL> RVAS>",
  "H[VMV[ RMMMXNZP[S[UZVY ROHLE RVHSE",
  "G]LFLWMYNZP[T[VZWYXWXF RNAO?Q>S>U?VA",
  "H[VMV[ RMMMXNZP[S[UZVY RNHOFQESEUFVH",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RS`SaRcQd",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RS`SaRcQd",
  "JZLFXF RR[RF RS`SaRcQd",
  "MYOMWM RRFRXSZU[W[ RU`UaTcSd",
  "I]VRXTYVY[X]V_T`Lb RLHMGOFUFWGXHYJYNXPVRTSNU",
  "J[UWVXWZW]V_U`SaMb RMNOMSMUNVOWQWTVVUWSXOY",
  "G]L[LF RLPXP RX[XF RN>RAV>",
  "H[M[MF RV[VPUNSMPMNNMO RI>MAQ>",
  "G]L[LFX[XF RX[Xb",
  "IbWFWXXZZ[\\[^Z_X^V\\UZVV^ RWNUMQMONNOMQMWNYOZQ[T[VZWX",
  "G]NFLGKIKKLMMNOO RVFXGYIYKXMWNUO ROOUOWPXQYSYWXYWZU[O[MZLYKWKSLQMPOO",
  "J[MJMMNORQVOWMWJ RPQTQVRWTWXVZT[P[NZMXMTNRPQ",
  "H\\KFYFK[Y[ RY[Y_XaVbTb",
  "IZLMWML[W[ RW[W_VaTbRb",
  "I[MUWU RK[RFY[ RR?Q@RAS@R?RA",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RRFQGRHSGRFRH",
  "H[MPTP RW[M[MFWF RR\\T]U_TaRbOb",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RR\\T]U_TaRbOb",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RN?O@NAM@N?NA RV?W@VAU@V?VA RM;W;",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNFOGNHMGNFNH RVFWGVHUGVFVH RM@W@",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RMAN@P?TAV@W? RM;W;",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMHNGPFTHVGWF RM@W@",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RR?Q@RAS@R?RA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RRFQGRHSGRFRH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RR?Q@RAS@R?RA RM;W;",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RRFQGRHSGRFRH RM@W@",
  "I[RQR[ RKFRQYF RM@W@",
  "JZMMR[ RWMR[P`OaMb RMGWG",
  "M]RFRXSZU[W[YZZXYVWUUVQ^",
  "IbNMN[ RNOONQMTMVNWPWXXZZ[\\[^Z_X^V\\UZVV^",
  "M]OMWM RRFRXSZU[W[YZZXYVWUUVQ^",
  "MWRMR_QaObNb",
  "D`R[RF RRZP[L[JZIYHWHQIOJNLMPMRN RTMXMZN[O\\Q\\W[YZZX[T[RZ",
  "D`RMRb RRZP[L[JZIYHWHQIOJNLMPMRN RTMXMZN[O\\Q\\W[YZZX[T[RZ",
  "I[MUWU RK[RFY[ RXCL`",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RXCL`",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RWHM`",
  "HYW[M[MF RIOQO",
  "JZLFXF RR[RF RXCL`",
  "J[P[R^T_W_ RNZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN",
  "IZLMWML[N[P\\R^T_W_",
  "J^MGPFTFWGYIZKZNYPWRTSPSP[",
  "J^NNPMTMVNWOXQXSWUVVTWPWP[",
  "G\\SPVQWRXTXWWYVZT[L[LFSFUGVHWJWLVNUOSPLP RIUOU",
  "G]IM[M RLFLWMYNZP[T[VZWYXWXF",
  "I[Y[RFK[",
  "H[MPTP RW[M[MFWF RXCL`",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RWHM`",
  "JZUFUUTXRZO[M[ RQPYP",
  "MWRMR_QaObNb ROTUT RRFQGRHSGRFRH",
  "G]XFX^Y`Za\\b^b RXIVGTFPFNGLIKMKTLXNZP[T[VZXX",
  "I\\WMW^X`Ya[b]b RWZU[Q[OZNYMWMQNOONQMUMWN",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RIQOQ",
  "KXP[PM RPQQORNTMVM RMTUT",
  "I[KIYI RRQR[ RKFRQYF",
  "JZLQXQ RMMR[ RWMR[P`OaMb",
  "H[MMMXNZP[T[VZ RMNOMTMVNWPWRVTTUOUMV",
  34,
  "G\\K[NQOOPNRMTMVNWOXRXVWYVZT[R[PZOYNWMPLNJM",
  "H[RFPFNGMIM[ RMNOMSMUNVOWQWWVYUZS[O[MZ",
  "J\\NNPMTMVNWOXQXWWYVZT[P[NZ",
  "HZVNTMPMNNMOLQLWMYNZP[S[UZVXUVSUQVM^",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RW[W_XaZb\\b",
  "I\\\\FZFXGWIW[ RWZU[Q[OZNYMWMQNOONQMUMWN",
  "I[NZP[T[VZWXWPVNTMPMNNMPMRWT",
  33,
  "IbNNPMTMVNWPWXVZT[P[NZMXMV\\S\\U]W_X`X",
  35,
  "J[TTVSWQWPVNTMPMNN RRTTTVUWWWXVZT[P[NZ",
  "JaRTTTVUWWWXVZT[P[NZ RNNPMTMVNWPWQVSTT[S[U\\W^X_X",
  "H[TTVSWQWPVNTMPMNNMOLRLVMYNZP[T[VZWXWWVUTTRT",
  "MWRMR_QaObNb ROTUT",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RWMWIXGZF\\F",
  "I\\WYVZT[P[NZMXMQNOONQMWMW^V`UaSbMb",
  "HZUNSMPMNNMOLQLWMYNZP[T[VZVUSU",
  "JZMMU[U_TaRbPaO_O[WM",
  "JZMMTVUXTZR[PZOXPVWM",
  "I\\WMWb RNMNXOZQ[T[VZWY",
  "H[RFPFNGMIM[ RV[VPUNSMPMNNMO",
  "H[RFPFNGMIM[ RV[VPUNSMPMNNMO RV[V_UaSbQb",
  "MWR[RM ROTUT RRFQGRHSGRFRH",
  36,
  "MWR[RM RU[O[ RUMOM",
  "MXU[SZRXRF RMONNPMTOVNWM",
  "IYU[SZRXRF RRQQOONMOLQMSOTWT",
  "MXRFR_SaUbWb",
  "GZLFLXMZO[ RLMVMOVRVTWUXVZV^U`TaRbObMa",
  "D`[M[[ R[YZZX[U[SZRXRM RRXQZO[L[JZIXIM",
  "D`[M[[ R[YZZX[U[SZRXRM RRXQZO[L[JZIXIM R[[[b",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[ R[[[_ZaXbVb",
  "I\\NMN[ RNOONQMTMVNWPW[ RN[N_MaKbIb",
  "I\\NMN[ RNOONQMTMVNWPW[ RW[W_XaZb\\b",
  "H[M[MMV[VM",
  37,
  "E]RTXT RRMR[ RZMMMKNJOIQIWJYKZM[Z[",
  "G]RTRXSZU[V[XZYXYQXOWNUMOMMNLOKQKXLZN[O[QZRX",
  38,
  "LYTMT[ RTWSYRZP[N[",
  "LYTMT[ RTWSYRZP[N[ RTMTF",
  "LYTMT[ RTWSYRZP[N[ RT[T_UaWbYb",
  "KXP[PM RPQQORNTMVM RP[Pb",
  "KXP[PM RPQQORNTMVM RP[P_QaSbUb",
  "KXM[S[ RVMTMRNQOPRP[",
  "LYW[Q[ RNMPMRNSOTRT[",
  "I[RUW[ RN[NMTMVNWPWRVTTUNU",
  "I[RSWM RNMN[T[VZWXWVVTTSNS",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RN[N_OaQbSb",
  "KYWFUFSGRIR_QaObMb",
  "MWRMR_QaObNb ROTUT RRMRISGUFWF",
  "KYMFOFQGRIRXSZU[W[",
  "KYWFUFSGRIR_QaObMaL_M]O\\V\\",
  "KWU[M[ RRbRPQNOMMM",
  "MYOMWM RRFR_SaUbWb",
  "H[JRYR RVMV[ RMMMXNZP[S[UZVY",
  "I\\XMUMUPWRXTXWWYVZT[Q[OZNYMWMTNRPPPMMM",
  "H[MMMXNZP[S[UZVYWWWPVNUM",
  "JZW[RMM[",
  "G]Z[VMRWNMJ[",
  "JZW[RM RM[RMTHUGWF",
  "KYRTR[ RMMRTWM",
  "IZLMWML[W[ RW[W_XaZb\\b",
  "IZLMWML[T[VZWXVVTURVN^",
  "JZMMVMOVRVTWUXVZV^U`TaRbObMa",
  "JZMMVMOVRVTWUXVZV^U`TaRbPbNaM_N]P\\R]Uc",
  "J^MGPFTFWGYIZKZNYPWRTSPSP[",
  "FZWGTFPFMGKIJKJNKPMRPSTST[",
  "J^MZP[T[WZYXZVZSYQWOTNPNPF",
  "F[WHVGSFQFNGLIKKJOJYK]L_NaQbSbVaW`",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RROQPRQSPRORQ",
  "I[STVUWWWXVZT[N[NMSMUNVPVQUSSTNT",
  "I\\PTNUMWMXNZP[T[VZWYXVXRWOVNTMPMNNMPMQNSPTRT",
  "HZUNSMPMNNMOLQLWMYNZP[T[VZVUSU RUMUIVGXFZF",
  "H[MTVT RMMM[ RVMV[",
  "LXRMR_QaObMaL_M]O\\V\\ RRFQGRHSGRFRH",
  "J[VMVb RTUNM RN[VS",
  "JYOMO[V[",
  "I\\WMWb RWZU[Q[OZNYMWMQNOONQMUMWN RWMWIXGZF\\F",
  "J^MGPFTFWGYIZKZNYPWRTSPSP[ RLXTX",
  "FZWGTFPFMGKIJKJNKPMRPSTST[ RPXXX",
  "D`R[RF RRM]MR[][ RRZP[L[JZIYHWHQIOJNLMPMRN",
  "E`RFR[ RRNPMMMKNJOIQIWJYKZM[P[RZ RRM\\MUVXVZW[X\\Z\\^[`ZaXbUbSa",
  "D`R[RF RRM]MR[Z[\\Z]X\\VZUXVT^ RRZP[L[JZIYHWHQIOJNLMPMRN",
  "G^IMQM RLFLXMZO[QZS[W[YZZXZWYUWTTTRSQQQPRNTMWMYN",
  "I[KMTM RNFNXOZQ[T[ RYFWFUGTIT_SaQbOb",
  "F^HMPM RKFKXLZN[P[RZ RZNXMTMRNQOPQPWQYRZT[W[YZZXYVWUUVQ^",
  "F]HMPMP[ RK[KILGNFPF RPOQNSMVMXNYPY_XaVbTb",
  "G^LFLXMZO[QZS[W[YZZXZWYUWTTTRSQQQPRNTMWMYN",
  "H^MM[MP[ RMFMXNZP[[[",
  "G]JSN[RUV[ZS RJFNNRHVNZF",
  "G]XXXSLSLX RXKXFLFLK",
  "I\\WMWb RNMNXOZQ[T[VZWY RNMNIMGKFIF",
  "I\\\\bZbXaW_WM RNMNXOZQ[T[VZWY RNMNIMGKFIF",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "H[MFM[ RXPMP",
  "IZNTVT RNMN[",
  "G]R[RF RKOKFYFYO",
  "I[R[RF RMOMFWFWO",
  "MWSFQJ",
  "MWS[Q_",
  "G]LFL[XFX[",
  "H\\MMM[WMW[",
  23,
  23,
  "NVR`RcSdTd",
  "J\\NZP[T[VZWYXWXQWOVNTMPMNN",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RRSQTRUSTRSRU",
  "J\\NZP[T[VZWYXWXQWOVNTMPMNN RRSQTRUSTRSRU",
  "MWSZS[R]Q^ RRNSORPQORNRP",
  23,
  23,
  23,
  23,
  23,
  25,
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  "G[MUWU RK[RFY[ RMEJH",
  26,
  "B[MPTP RW[M[MFWF RHEEH",
  "A]L[LF RLPXP RX[XF RGEDH",
  "GWR[RF RMEJH",
  24,
  "B]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RHEEH",
  24,
  "@[RQR[ RKFRQYF RFECH",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RFECH",
  "MXRMRXSZU[ RNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  3,
  4,
  "HZM[MFXF",
  "I[K[RFY[K[",
  6,
  "H\\KFYFK[Y[",
  7,
  "F^OPUP RPFTFVGXIYKZNZSYVXXVZT[P[NZLXKVJSJNKKLINGPF",
  8,
  9,
  "I[K[RFY[",
  10,
  "G]L[LFX[XF",
  "H[L[W[ RLFWF RUPNP",
  11,
  "G]L[LFXFX[",
  12,
  24,
  "H[W[L[SPLFWF",
  13,
  15,
  "G]R[RF RPITIWJYLZNZRYTWVTWPWMVKTJRJNKLMJPI",
  14,
  "G]R[RF RHFJGKIKNLQMROSUSWRXQYNYIZG\\F",
  "F^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[",
  27,
  "I[RQR[ RKFRQYF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  39,
  40,
  41,
  42,
  "H[MMMXNZP[S[UZVYWWWPVNUM RNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  34,
  "H[SOUPVQWSWWVYUZS[P[NZMY RKbLaM_MINGPFSFUGVIVLUNSOQO",
  "JZRYRb RLMMMNNRYWM",
  "H[SMPMNNMOLQLWMYNZP[S[UZVYWWWQVOUNSMPLNKMINGPFTFVG",
  35,
  "HZMFWFPMNPMSMWNYOZQ[S[U\\V^V_UaSbRb",
  "I\\NMN[ RNOONQMTMVNWPWb",
  "H[LPWP RPFSFUGVHWKWVVYUZS[P[NZMYLVLKMHNGPF",
  36,
  31,
  "JZRMM[ RMFOFPGRMW[",
  "H^MMMb RWXXZZ[ RMXNZP[T[VZWXWM",
  "J[MMR[WPWOVM",
  "HZMFWF RQFOGNINLONQOUO RQOOPNQMSMWNYOZQ[S[U\\V^V_UaSbRb",
  19,
  "F]VMV[ ROMOXNZL[ RZMMMKNJP",
  "H\\MbMQNOONQMTMVNWOXQXWWYVZT[Q[OZMX",
  "HZVNTMPMNNMOLQLWMYNZP[S[U\\V^V_UaSb",
  "H\\YMPMNNMOLQLWMYNZP[S[UZVYWWWQVOUNSM",
  "H\\LPMNOMXM RRMRXSZU[",
  "H[MMMXNZP[S[UZVYWWWPVNUM",
  "G]MMLNKPKVLXNZP[T[VZXXYVYPXNVMUMSNRPRb",
  "IZWMLb RLMNNOPT_UaWb",
  "G]RMRb RKMKVLXNZP[T[VZXXYVYM",
  43,
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH RRMRXSZU[",
  "H[MMMXNZP[S[UZVYWWWPVNUM RNFOGNHMGNFNH RVFWGVHUGVFVH",
  29,
  44,
  45,
  "G\\L[LF RXFLR ROOX[Qb",
  "H[SOUPVQWSWWVYUZS[P[NZMXMINGPFSFUGVIVLUNSOQO",
  "H[JPKQLSLVMYNZP[S[UZVYWVWKVHUGSFPFNGMHLJLLMNNOPPWP",
  "I\\KFMFOGQIRKR[ RRKSHTGVFWFYGZI",
  "NiTEQH RXFZF\\G^I_K_[ R_K`HaGcFdFfGgI",
  "I\\KFMFOGQIRKR[ RRKSHTGVFWFYGZI RN?O@NAM@N?NA RV?W@VAU@V?VA",
  38,
  "F^RTRX R[MIM RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM",
  "IZLMNNOPOXNZM[LZLXMVVRWPWNVMUNTPTXUZW[V^U`TaRb",
  "G]R[Rb RPFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF",
  "H[R[Rb RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[",
  "FZWFQFNGLIKKJOJRKVLXNZQ[R[T\\U^U_TaSbQb",
  "HZVMPMNNMOLQLWMYNZP[R[T\\U^U_TaRbPb",
  "HZTPMP RM[MFWF",
  "MZVPRP RWFUFSGRIR_QaOb",
  "H\\MFOGPILSXNTXUZW[",
  "I[RFMPWPR[",
  "H\\NGNL RXIULTNTW RKIMGPFTFVGXIYKZOZUYYX[",
  "H\\L[UR RR[WV RLMPNSPURWVXZXb",
  "CaRWRR R\\XY]V`SaMa RLFJGHIGLGUHXJZL[N[PZQYRWSYTZV[X[ZZ\\X]U]L\\IZGXF",
  "G]RTRX RXZW\\S`PaOa RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM",
  "G]XFXb RPFNGLIKMKTLXNZP[T[VZXX",
  "I\\WMWb RQMONNOMQMWNYOZQ[T[VZWY",
  "F]KFK[ RKQMOPNTNVOXQYTYWXZW\\U^R`Nb",
  "I[WLWMVPTRRSPSNRMPMONMPLRLTMVPWSWWVYUZS[M[",
  "F]KHLGOFTFWGXHYJYLXOVQJ[N^Q_V_Y^",
  "J[NNPMTMVNWPWRVTTVN[P]R^U^W]",
  "G]I[[[ RIFJFLGXZZ[ R[FZFXGLZJ[",
  "H[KMMNVZX[K[MZVNXM",
  "G\\XEVFOFMGLHKJKWLYMZO[T[VZWYXWXPWNVMTLNLLMKN",
  "H[WEVFTGPGNHMILKLWMYNZP[S[UZVYWWWQVOUNSMOMMNLO",
  "G]RFRb RKQKMYMYQ",
  "I[MMWM RRFRb",
  "IZLMNNOPOXNZM[LZLXMVVRWPWNVMUNTPTXUZW[",
  "H\\WbQbOaN`M^MQNOONQMTMVNWOXQXWWYVZT[Q[OZMX",
  17,
  18,
  32,
  "HZLTST RVZT[P[NZMYLWLQMONNPMTMVN",
  "J\\XTQT RNZP[T[VZWYXWXQWOVNTMPMNN",
  "G\\LFL[ RLKTKVLWMXOXRWTVUTVLV",
  "H[MFMb RMNOMSMUNVOWQWWVYUZS[O[MZ",
  5,
  "F^K[KFRMYFY[",
  "G]LbLMRSXMX[",
  "G\\J`S` RMbMQNOONQMTMVNWOXQXWWYVZT[Q[OZMX",
  "I^MYNZQ[S[VZXXYVZRZOYKXIVGSFQFNGMH",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RROQPRQSPRORQ",
  "I^MYNZQ[S[VZXXYVZRZOYKXIVGSFQFNGMH RROQPRQSPRORQ",
  "H[MPTP RW[M[MFWF RP>SA",
  "H[MPTP RW[M[MFWF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "JbLFXF RR[RF RRMXM[N]P^S^\\]_[aXbVb",
  "HZM[MFXF RT>QA",
  "F[JPTP RWYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG",
  8,
  27,
  "JZUFUUTXRZO[M[",
  "AbC[D[FZGXILJILGOFRFR[X[[Z]X^V^S]Q[OXNRN",
  "AbF[FF RRFR[X[[Z]X^V^S]Q[OXNFN",
  "JbLFXF RR[RF RRMXM[N]P^S^[",
  "G\\L[LF RX[OO RXFLR RT>QA",
  "G]LFL[XFX[ RP>SA",
  "G[KFRT RYFPXNZL[K[ RN>O@QASAU@V>",
  "G]R[R` RLFL[X[XF",
  3,
  "G\\VFLFL[R[UZWXXVXSWQUORNLN",
  4,
  "HZM[MFXF",
  "F^[`[[I[I` RW[WFRFPGOHNJL[",
  6,
  "BbOOF[ RR[RF RRRFF R^[UO R^FRR",
  "I]PPTP RMGOFTFVGWHXJXLWNVOTPWQXRYTYWXYWZU[O[MZ",
  "G]LFL[XFX[",
  "G]LFL[XFX[ RN>O@QASAU@V>",
  9,
  "F\\W[WFTFQGOINLLXKZI[H[",
  10,
  7,
  11,
  "G]L[LFXFX[",
  12,
  5,
  13,
  "G[KFRT RYFPXNZL[K[",
  "G]R[RF RPITIWJYLZNZRYTWVTWPWMVKTJRJNKLMJPI",
  14,
  "G]XFX[ RLFL[Z[Z`",
  "H\\WFW[ RLFLNMPNQPRWR",
  "CaRFR[ RHFH[\\[\\F",
  "CaRFR[ RHFH[\\[\\F R\\[^[^`",
  "F]HFMFM[S[VZXXYVYSXQVOSNMN",
  "Da\\F\\[ RIFI[O[RZTXUVUSTQROONIN",
  "H]MFM[S[VZXXYVYSXQVOSNMN",
  "I^ZQPQ RMHNGQFSFVGXIYKZOZRYVXXVZS[Q[NZMY",
  "CaHFH[ ROPHP RTFXFZG\\I]M]T\\XZZX[T[RZPXOTOMPIRGTF",
  "G\\RQK[ RW[WFOFMGLHKJKMLOMPOQWQ",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR",
  "H[WEVFTGPGNHMILKLWMYNZP[S[UZVYWWWQVOUNSMOMMNLO",
  "I[STVUWWWXVZT[N[NMSMUNVPVQUSSTNT",
  "JYO[OMWM",
  "H[WOVNTMPMNNMOLQLWMYNZP[S[UZVYWWWJVHUGSFOFMG",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT",
  "F^QTJ[ RRUJM RRMR[ RZ[ST RZMRU",
  "K[RTTT RNNPMTMVNWPWQVSTTVUWWWXVZT[P[NZ",
  "H\\MMM[WMW[",
  "H\\MMM[WMW[ RNEOGQHSHUGVE",
  31,
  "I[V[VMSMQNPPOXNZL[",
  "G]L[LMRXXMX[",
  "H[MTVT RMMM[ RVMV[",
  19,
  "H[M[MMVMV[",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ",
  17,
  "KYMMWM RRMR[",
  "JZMMR[ RWMR[P`OaMb",
  38,
  "IZL[WM RLMW[",
  "I\\WMW[ RNMN[Y[Y`",
  "J\\VMV[ RNMNROTQUVU",
  "F^RMR[ RKMK[Y[YM",
  "F^RMR[ RKMK[Y[YM RY[[[[`",
  "HZJMNMN[S[UZVXVUUSSRNR",
  "F^YMY[ RKMK[P[RZSXSURSPRKR",
  "IZNMN[S[UZVXVUUSSRNR",
  "J\\XTQT RNNPMTMVNWOXQXWWYVZT[P[NZ",
  "E_JTPT RJMJ[ RT[RZQYPWPQQORNTMWMYNZO[Q[WZYYZW[T[",
  "I[RUM[ RV[VMPMNNMPMRNTPUVU",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RPESH",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "M^OKXK RRFR[ RRSSRUQWQYRZTZ[Y^WaVb",
  "JYO[OMWM RTEQH",
  "HZLTST RVZT[P[NZMYLWLQMONNPMTMVN",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN",
  "MWR[RM RRFQGRHSGRFRH",
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH RR[RM",
  18,
  "E^H[JZKXLPMNOMRMR[W[YZZXZUYSWRRR",
  "D^IMI[ RRMR[W[YZZXZVYTWSIS",
  "M^OKXK RRFR[ RRSSRUQWQYRZTZ[",
  "IZNMN[ RPSV[ RVMNU RTEQH",
  "H\\MMM[WMW[ RPESH",
  "JZMMR[ RWMR[P`OaMb RNEOGQHSHUGVE",
  "H]R[R` RMMM[W[WM",
  "CaRWRR RLFJGHIGLGUHXJZL[N[PZQYRWSYTZV[X[ZZ\\X]U]L\\IZGXF",
  43,
  "F]IIVI RMFM[S[VZXXYVYSXQVOSNMN",
  "HZJMTM RNFN[S[UZVXVUUSSRNR",
  "D`IFI[ RYPIP R\\Y[ZX[V[SZQXPVOROOPKQISGVFXF[G\\H",
  "F^KMK[ RWTKT RZZX[T[RZQYPWPQQORNTMXMZN",
  "F^LSXS RRSR[ RH[RF\\[",
  "I[NUVU RRUR[ RK[RMY[",
  "AbF[FF RFS\\S RVSV[ RL[VF`[",
  "E_J[JM RVUV[ RZUJU RO[VM][",
  "E_R[RPJFZFRP RI[IVJSLQOPUPXQZS[V[[",
  "G]R[RTLMXMRT RK[KXLVMUOTUTWUXVYXY[",
  "AcF[FF RFPSP RV[VPNF^FVP RM[MVNSPQSPYP\\Q^S_V_[",
  "DaI[IM RITST RV[VTPM\\MVT RO[OXPVQUSTYT[U\\V]X][",
  "H\\OPSP RNAQFSBTAUA RLGNFSFUGVHWJWLVNUOSPVQWRXTXWWYVZT[O[M\\L^L_MaObWb",
  "J[RTTT ROHRMTIUHVH RNNPMTMVNWPWQVSTTVUWWWXVZT[Q[O\\N^N_OaQbVb",
  "G]R[RF RHFJGKIKNLQMROSUSWRXQYNYIZG\\F",
  "G]RMRb RKMKVLXNZP[T[VZXXYVYM",
  32,
  37,
  "I[KFR[YF",
  20,
  "I[KFR[YF ROAL> RVAS>",
  "JZMMR[WM ROHLE RVHSE",
  "GmPFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF R`Me[ RjMe[c`ba`b",
  "HkP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ R^Mc[ RhMc[a``a^b",
  "CaRXR^ RRCRI RMFJGHIGLGUHXJZM[W[ZZ\\X]U]L\\IZGWFMF",
  "G]RYR] RRKRO ROMMNLOKQKWLYMZO[U[WZXYYWYQXOWNUMOM",
  "CaRWRR RLFJGHIGLGUHXJZL[N[PZQYRWSYTZV[X[ZZ\\X]U]L\\IZGXF RLBM@O?R?U@X@",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RLIMGOFRFUGXG",
  "CaRWRR RLFJGHIGLGUHXJZL[N[PZQYRWSYTZV[X[ZZ\\X]U]L\\IZGXF RM<W< RR<R?",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RMEWE RRERH",
  "FZWGTFPFMGKIJKJNKPMRPSTST[",
  "FZVNTMPMNNMOLQLSMUNVPWTWT[",
  "H[N]UO ROQWU RT[LW",
  "JZMHMFWGWE",
  "JZMHUEVH",
  16,
  25,
  "KZLIMGOFRFUGXG",
  ":j>R?PAOCPDR RC^D\\F[H\\I^ RCFDDFCHDIF ROcPaR`TaUc ROAP?R>T?UA R[^\\\\^[`\\a^ R[F\\D^C`DaF R`RaPcOePfR",
  ":jDQ>Q RH[D_ RHGDC RR_Re RRCR= R\\[`_ R\\G`C R`QfQ",
  "G]LFL[XFX[ RX[[[Ub RN>O@QASAU@V>",
  "H\\MMM[WMW[ RW[Z[Tb RNEOGQHSHUGVE",
  "H]MFM[S[VZXXYVYSXQVOSNMN RJIPI",
  "IZKMQM RNFN[S[UZVXVUUSSRNR",
  "G\\L[LFTFVGWHXJXMWOVPTQLQ RTMXS",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ RSWW]",
  "HZM[MFXFXA",
  "JYO[OMWMWH",
  "HZM[MFXF RJQRQ",
  "JYO[OMWM RLTTT",
  "H]M[MFXF RMMSMVNXPYSY\\X_VaSbQb",
  "J\\O[OMWM ROTTTVUWVXXX[W^UaTb",
  "BbOOF[ RR[RF RRRFF R^[UO R^FRR R^[`[``",
  "F^QTJ[ RRUJM RRMR[ RZ[ST RZMRU RZ[\\[\\`",
  "I]PPTP RMGOFTFVGWHXJXLWNVOTPWQXRYTYWXYWZU[O[MZ RR\\T]U_TaRbOb",
  "K[RTTT RNNPMTMVNWPWQVSTTVUWWWXVZT[P[NZ RR\\T]U_TaRbOb",
  "G\\L[LF RX[OO RXFLR RX[Z[Z`",
  "IZNMN[ RPSV[ RVMNU RV[X[X`",
  "G\\L[LF RX[OO RXFLR RPKPS",
  "IZNMN[ RPSV[ RVMNU RRORW",
  "G\\L[LF RX[OO RXFLR RIJOJ",
  "IZN[NF RPSV[ RVMNU RKJQJ",
  "E\\X[OO RXFLR RGFLFL[",
  "HZPSV[ RVMNU RJMNMN[",
  "G]L[LF RLPXP RX[XF RX[Z[Z`",
  "H[MTVT RMMM[ RVMV[ RV[X[X`",
  "GeL[LF RLPXP RX[XFcF",
  "H`MTVT RMMM[ RV[VM^M",
  "GhL[LFXFX[ RXM^MaNcPdSd\\c_aa^b\\b",
  "HcM[MMVMV[ RVT[T]U^V_X_[^^\\a[b",
  "F^QFNGLIKKJOJRKVLXNZQ[S[VZXXYVZRZMYJWIVITJSMSRTVUXWZY[[[",
  "H\\QMPMNNMOLQLWMYNZP[T[VZWYXWXRWPUOSPRRRWSYTZV[Y[",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RR\\T]U_TaRbOb",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RR\\T]U_TaRbOb",
  "JZLFXF RR[RF RR[T[T`",
  "KYMMWM RRMR[ RR[T[T`",
  15,
  "JZR[Rb RMMR[WM",
  "I[RQR[ RKFRQYF RNUVU",
  "JZR[Rb RMMR[WM RN]V]",
  "H\\KFY[ RYFK[ RX[Z[Z`",
  "IZL[WM RLMW[ RV[X[X`",
  "D]FFRF RXFX[ RLFL[Z[Z`",
  "G\\RMIM RWMW[ RNMN[Y[Y`",
  "H\\WFW[ RLFLNMPNQPRWR RW[Y[Y`",
  "J\\VMV[ RNMNROTQUVU RV[X[X`",
  "H\\WFW[ RLFLNMPNQPRWR RRNRV",
  "J\\VMV[ RNMNROTQUVU RRQRY",
  "G]L[LF RL[ RLPRPUQWSXVX[",
  "H[M[MF RV[VPUNSMPMNNMO",
  "@^WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGXIYKZOJQGQEPDOCMCK",
  "E[VZT[P[NZMXMPNNPMTMVNWPWRMTKTISHQHO",
  "@^WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGXIYKZOJQGQEPDOCMCK RR[P]O_PaRbTb",
  "E[VZT[P[NZMXMPNNPMTMVNWPWRMTKTISHQHO RR[P]O_PaRbTb",
  8,
  "BbOOF[ RR[RF RRRFF R^[UO R^FRR RN>O@QASAU@V>",
  "F^QTJ[ RRUJM RRMR[ RZ[ST RZMRU RNEOGQHSHUGVE",
  "G\\L[LF RX[OO RXFLR RX[X_WaUbSb",
  "IZNMN[ RPSV[ RVMNU RV[V_UaSbQb",
  "F\\W[WFTFQGOINLLXKZI[H[ RW[Z[Tb",
  "I[V[VMSMQNPPOXNZL[ RV[Y[Sb",
  "G]L[LF RLPXP RX[XF RX[X_WaUbSb",
  "H[MTVT RMMM[ RVMV[ RV[V_UaSbQb",
  "G]L[LF RLPXP RX[XF RX[[[Ub",
  "H[MTVT RMMM[ RVMV[ RV[Y[Sb",
  "H\\WFW[ RLFLNMPNQPRWR RW[U[U`",
  "J\\VMV[ RNMNROTQUVU RV[T[T`",
  "F^K[KFRUYFY[ RY[\\[Vb",
  "G]L[LMRXXMX[ RX[[[Ub",
  8,
  30,
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE",
  "I[MUWU RK[RFY[ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "F`JURU RRPYP RH[OF\\F RRFR[\\[",
  "D`INKMOMQNRP R[ZY[U[SZRXRPSNUMYM[N\\P\\RRSKSITHVHXIZK[O[QZRX",
  "H[MPTP RW[M[MFWF RN>O@QASAU@V>",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNEOGQHSHUGVE",
  "F^MHNGQFSFVGXIYKZOZRYVXXVZS[Q[NZLXKVJRZP",
  33,
  "F^MHNGQFSFVGXIYKZOZRYVXXVZS[Q[NZLXKVJRZP RNBOCNDMCNBND RVBWCVDUCVBVD",
  "I[NNPMTMVNWPWXVZT[P[NZMXMVWT RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "BbOOF[ RR[RF RRRFF R^[UO R^FRR RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "F^QTJ[ RRUJM RRMR[ RZ[ST RZMRU RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I]PPTP RMGOFTFVGWHXJXLWNVOTPWQXRYTYWXYWZU[O[MZ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "K[RTTT RNNPMTMVNWPWQVSTTVUWWWXVZT[P[NZ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  2,
  "JZMMVMOVRVTWUXVZV^U`TaRbObMa",
  "G]LFL[XFX[ RM@W@",
  "H\\MMM[WMW[ RMGWG",
  "G]LFL[XFX[ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "H\\MMM[WMW[ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  32,
  37,
  "G]KPYP RPFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "H[LTWT RP[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I^ZPPP RMYNZQ[S[VZXXYVZRZOYKXIVGSFQFNGMH RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "J\\XTQT RNZP[T[VZWYXWXQWOVNTMPMNN RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "G[KFRT RYFPXNZL[K[ RM@W@",
  "JZMMR[ RWMR[P`OaMb RMGWG",
  "G[KFRT RYFPXNZL[K[ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "JZMMR[ RWMR[P`OaMb RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "G[KFRT RYFPXNZL[K[ RQ>NA RX>UA",
  "JZMMR[ RWMR[P`OaMb RQENH RXEUH",
  "H\\WFW[ RLFLNMPNQPRWR RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "J\\VMV[ RNMNROTQUVU RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "HZM[MFXF RM[O[O`",
  "JYO[OMWM RO[Q[Q`",
  "Da\\F\\[ RIFI[O[RZTXUVUSTQROONIN RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "F^YMY[ RKMK[P[RZSXSURSPRKR RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "HZWFMFM[Q[Q_PaNbLb RJQRQ",
  "JYWMOMO[S[S_RaPbNb RLTTT",
  "H\\KFY[ RYFK[ RX[X_WaUbSb",
  "IZL[WM RLMW[ RV[V_UaSbQb",
  "H\\KFY[ RYFK[ RNPVP",
  "IZL[WM RLMW[ RNTVT",
  "G\\WFW[Q[NZLXKVKSLQNOQNWN",
  "J[VMV[Q[OZNXNUOSQRVR",
  "B_RXSZU[X[ZZ[X[M RRFRXQZO[L[IZGXFVFSGQIOLNRN",
  "E]RXSZU[V[XZYXYQ RRMRXQZO[M[KZJXJUKSMRRR",
  "IePPTP RMGOFTFVGWHXJXLWNVOTPVQWRXTXXYZ[[^[`ZaXaM",
  "KbRTTT RNNPMTMVNWPWQVSTTVUWWWXXZZ[[[]Z^X^Q",
  "I\\PPTP RMGOFTFVGWHXJXLWNVOTPVQWRXTX[Z[Z`",
  "K[RTTT RNNPMTMVNWPWQVSTTVUWWW[Y[Y`",
  "FdH[I[KZLXNLOIQGTFWFWXXZZ[][_Z`X`M",
  "IaL[NZOXPPQNSMVMVXWZY[Z[\\Z]X]Q",
  "CaH[HF RHPTP RTFTXUZW[Z[\\Z]X]M",
  "F^KTTT RKMK[ RTMTXUZW[X[ZZ[X[R",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR",
  "HZUNSMPMNNMOLQLWMYNZP[T[VZVUSU",
  "J_LFXF RRFRXSZU[X[ZZ[X[M",
  "K]MMWM RRMRXSZU[V[XZYXYS",
  "G[PPTP RWGUFPFNGMHLJLLMNNOPPMQLRKTKWLYMZO[U[WZ",
  35,
  "F\\W[WFTFQGOINLLXKZI[H[ RW[W_VaTbRb",
  "I[V[VMSMQNPPOXNZL[ RV[V_UaSbQb",
  "BaP[^F RD[E[GZHXJLKIMGPF^[",
  "E^[MO[ RH[JZKXLPMNOM[[",
  "E_\\FUO\\[ RJ[JFRFTGUHVJVMUOTPRQJQ",
  "F^KMKb R[MUT[[ RKNMMQMSNTOUQUWTYSZQ[M[KZ",
  "DaOQH[ RTFT[^[ R[QLQJPIOHMHJIHJGLF^F",
  "D`H[MU RRPRMKMINHPHRITKURU R[ZY[U[SZRXRPSNUMYM[N\\P\\RRT",
  "G]Z]X\\VZSWQVOV RP[NZLXKTKMLINGPFTFVGXIYMYTXXVZT[P[",
  "I\\WMWb RWZU[Q[OZNYMWMQNOONQMUMWN",
  "F^IFN[RLV[[F",
  21,
  "G\\L[LF RX[OO RXFLR RXKRG",
  "IZNMN[ RPSV[ RVMNU RWQQM",
  "FgW[WFTFQGOINLLXKZI[H[ RWM]M`NbPcSc\\b_`a]b[b",
  "IcV[VMSMQNPPOXNZL[ RVT[T]U^V_X_[^^\\a[b",
  "GhL[LF RLPXP RX[XF RXM^MaNcPdSd\\c_aa^b\\b",
  "HcMTVT RMMM[ RVMV[ RVT[T]U^V_X_[^^\\a[b",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "JZNXVX RM[RMW[",
  "H\\LXRX RRTWT RRMR[Y[ RYMPMK[",
  "D`[ZY[U[SZRX RINKMOMQNRPRXQZO[K[IZHXHVRUYU[T\\R\\P[NYMUMSNRP",
  "I[STVUWWWXVZT[N[NMSMUNVPVQUSSTNT RKWQW",
  17,
  "J[SMOMO[S[UZVYWVWRVOUNSM",
  "J[SMOMO[S[UZVYWVWRVOUNSM RLTRT",
  "JYOTTT RVMOMO[V[",
  "J[TTVSWQWPVNTMPMNN RRTTTVUWWWXVZT[P[NZ",
  "MWRMR[ RRbSaR`QaRbR`",
  "LYTMTWSYRZP[O[",
  31,
  "JYOMO[V[ RLVRR",
  "G]L[LMRXXMX[",
  "I\\W[WMN[NM",
  19,
  "J\\NNPMTMVNWOXQXWWYVZT[P[NZ",
  "G]YSYVXXWYUZOZMYLXKVKSLQMPOOUOWPXQYS",
  "G]XYYWYSXQWPUOOOMPLQKSKWLY",
  "G]YNK[ RYSYVXXWYUZOZMYLXKVKSLQMPOOUOWPXQYS",
  "DaINKMOMQNRPRXQZO[K[IZHXHVRT RRWSYTZV[Y[[Z\\Y]W]Q\\O[NYMVMTNSORQ",
  "G]OMNNMPNRPS RTSVRWPVNUM RPSTSVTWVWXVZT[P[NZMXMVNTPS",
  "I\\XTXQWOVNTMQMONNOMQMT",
  "H[LTLWMYNZP[S[UZVYWWWT",
  "I[N[NMTMVNWPWRVTTUNU",
  "I[RUM[ RV[VMPMNNMPMRNTPUVU",
  "I[RSMM RVMV[P[NZMXMVNTPSVS",
  "KYMMWM RRMR[",
  "H[MMMXNZP[S[UZVXVM",
  "G]KPYP RKYVYXXYVYSXQWP",
  "@]KPYP RKYVYXXYVYSXQWP REWFXEYDXEWEY REOFPEQDPEOEQ",
  "G]KKYK RWKXLYNYQXSVTKT RVTXUYWYZX\\V]K]",
  20,
  21,
  "IZLMWML[W[",
  "JZNMVMRRSRUSVUVXUZS[P[NZ",
  "H\\XNUMPMNNMOLQLSMUNVPWTXVYWZX\\X^W`VaTbObLa RRTR\\",
  "JZW[PROPPNRMTNUPTRM[",
  "JYO[OMWM",
  "JZM[RMW[",
  "H[M[MMVMV[",
  "I[N[NMTMVNWPWRVTTUNU",
  "I[RMR[ RLMMNMRNTPUTUVTWRWNXM",
  "I[V[VMSMQNPPOXNZL[",
  "JZNKVK RMNR@WN",
  "H\\LKRK RRGWG RR@RNYN RY@P@KN",
  "I[SGVHWJWKVMTNNNN@S@UAVCVDUFSGNG",
  "I[SGVHWJWKVMTNNNN@S@UAVCVDUFSGNG RKGQG",
  "J[S@O@ONSNUMVLWIWEVBUAS@",
  "JYOGTG RV@O@ONVN",
  "KZUGPG RN@U@UNNN",
  "HZUAS@P@NAMBLDLJMLNMPNTNVMVHSH",
  "H[MGVG RM@MN RV@VN",
  "MWRNR@ RUNON RU@O@",
  "LYT@TJSLRMPNON",
  "IZN@NN RPFVN RV@NH",
  "JYO@ONVN",
  "G]LNL@RKX@XN",
  "H[MNM@VNV@",
  "I\\WNW@NNN@",
  "H[PNNMMLLJLDMBNAP@S@UAVBWDWJVLUMSNPN",
  "G]O@NAMCNEPF RTFVEWCVAU@ RPFTFVGWIWKVMTNPNNMMKMINGPF",
  "I[NNN@T@VAWCWEVGTHNH",
  "I[RHWN RNNN@T@VAWCWEVGTHNH",
  "KYM@W@ RR@RN",
  "H[M@MKNMPNSNUMVKV@",
  "G]J@NNRDVNZ@",
  "KZOEQDSDUEVGVN RVMTNQNOMNKOIQHVH",
  "JYNDNKOMQNSNUM RNEPDSDUEVGUISJNJ",
  "H]WDUKTMRNPNNMMKMGNEPDRDTEVMWN",
  "H\\XMVNUNSMRK RLDODQERHRKQMONNNLMKKKJVJXIYGXEVDUDSERH",
  "KYO@ON ROMQNSNUMVKVGUESDQDOE",
  "KYU@UN RUESDQDOENGNKOMQNSNUM",
  "LYVMTNRNPMOKOGPERDSDUEVGVHOI",
  "LYOEQDSDUEVGVKUMSNRNPMOKOJVI",
  "LXPIRI RUETDPDOEOHPIOJOMPNTNUM",
  "LXRITI ROEPDTDUEUHTIUJUMTNPNOM",
  "KYUDUPTRRSOS RUESDQDOENGNKOMQNSNUM",
  "NVRDRN RRUSTRSQTRURS",
  "IZO@ON RUNQH RUDOJ",
  "G]KNKD RKEMDODQERGRN RRGSEUDVDXEYGYN",
  "KZODON ROEQDSDUEVGVPURSSRS",
  "KYQNOMNKNGOEQDSDUEVGVKUMSNQN",
  "LYOEQDSDUEVGVKUMSNQNOM",
  "KYNINGOEQDSDUEVGVI",
  "KYNINKOMQNSNUMVKVI",
  "KYOSOD ROEQDSDUEVGVKUMSNQNOM",
  "NXPDVD RR@RKSMUNVN",
  "KYUDUN RNDNKOMQNSNUM",
  "I[MFWF RMMTMVLWJWHVF",
  "G]YDYN RYMWNUNSMRKRD RRKQMONNNLMKKKD",
  "LXNDRNVD",
  "LXVNPGPEQDSDTETGNN",
  "KYSFRF RNSOQOCPAR@S@UAVCUESFUGVIVKUMSNQNOM",
  "KXRMRS RMDOERMVD",
  "KYSDQDOENGNKOMQNSNUMVKVGUESDPCOBOAP@U@",
  "I[MDLFLJMLNMPNTNVMWLXJXGWEUDSERGRS",
  "LXVDNS RNDPETRVS",
  "NVRWRa RRPQQRRSQRPRR",
  "LWPWPa RPZQXSWUW",
  "KYUWUa RNWN^O`QaSaU`",
  "LXNWRaVW",
  "KYSYRY RNfOdOVPTRSSSUTVVUXSYUZV\\V^U`SaQaO`",
  "KXR`Rf RMWOXR`VW",
  "KYOfOZPXRWSWUXVZV^U`SaQaO`",
  "I[MWLYL]M_N`PaTaV`W_X]XZWXUWSXRZRf",
  "LXVWNf RNWPXTeVf",
  "D`IMIXJZL[O[QZRX R[ZY[U[SZRXRPSNUMYM[N\\P\\RRT",
  "H[M[MF RMNOMSMUNVOWQWWVYUZS[O[MZ RIHJGLFPHRGSF",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RQHRGTFXHZG[F",
  "MYOMWM RR[RISGUFWF RMTNSPRTTVSWR",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[ RMTNSPRTTVSWR",
  "I\\NMN[ RNOONQMTMVNWPW[ RMTNSPRTTVSWR",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ RI`J_L^P`R_S^",
  "KXP[PM RPQQORNTMVM RLTMSORSTUSVR",
  "KXM[S[ RVMTMRNQOPRP[ RLTMSORSTUSVR",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RNTOSQRUTWSXR",
  "MYOMWM RRFRXSZU[W[ RMSNRPQTSVRWQ",
  "IZLMWML[W[ RMTNSPRTTVSWR",
  "H[M[MJNHOGQFTFVG RMNOMSMUNVOWQWWVYUZS[O[MZ",
  "H[MGVG RM@MN RV@VN",
  "JZMMVMOURUTVUWVYV^U`TaRbPbNaM_M^N\\P[V[",
  "MlOMWM RRFRXSZU[W[ R^[^F Rg[gPfNdMaM_N^O RiC]`",
  "MWR[RM RU[O[ RUMOM ROTUT",
  "MXRMRXSZU[ ROTUT",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ RHT\\T",
  "H[MMMXNZP[S[UZVXVM RHT\\T",
  "I\\XMUMUPWRXTXWWYVZT[Q[OZNYMWMTNRPPPMMM RHU\\U",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "I[MUWU RK[RFY[ RR`TaUcTeRfPeOcPaR`",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RR`TaUcTeRfPeOcPaR`",
  "G\\SPVQWRXTXWWYVZT[L[LFSFUGVHWJWLVNUOSPLP RR?Q@RAS@R?RA",
  "H[M[MF RMNOMSMUNVOWQWWVYUZS[O[MZ RN?M@NAO@N?NA",
  "G\\SPVQWRXTXWWYVZT[L[LFSFUGVHWJWLVNUOSPLP RRbSaR`QaRbR`",
  "H[M[MF RMNOMSMUNVOWQWWVYUZS[O[MZ RRbSaR`QaRbR`",
  "G\\SPVQWRXTXWWYVZT[L[LFSFUGVHWJWLVNUOSPLP RWaMa",
  "H[M[MF RMNOMSMUNVOWQWWVYUZS[O[MZ RWaMa",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RR\\T]U_TaRbOb RT>QA",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RR\\T]U_TaRbOb RTEQH",
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RR?Q@RAS@R?RA",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RV?U@VAW@V?VA",
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RRbSaR`QaRbR`",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RSbTaS`RaSbS`",
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RWaMa",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RXaNa",
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RQ\\S]T_SaQbNb",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RS\\U]V_UaSbPb",
  "G\\L[LFQFTGVIWKXOXRWVVXTZQ[L[ RVcR`Nc",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RWcS`Oc",
  "H[MPTP RW[M[MFWF RM@W@ RP9S<",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RMGWG RP>SA",
  "H[MPTP RW[M[MFWF RM@W@ RT9Q<",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RMGWG RT>QA",
  "H[MPTP RW[M[MFWF RVcR`Nc",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RVcR`Nc",
  "H[MPTP RW[M[MFWF RW`VaTbP`NaMb",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RW`VaTbP`NaMb",
  "H[MPTP RW[M[MFWF RR\\T]U_TaRbOb RN>O@QASAU@V>",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RR\\T]U_TaRbOb RNEOGQHSHUGVE",
  "HZTPMP RM[MFWF RR?Q@RAS@R?RA",
  "MYOMWM RR[RISGUFWF RT?S@TAU@T?TA",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RM@W@",
  "I\\WMW^V`UaSbPbNa RWZU[Q[OZNYMWMQNOONQMUMWN RMGWG",
  "G]L[LF RLPXP RX[XF RR?Q@RAS@R?RA",
  "H[M[MF RV[VPUNSMPMNNMO RM?L@MAN@M?MA",
  "G]L[LF RLPXP RX[XF RRbSaR`QaRbR`",
  "H[M[MF RV[VPUNSMPMNNMO RRbSaR`QaRbR`",
  "G]L[LF RLPXP RX[XF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "H[M[MF RV[VPUNSMPMNNMO RI?J@IAH@I?IA RQ?R@QAP@Q?QA",
  "G]L[LF RLPXP RX[XF RL\\N]O_NaLbIb",
  "H[M[MF RV[VPUNSMPMNNMO RM\\O]P_OaMbJb",
  "G]L[LF RLPXP RX[XF RV`UbScQcObN`",
  "H[M[MF RV[VPUNSMPMNNMO RV`UbScQcObN`",
  "MWR[RF RW`VaTbP`NaMb",
  "MWR[RM RRFQGRHSGRFRH RW`VaTbP`NaMb",
  "MWR[RF RN?O@NAM@N?NA RV?W@VAU@V?VA RT9Q<",
  "MWR[RM RNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  "G\\L[LF RX[OO RXFLR RT>QA",
  "IZN[NF RPSV[ RVMNU RPAMD",
  "G\\L[LF RX[OO RXFLR RRbSaR`QaRbR`",
  "IZN[NF RPSV[ RVMNU RRbSaR`QaRbR`",
  "G\\L[LF RX[OO RXFLR RWaMa",
  "IZN[NF RPSV[ RVMNU RWaMa",
  "HYW[M[MF RRbSaR`QaRbR`",
  "MXU[SZRXRF RSbTaS`RaSbS`",
  "HYW[M[MF RH@R@ RRbSaR`QaRbR`",
  "MXU[SZRXRF RM@W@ RSbTaS`RaSbS`",
  "HYW[M[MF RWaMa",
  "MXU[SZRXRF RXaNa",
  "HYW[M[MF RVcR`Nc",
  "MXU[SZRXRF RWcS`Oc",
  "F^K[KFRUYFY[ RT>QA",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[ RTEQH",
  "F^K[KFRUYFY[ RR?Q@RAS@R?RA",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[ RRFQGRHSGRFRH",
  "F^K[KFRUYFY[ RRbSaR`QaRbR`",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[ RRbSaR`QaRbR`",
  "G]L[LFX[XF RR?Q@RAS@R?RA",
  "I\\NMN[ RNOONQMTMVNWPW[ RRFQGRHSGRFRH",
  "G]L[LFX[XF RRbSaR`QaRbR`",
  "I\\NMN[ RNOONQMTMVNWPW[ RRbSaR`QaRbR`",
  "G]L[LFX[XF RWaMa",
  "I\\NMN[ RNOONQMTMVNWPW[ RWaMa",
  "G]L[LFX[XF RVcR`Nc",
  "I\\NMN[ RNOONQMTMVNWPW[ RVcR`Nc",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RMAN@P?TAV@W? RT9Q<",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMHNGPFTHVGWF RT>QA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RMAN@P?TAV@W? RN:O;N<M;N:N< RV:W;V<U;V:V<",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMHNGPFTHVGWF RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RM@W@ RP9S<",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMGWG RP>SA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RM@W@ RT9Q<",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RMGWG RT>QA",
  "G\\L[LFTFVGWHXJXMWOVPTQLQ RT>QA",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ RTEQH",
  "G\\L[LFTFVGWHXJXMWOVPTQLQ RR?Q@RAS@R?RA",
  "H[MMMb RMNOMSMUNVOWQWWVYUZS[O[MZ RRFQGRHSGRFRH",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RR?Q@RAS@R?RA",
  "KXP[PM RPQQORNTMVM RSFRGSHTGSFSH",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RRbSaR`QaRbR`",
  "KXP[PM RPQQORNTMVM RPbQaP`OaPbP`",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RM@W@ RRbSaR`QaRbR`",
  "KXP[PM RPQQORNTMVM RNGXG RPbQaP`OaPbP`",
  "G\\X[QQ RL[LFTFVGWHXJXMWOVPTQLQ RWaMa",
  "KXP[PM RPQQORNTMVM RUaKa",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RR?Q@RAS@R?RA",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RRFQGRHSGRFRH",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RRbSaR`QaRbR`",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RRbSaR`QaRbR`",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RU>RA RM>N?M@L?M>M@",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RUERH RMENFMGLFMEMG",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RN>RAV> RR:Q;R<S;R:R<",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RNERHVE RR?Q@RAS@R?RA",
  "H\\LZO[T[VZWYXWXUWSVRTQPPNOMNLLLJMHNGPFUFXG RR?Q@RAS@R?RA RRbSaR`QaRbR`",
  "J[NZP[T[VZWXWWVUTTQTOSNQNPONQMTMVN RRFQGRHSGRFRH RRbSaR`QaRbR`",
  "JZLFXF RR[RF RR?Q@RAS@R?RA",
  "MYOMWM RRFRXSZU[W[ RR?Q@RAS@R?RA",
  "JZLFXF RR[RF RRbSaR`QaRbR`",
  "MYOMWM RRFRXSZU[W[ RTbUaT`SaTbT`",
  "JZLFXF RR[RF RWaMa",
  "MYOMWM RRFRXSZU[W[ RYaOa",
  "JZLFXF RR[RF RVcR`Nc",
  "MYOMWM RRFRXSZU[W[ RXcT`Pc",
  "G]LFLWMYNZP[T[VZWYXWXF RVbUaV`WaVbV` RNbMaN`OaNbN`",
  "H[VMV[ RMMMXNZP[S[UZVY RVbUaV`WaVbV` RNbMaN`OaNbN`",
  "G]LFLWMYNZP[T[VZWYXWXF RW`VaTbP`NaMb",
  "H[VMV[ RMMMXNZP[S[UZVY RW`VaTbP`NaMb",
  "G]LFLWMYNZP[T[VZWYXWXF RVcR`Nc",
  "H[VMV[ RMMMXNZP[S[UZVY RVcR`Nc",
  "G]LFLWMYNZP[T[VZWYXWXF RMAN@P?TAV@W? RT9Q<",
  "H[VMV[ RMMMXNZP[S[UZVY RMHNGPFTHVGWF RT>QA",
  "G]LFLWMYNZP[T[VZWYXWXF RM@W@ RN:O;N<M;N:N< RV:W;V<U;V:V<",
  "H[VMV[ RMMMXNZP[S[UZVY RMGWG RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "I[KFR[YF RMAN@P?TAV@W?",
  "JZMMR[WM RMHNGPFTHVGWF",
  "I[KFR[YF RRbSaR`QaRbR`",
  "JZMMR[WM RRbSaR`QaRbR`",
  "F^IFN[RLV[[F RP>SA",
  "G]JMN[RQV[ZM RPESH",
  "F^IFN[RLV[[F RT>QA",
  "G]JMN[RQV[ZM RTEQH",
  "F^IFN[RLV[[F RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "G]JMN[RQV[ZM RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "F^IFN[RLV[[F RR?Q@RAS@R?RA",
  "G]JMN[RQV[ZM RRFQGRHSGRFRH",
  "F^IFN[RLV[[F RRbSaR`QaRbR`",
  "G]JMN[RQV[ZM RRbSaR`QaRbR`",
  "H\\KFY[ RYFK[ RR?Q@RAS@R?RA",
  "IZL[WM RLMW[ RRFQGRHSGRFRH",
  "H\\KFY[ RYFK[ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "IZL[WM RLMW[ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I[RQR[ RKFRQYF RR?Q@RAS@R?RA",
  "JZMMR[ RWMR[P`OaMb RRFQGRHSGRFRH",
  "H\\KFYFK[Y[ RNAR>VA",
  "IZLMWML[W[ RNHREVH",
  "H\\KFYFK[Y[ RRbSaR`QaRbR`",
  "IZLMWML[W[ RRbSaR`QaRbR`",
  "H\\KFYFK[Y[ RWaMa",
  "IZLMWML[W[ RWaMa",
  "H[M[MF RV[VPUNSMPMNNMO RWaMa",
  "MYOMWM RRFRXSZU[W[ RN?O@NAM@N?NA RV?W@VAU@V?VA",
  "G]JMN[RQV[ZM RRHPGOEPCRBTCUETGRH",
  "JZMMR[ RWMR[P`OaMb RRHPGOEPCRBTCUETGRH",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RWJYIZGYEWD",
  "MYR[RISGUFWF RT?S@TAU@T?TA",
  "MYR[RISGUFWF ROSUO",
  "MYR[RISGUFWF ROLUL",
  "E^J[JLKIMGPFZFSNVNXOYPZRZWYYXZV[R[PZOY",
  "H[SMPMNNMOLQLWMYNZP[S[UZVYWWWQVOUNSMPLNKMINGPFTFVG",
  "I[MUWU RK[RFY[ RRbSaR`QaRbR`",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RRbSaR`QaRbR`",
  "I[MUWU RK[RFY[ RRAT?U=T;R:P:",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RRHTFUDTBRAPA",
  "I[MUWU RK[RFY[ RU>X; RNAR>VA",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RUEXB RNHREVH",
  "I[MUWU RK[RFY[ RO>L; RNAR>VA",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR ROELB RNHREVH",
  "I[MUWU RK[RFY[ RNAR>VA RXAZ?[=Z;X:V:",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNHREVH RXHZF[DZBXAVA",
  "I[MUWU RK[RFY[ RNAR>VA RM<N;P:T<V;W:",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNHREVH RMAN@P?TAV@W?",
  "I[MUWU RK[RFY[ RNAR>VA RRbSaR`QaRbR`",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNHREVH RRbSaR`QaRbR`",
  "I[MUWU RK[RFY[ RN>O@QASAU@V> RT9Q<",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE RT>QA",
  "I[MUWU RK[RFY[ RN>O@QASAU@V> RP9S<",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE RP>SA",
  "I[MUWU RK[RFY[ RN>O@QASAU@V> RP>R<S:R8P7N7",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE RPERCSAR?P>N>",
  "I[MUWU RK[RFY[ RN>O@QASAU@V> RM<N;P:T<V;W:",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE RMAN@P?TAV@W?",
  "I[MUWU RK[RFY[ RN>O@QASAU@V> RRbSaR`QaRbR`",
  "I\\W[WPVNTMPMNN RWZU[P[NZMXMVNTPSUSWR RNEOGQHSHUGVE RRbSaR`QaRbR`",
  "H[MPTP RW[M[MFWF RRbSaR`QaRbR`",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RRbSaR`QaRbR`",
  "H[MPTP RW[M[MFWF RRAT?U=T;R:P:",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RRHTFUDTBRAPA",
  "H[MPTP RW[M[MFWF RMAN@P?TAV@W?",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RMHNGPFTHVGWF",
  "H[MPTP RW[M[MFWF RU>X; RNAR>VA",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RUEXB RNHREVH",
  "H[MPTP RW[M[MFWF RO>L; RNAR>VA",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT ROELB RNHREVH",
  "H[MPTP RW[M[MFWF RNAR>VA RXAZ?[=Z;X:V:",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNHREVH RXHZF[DZBXAVA",
  "H[MPTP RW[M[MFWF RNAR>VA RM<N;P:T<V;W:",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNHREVH RMAN@P?TAV@W?",
  "H[MPTP RW[M[MFWF RNAR>VA RRbSaR`QaRbR`",
  "I[VZT[P[NZMXMPNNPMTMVNWPWRMT RNHREVH RRbSaR`QaRbR`",
  "MWR[RF RRAT?U=T;R:P:",
  "MWR[RM RRHTFUDTBRAPA",
  "MWR[RF RRbSaR`QaRbR`",
  "MWR[RM RRFQGRHSGRFRH RRbSaR`QaRbR`",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RRbSaR`QaRbR`",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RRbSaR`QaRbR`",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RRAT?U=T;R:P:",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RRHTFUDTBRAPA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RU>X; RNAR>VA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUEXB RNHREVH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RO>L; RNAR>VA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ ROELB RNHREVH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RNAR>VA RXAZ?[=Z;X:V:",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNHREVH RXHZF[DZBXAVA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RNAR>VA RM<N;P:T<V;W:",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNHREVH RMAN@P?TAV@W?",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RNAR>VA RRbSaR`QaRbR`",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RNHREVH RRbSaR`QaRbR`",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RVGXFYDXBWA RT>QA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUNWMXKWIVH RTEQH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RVGXFYDXBWA RP>SA",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUNWMXKWIVH RPESH",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RVGXFYDXBWA RRAT?U=T;R:P:",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUNWMXKWIVH RRHTFUDTBRAPA",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RVGXFYDXBWA RWAVBTCPANBMC",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUNWMXKWIVH RWHVITJPHNIMJ",
  "G]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RVGXFYDXBWA RRbSaR`QaRbR`",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RUNWMXKWIVH RRbSaR`QaRbR`",
  "G]LFLWMYNZP[T[VZWYXWXF RRbSaR`QaRbR`",
  "H[VMV[ RMMMXNZP[S[UZVY RRbSaR`QaRbR`",
  "G]LFLWMYNZP[T[VZWYXWXF RRAT?U=T;R:P:",
  "H[VMV[ RMMMXNZP[S[UZVY RRHTFUDTBRAPA",
  "G]LFLWMYNZP[T[VZWYXWXF RXFZE[CZAY@ RT>QA",
  "H[VMV[ RMMMXNZP[S[UZVY RVMXLYJXHWG RTEQH",
  "G]LFLWMYNZP[T[VZWYXWXF RXFZE[CZAY@ RP>SA",
  "H[VMV[ RMMMXNZP[S[UZVY RVMXLYJXHWG RPESH",
  "G]LFLWMYNZP[T[VZWYXWXF RXFZE[CZAY@ RRAT?U=T;R:P:",
  "H[VMV[ RMMMXNZP[S[UZVY RVMXLYJXHWG RRHTFUDTBRAPA",
  "G]LFLWMYNZP[T[VZWYXWXF RXFZE[CZAY@ RWAVBTCPANBMC",
  "H[VMV[ RMMMXNZP[S[UZVY RVMXLYJXHWG RWHVITJPHNIMJ",
  "G]LFLWMYNZP[T[VZWYXWXF RXFZE[CZAY@ RRbSaR`QaRbR`",
  "H[VMV[ RMMMXNZP[S[UZVY RVMXLYJXHWG RRbSaR`QaRbR`",
  "I[RQR[ RKFRQYF RP>SA",
  "JZMMR[ RWMR[P`OaMb RPESH",
  "I[RQR[ RKFRQYF RRbSaR`QaRbR`",
  "JZMMR[ RWMR[P`OaMb RVbWaV`UaVbV`",
  "I[RQR[ RKFRQYF RRAT?U=T;R:P:",
  "JZMMR[ RWMR[P`OaMb RRHTFUDTBRAPA",
  "I[RQR[ RKFRQYF RMAN@P?TAV@W?",
  "JZMMR[ RWMR[P`OaMb RMHNGPFTHVGWF",
  "E\\PFP[ RJFJ[Z[",
  "J[MMWM ROFOXPZR[ RX[VZUXUF",
  "G]QFOGMJLMLWMYNZP[T[VZXXYVYTXPVMUL",
  "H[QMONNOMQMWNYOZQ[S[UZVYWWWUVSURSQ",
  "G[KFRT RYFRTPXOZM[KZJXKVMUOVPX",
  "JZMMR[ RWMR[Q_PaNbLaK_L]N\\P]Q_",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQHRHSGSE",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQEQGRHSH",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RTEWH RMHNHOGOE",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RTEWH RMEMGNHOH",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RXEUH RMHNHOGOE",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RXEUH RMEMGNHOH",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQHRHSGSE RMAN@P?TAV@W?",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQEQGRHSH RMAN@P?TAV@W?",
  "G[MUWU RK[RFY[ RJHKHLGLE",
  "G[MUWU RK[RFY[ RJEJGKHLH",
  "?[MUWU RK[RFY[ RIELH RBHCHDGDE",
  "?[MUWU RK[RFY[ RIELH RBEBGCHDH",
  "?[MUWU RK[RFY[ RMEJH RBHCHDGDE",
  "?[MUWU RK[RFY[ RMEJH RBEBGCHDH",
  "D[MUWU RK[RFY[ RFAG@I?MAO@P? RJHKHLGLE",
  "D[MUWU RK[RFY[ RFAG@I?MAO@P? RJEJGKHLH",
  "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RQHRHSGSE",
  "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RQEQGRHSH",
  "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RTEWH RMHNHOGOE",
  "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RTEWH RMEMGNHOH",
  "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RXEUH RMHNHOGOE",
  "IZPTNUMWMXNZP[T[VZ RRTPTNSMQMPNNPMTMVN RXEUH RMEMGNHOH",
  23,
  23,
  "B[MPTP RW[M[MFWF REHFHGGGE",
  "B[MPTP RW[M[MFWF REEEGFHGH",
  ":[MPTP RW[M[MFWF RDEGH R=H>H?G?E",
  ":[MPTP RW[M[MFWF RDEGH R=E=G>H?H",
  ":[MPTP RW[M[MFWF RHEEH R=H>H?G?E",
  ":[MPTP RW[M[MFWF RHEEH R=E=G>H?H",
  23,
  23,
  "I\\NMN[ RNOONQMTMVNWPWb RQHRHSGSE",
  "I\\NMN[ RNOONQMTMVNWPWb RQEQGRHSH",
  "I\\NMN[ RNOONQMTMVNWPWb RTEWH RMHNHOGOE",
  "I\\NMN[ RNOONQMTMVNWPWb RTEWH RMEMGNHOH",
  "I\\NMN[ RNOONQMTMVNWPWb RXEUH RMHNHOGOE",
  "I\\NMN[ RNOONQMTMVNWPWb RXEUH RMEMGNHOH",
  "I\\NMN[ RNOONQMTMVNWPWb RQHRHSGSE RMAN@P?TAV@W?",
  "I\\NMN[ RNOONQMTMVNWPWb RQEQGRHSH RMAN@P?TAV@W?",
  "A]L[LF RLPXP RX[XF RDHEHFGFE",
  "A]L[LF RLPXP RX[XF RDEDGEHFH",
  "9]L[LF RLPXP RX[XF RCEFH R<H=H>G>E",
  "9]L[LF RLPXP RX[XF RCEFH R<E<G=H>H",
  "9]L[LF RLPXP RX[XF RGEDH R<H=H>G>E",
  "9]L[LF RLPXP RX[XF RGEDH R<E<G=H>H",
  ">]L[LF RLPXP RX[XF R@AA@C?GAI@J? RDHEHFGFE",
  ">]L[LF RLPXP RX[XF R@AA@C?GAI@J? RDEDGEHFH",
  "MXRMRXSZU[ RQHRHSGSE",
  "MXRMRXSZU[ RQEQGRHSH",
  "MXRMRXSZU[ RTEWH RMHNHOGOE",
  "MXRMRXSZU[ RTEWH RMEMGNHOH",
  "MXRMRXSZU[ RXEUH RMHNHOGOE",
  "MXRMRXSZU[ RXEUH RMEMGNHOH",
  "MXRMRXSZU[ RQHRHSGSE RMAN@P?TAV@W?",
  "MXRMRXSZU[ RQEQGRHSH RMAN@P?TAV@W?",
  "GWR[RF RJHKHLGLE",
  "GWR[RF RJEJGKHLH",
  "?WR[RF RIELH RBHCHDGDE",
  "?WR[RF RIELH RBEBGCHDH",
  "?WR[RF RMEJH RBHCHDGDE",
  "?WR[RF RMEJH RBEBGCHDH",
  "DWR[RF RFAG@I?MAO@P? RJHKHLGLE",
  "DWR[RF RFAG@I?MAO@P? RJEJGKHLH",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RQHRHSGSE",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RQEQGRHSH",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RTEWH RMHNHOGOE",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RTEWH RMEMGNHOH",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RXEUH RMHNHOGOE",
  "H[P[NZMYLWLQMONNPMSMUNVOWQWWVYUZS[P[ RXEUH RMEMGNHOH",
  23,
  23,
  "B]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF REHFHGGGE",
  "B]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF REEEGFHGH",
  ":]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RDEGH R=H>H?G?E",
  ":]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RDEGH R=E=G>H?H",
  ":]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RHEEH R=H>H?G?E",
  ":]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RHEEH R=E=G>H?H",
  23,
  23,
  "H[MMMXNZP[S[UZVYWWWPVNUM RQHRHSGSE",
  "H[MMMXNZP[S[UZVYWWWPVNUM RQEQGRHSH",
  "H[MMMXNZP[S[UZVYWWWPVNUM RTEWH RMHNHOGOE",
  "H[MMMXNZP[S[UZVYWWWPVNUM RTEWH RMEMGNHOH",
  "H[MMMXNZP[S[UZVYWWWPVNUM RXEUH RMHNHOGOE",
  "H[MMMXNZP[S[UZVYWWWPVNUM RXEUH RMEMGNHOH",
  "H[MMMXNZP[S[UZVYWWWPVNUM RQHRHSGSE RMAN@P?TAV@W?",
  "H[MMMXNZP[S[UZVYWWWPVNUM RQEQGRHSH RMAN@P?TAV@W?",
  23,
  "@[RQR[ RKFRQYF RCECGDHEH",
  23,
  "8[RQR[ RKFRQYF RBEEH R;E;G<H=H",
  23,
  "8[RQR[ RKFRQYF RFECH R;E;G<H=H",
  23,
  "=[RQR[ RKFRQYF R?A@@B?FAH@I? RCECGDHEH",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQHRHSGSE",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQEQGRHSH",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RTEWH RMHNHOGOE",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RTEWH RMEMGNHOH",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RXEUH RMHNHOGOE",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RXEUH RMEMGNHOH",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQHRHSGSE RMAN@P?TAV@W?",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQEQGRHSH RMAN@P?TAV@W?",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RCHDHEGEE",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RCECGDHEH",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RBEEH R;H<H=G=E",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RBEEH R;E;G<H=H",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RFECH R;H<H=G=E",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RFECH R;E;G<H=H",
  "=^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ R?A@@B?FAH@I? RCHDHEGEE",
  "=^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ R?A@@B?FAH@I? RCECGDHEH",
  39,
  39,
  40,
  40,
  41,
  41,
  42,
  42,
  29,
  29,
  44,
  44,
  45,
  45,
  23,
  23,
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQHRHSGSE RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQEQGRHSH RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RTEWH RMHNHOGOE RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RTEWH RMEMGNHOH RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RXEUH RMHNHOGOE RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RXEUH RMEMGNHOH RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQHRHSGSE RMAN@P?TAV@W? RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RQEQGRHSH RMAN@P?TAV@W? RR`RcSdTd",
  "G[MUWU RK[RFY[ RJHKHLGLE RR`RcSdTd",
  "G[MUWU RK[RFY[ RJEJGKHLH RR`RcSdTd",
  "?[MUWU RK[RFY[ RIELH RBHCHDGDE RR`RcSdTd",
  "?[MUWU RK[RFY[ RIELH RBEBGCHDH RR`RcSdTd",
  "?[MUWU RK[RFY[ RMEJH RBHCHDGDE RR`RcSdTd",
  "?[MUWU RK[RFY[ RMEJH RBEBGCHDH RR`RcSdTd",
  "D[MUWU RK[RFY[ RFAG@I?MAO@P? RJHKHLGLE RR`RcSdTd",
  "D[MUWU RK[RFY[ RFAG@I?MAO@P? RJEJGKHLH RR`RcSdTd",
  "I\\NMN[ RNOONQMTMVNWPWb RQHRHSGSE RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RQEQGRHSH RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RTEWH RMHNHOGOE RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RTEWH RMEMGNHOH RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RXEUH RMHNHOGOE RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RXEUH RMEMGNHOH RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RQHRHSGSE RMAN@P?TAV@W? RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RQEQGRHSH RMAN@P?TAV@W? RN`NcOdPd",
  "N]L[LF RLPXP RX[XF RR`RcSdTd",
  "A]L[LF RLPXP RX[XF RDEDGEHFH RR`RcSdTd",
  "9]L[LF RLPXP RX[XF RCEFH R<H=H>G>E RR`RcSdTd",
  "9]L[LF RLPXP RX[XF RCEFH R<E<G=H>H RR`RcSdTd",
  "9]L[LF RLPXP RX[XF RGEDH R<H=H>G>E RR`RcSdTd",
  "9]L[LF RLPXP RX[XF RGEDH R<E<G=H>H RR`RcSdTd",
  ">]L[LF RLPXP RX[XF R@AA@C?GAI@J? RDHEHFGFE RR`RcSdTd",
  ">]L[LF RLPXP RX[XF R@AA@C?GAI@J? RDEDGEHFH RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQHRHSGSE RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQEQGRHSH RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RTEWH RMHNHOGOE RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RTEWH RMEMGNHOH RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RXEUH RMHNHOGOE RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RXEUH RMEMGNHOH RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQHRHSGSE RMAN@P?TAV@W? RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RQEQGRHSH RMAN@P?TAV@W? RR`RcSdTd",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RCHDHEGEE RR`RcSdTd",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RCECGDHEH RR`RcSdTd",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RBEEH R;H<H=G=E RR`RcSdTd",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RBEEH R;E;G<H=H RR`RcSdTd",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RFECH R;H<H=G=E RR`RcSdTd",
  "8^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RFECH R;E;G<H=H RR`RcSdTd",
  "=^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ R?A@@B?FAH@I? RCHDHEGEE RR`RcSdTd",
  "=^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ R?A@@B?FAH@I? RCECGDHEH RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RNEOGQHSHUGVE",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RMGWG",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RPESH RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RR`RcSdTd",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RTEQH RR`RcSdTd",
  23,
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RMHNGPFTHVGWF",
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RMHNGPFTHVGWF RR`RcSdTd",
  30,
  "I[MUWU RK[RFY[ RM@W@",
  "G[MUWU RK[RFY[ RIELH",
  "G[MUWU RK[RFY[ RMEJH",
  "I[MUWU RK[RFY[ RR`RcSdTd",
  "NVQHRHSGSE",
  "NVR`RcSdTd",
  "NVQHRHSGSE",
  "KZMHNGPFTHVGWF",
  "LXMCNBPATCVBWA RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I\\NMN[ RNOONQMTMVNWPWb RPESH RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RN`NcOdPd",
  "I\\NMN[ RNOONQMTMVNWPWb RTEQH RN`NcOdPd",
  23,
  "I\\NMN[ RNOONQMTMVNWPWb RMHNGPFTHVGWF",
  "I\\NMN[ RNOONQMTMVNWPWb RMHNGPFTHVGWF RN`NcOdPd",
  "B[MPTP RW[M[MFWF RDEGH",
  "B[MPTP RW[M[MFWF RHEEH",
  "A]L[LF RLPXP RX[XF RCEFH",
  "A]L[LF RLPXP RX[XF RGEDH",
  "G]L[LF RLPXP RX[XF RR`RcSdTd",
  "JZTEWH RMHNHOGOE",
  "JZXEUH RMHNHOGOE",
  "NVQHRHSGSE RMAN@P?TAV@W?",
  "MXRMRXSZU[ RNEOGQHSHUGVE",
  "MXRMRXSZU[ RMGWG",
  "MXRMRXSZU[ RNFOGNHMGNFNH RVFWGVHUGVFVH RP>SA",
  "MXRMRXSZU[ RNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  23,
  23,
  "MXRMRXSZU[ RMHNGPFTHVGWF",
  "MXRMRXSZU[ RMCNBPATCVBWA RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "MWR[RF RN>O@QASAU@V>",
  "MWR[RF RM@W@",
  "GWR[RF RIELH",
  "GWR[RF RMEJH",
  23,
  "JZTEWH RMEMGNHOH",
  "JZXEUH RMEMGNHOH",
  "NVQEQGRHSH RMAN@P?TAV@W?",
  "H[MMMXNZP[S[UZVYWWWPVNUM RNEOGQHSHUGVE",
  "H[MMMXNZP[S[UZVYWWWPVNUM RMGWG",
  "H[MMMXNZP[S[UZVYWWWPVNUM RNFOGNHMGNFNH RVFWGVHUGVFVH RP>SA",
  "H[MMMXNZP[S[UZVYWWWPVNUM RNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  "H\\MbMQNOONQMTMVNWOXQXWWYVZT[Q[OZMX RQHRHSGSE",
  "H\\MbMQNOONQMTMVNWOXQXWWYVZT[Q[OZMX RQEQGRHSH",
  "H[MMMXNZP[S[UZVYWWWPVNUM RMHNGPFTHVGWF",
  "H[MMMXNZP[S[UZVYWWWPVNUM RMCNBPATCVBWA RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "I[RQR[ RKFRQYF RN>O@QASAU@V>",
  "I[RQR[ RKFRQYF RM@W@",
  "@[RQR[ RKFRQYF RBEEH",
  "@[RQR[ RKFRQYF RFECH",
  "A\\L[LFTFVGWHXJXMWOVPTQLQ RDEDGEHFH",
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH RP>SA",
  "LXNFOGNHMGNFNH RVFWGVHUGVFVH RT>QA",
  16,
  23,
  23,
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RPESH RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RR`RcSdTd",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RTEQH RR`RcSdTd",
  23,
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RMHNGPFTHVGWF",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RMHNGPFTHVGWF RR`RcSdTd",
  "B]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RDEGH",
  "B]PFTFVGXIYMYTXXVZT[P[NZLXKTKMLINGPF RHEEH",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RBEEH",
  "@^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RFECH",
  "F^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[ RR`RcSdTd",
  25,
  "NVQEQGRHSH",
  23,
  "F^",
  "LX",
  "F^",
  "LX",
  "NV",
  "OU",
  "PT",
  "H\\",
  "MW",
  "PT",
  "QS",
  24,
  24,
  24,
  24,
  24,
  46,
  46,
  "H\\JRZR",
  "LXVTNT",
  "F^IT[T",
  "F^IT[T",
  "H\\ODOb RUDUb",
  "JZJbZb RJ]Z]",
  "MWQGQFRDSC",
  "MWSFSGRIQJ",
  "MWSZS[R]Q^",
  "MWQFQGRISJ",
  "JZUGUFVDWC RMGMFNDOC",
  "JZOFOGNIMJ RWFWGVIUJ",
  "JZOZO[N]M^ RWZW[V]U^",
  "JZUFUGVIWJ RMFMGNIOJ",
  "I[MMWM RRFRb",
  "I[M[W[ RMMWM RRFRb",
  "E_PQPU RQUQQ RRPRV RSUSQ RTQTU RPTRVTT RPRRPTR RPQRPTQUSTURVPUOSPQ",
  "E_PPPV RQQQU RRQRU RSSUS RSRST ROPUSOV RVSOWOOVS",
  "MWRYSZR[QZRYR[",
  "MaRYSZR[QZRYR[ R\\Y]Z\\[[Z\\Y\\[",
  "MkRYSZR[QZRYR[ R\\Y]Z\\[[Z\\Y\\[ RfYgZf[eZfYf[",
  26,
  24,
  24,
  24,
  24,
  24,
  24,
  24,
  24,
  "FjJ[ZF RMFOGPIOKMLKKJIKGMF RcUeVfXeZc[aZ`XaVcU RYZZXYVWUUVTXUZW[YZ",
  "FvJ[ZF RMFOGPIOKMLKKJIKGMF RcUeVfXeZc[aZ`XaVcU RoUqVrXqZo[mZlXmVoU RYZZXYVWUUVTXUZW[YZ",
  "MWTFQL",
  "JZQFNL RWFTL",
  "G]NFKL RTFQL RZFWL",
  "MWPFSL",
  "JZSFVL RMFPL",
  "G]VFYL RPFSL RJFML",
  "LXVcR`Nc",
  "KYUMOSUY",
  "KYOMUSOY",
  "E_LMXY RXMLY RKRLSKTJSKRKT RRYSZR[QZRYR[ RRKSLRMQLRKRM RYRZSYTXSYRYT",
  "MaRYSZR[QZRYR[ RRSQGRFSGRSRF R\\Y]Z\\[[Z\\Y\\[ R\\S[G\\F]G\\S\\F",
  "I[QFQS RQYRZQ[PZQYQ[ RQYRZQ[PZQYQ[ RMGOFTFVGWIWKVMUNSORPQRQS RMGOFTFVGWIWKVMUNSORPQRQS",
  "E_JGZG",
  "OUb`aa^c\\dYeTfPfKeHdFcCaB`",
  "OUBFCEFCHBKAP@T@YA\\B^CaEbF",
  "E_N_VW RV_R[",
  "CaKRKW RRFRK RYRYW RFUKWPU RH[KWN[ RMIRKWI ROORKUO RTUYW^U RV[YW\\[",
  46,
  1,
  "KYQSVS RVbQbQDVD",
  "KYSSNS RNbSbSDND",
  "ImQYRZQ[PZQYQ[ RMGOFTFVGWIWKVMUNSORPQRQS RcYdZc[bZcYc[ R_GaFfFhGiIiKhMgNeOdPcRcS",
  "IeQYRZQ[PZQYQ[ RMGOFTFVGWIWKVMUNSORPQRQS R`YaZ`[_Z`Y`[ R`S_G`FaG`S`F",
  "MiRYSZR[QZRYR[ RRSQGRFSGRSRF R_Y`Z_[^Z_Y_[ R[G]FbFdGeIeKdMcNaO`P_R_S",
  "KYNMVMPb",
  "G^NMN[ RUMUXVZX[ RJMWMYNZP",
  "H\\NQNU RWPWV RPVPPOQOUPV RQPPPNQMSNUPVQVQP",
  "H\\VQVU RMPMV RTVTPUQUUTV RSPTPVQWSVUTVSVSP",
  "JZR[RV RWXRVMX RURRVOR",
  "MWQZQ[R]S^ RRNQORPSORNRP",
  "OUBFCEFCHBKAP@T@YA\\B^CaEbF Rb`aa^c\\dYeTfPfKeHdFcCaB`",
  "JZRFRK RMIRKWI ROORKUO RRFRK RWIRKMI RUORKOO",
  "JZM^WB RNFOGNHMGNFNH RVYWZV[UZVYV[",
  "E_JSKRNQQRSTVUYTZS",
  ">fB^B]C[EZOZQYRWSYUZ_Za[b]b^",
  "E_JSZS RR[RK RLMXY RXMLY",
  "E_LRMSLTKSLRLT RXYYZX[WZXYX[ RXKYLXMWLXKXM",
  "D`KFHL RQFNL RWFTL R]FZL",
  "E_KRLSKTJSKRKT RRYSZR[QZRYR[ RRKSLRMQLRKRM RYRZSYTXSYRYT",
  "E_LXMYLZKYLXLZ RLLMMLNKMLLLN RRRSSRTQSRRRT RXXYYXZWYXXXZ RXLYMXNWMXLXN",
  "MWRYSZR[QZRYR[ RRNSORPQORNRP",
  "E_KRLSKTJSKRKT RRYSZR[QZRYR[ RRKSLRMQLRKRM RYRZSYTXSYRYT",
  "E_JSZS RR[RK RLXMYLZKYLXLZ RLLMMLNKMLLLN RXXYYXZWYXXXZ RXLYMXNWMXLXN",
  "CaR\\S]R^Q]R\\R^ RRRSSRTQSRRRT RRHSIRJQIRHRJ",
  "CaR^S_R`Q_R^R` RRVSWRXQWRVRX RRNSORPQORNRP RRFSGRHQGRFRH",
  "OU",
  24,
  24,
  24,
  24,
  24,
  23,
  23,
  23,
  23,
  23,
  24,
  24,
  24,
  24,
  24,
  24,
  "JZQ@S@UAVDVJUMSNQNOMNJNDOAQ@",
  "NVRDRN RR=Q>R?S>R=R?",
  23,
  23,
  "JZUFUN RQ@NJWJ",
  "JZV@O@NFPESEUFVHVKUMSNPNNM",
  "JZNHOFQESEUFVHVKUMSNQNOMNKNFOCPAR@U@",
  "JZM@W@PN",
  "JZQFOENCOAQ@S@UAVCUESFQFOGNINKOMQNSNUMVKVIUGSF",
  "JZVFUHSIQIOHNFNCOAQ@S@UAVCVHUKTMRNON",
  "I[LHXH RRBRN",
  "I[LHXH",
  "I[LJXJ RLFXF",
  "MWT=S>RAQFQJROSRTS",
  "MWP=Q>RASFSJROQRPS",
  "KZODON ROEQDSDUEVGVN",
  "JZQSSSUTVWV]U`SaQaO`N]NWOTQS",
  "JZVaNa RNVPURSRa",
  "JZNTPSSSUTVVVXUZNaVa",
  "JZNSVSRXSXUYV[V^U`SaPaN`",
  "JZUYUa RQSN]W]",
  "JZVSOSNYPXSXUYV[V^U`SaPaN`",
  "JZN[OYQXSXUYV[V^U`SaQaO`N^NYOVPTRSUS",
  "JZMSWSPa",
  "JZQYOXNVOTQSSSUTVVUXSYQYOZN\\N^O`QaSaU`V^V\\UZSY",
  "JZVYU[S\\Q\\O[NYNVOTQSSSUTVVV[U^T`RaOa",
  "I[L[X[ RRURa",
  "I[L[X[",
  "I[L]X] RLYXY",
  "MWTPSQRTQYQ]RbSeTf",
  "MWPPQQRTSYS]RbQePf",
  24,
  "KZOXQWSWUXVZVa RV`TaQaO`N^O\\Q[V[",
  "LYV`TaRaP`O^OZPXRWSWUXVZV[O\\",
  "KYQaO`N^NZOXQWSWUXVZV^U`SaQa",
  "KYNWVa RVWNa",
  "LYOXQWSWUXVZV^U`SaRaP`O^O]V\\",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "F[XMPMP[X[ RTGRFNFLGKHJJJPKRLSNTUT",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RSBG_ RZBN_",
  "F[WYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH RR[RM RRQSOTNVMXM",
  "HZTPMP RM[MFWF RJVRV",
  "H[LMTM RL[W[ RO[OIPGRFUFWG RLSTS",
  "D`I[IM RIOJNLMOMQNRPR[ RRPSNUMXMZN[P[[ RWHM`",
  "G]L[LFX[XF RHV\\V RHP\\P",
  "GyL[LFTFVGWHXJXMWOVPTQLQ R^MfM RaFaXbZd[f[ RlZn[r[tZuXuWtUrToTmSlQlPmNoMrMtN",
  "GmX[QQ RL[LFTFVGWHXJXMWOVPTQLQ R`Zb[f[hZiXiWhUfTcTaS`Q`PaNcMfMhN",
  "F^IFN[RLV[[F RHV\\V RHP\\P",
  "D`I[IFOFRGTIULUR RONOUPXRZU[[[[F",
  "I\\W[WF RWZU[Q[OZNYMWMQNOONQMUMWN RRHZH RXaNa",
  "F[HSQS RHNTN RWYVZS[Q[NZLXKVJRJOKKLINGQFSFVGWH",
  "G\\L[LF RX[OO RXFLR RLOTO",
  "JZLFXF RR[RF ROVUR ROPUL",
  "IoK[RFY[K[ R`b`QaObNdMgMiNjOkQkWjYiZg[d[bZ`X",
  "G]ITJSLRNSOTQUSTXOYLYIXGVFUFSGRIRLSOXTYVYWXYWZT[",
  "G\\L[LFTFVGWHXJXMWOVPTQLQ RHL\\L",
  "F[VGTFQFNGLIKKJOJRKVLXNZQ[S[VZWYWRSR RRCR^",
  "I[K[RFY[ RHV\\V RHP\\P",
  "H\\XZU[P[NZMYLWLUMSNRPQTPVOWNXLXJWHVGTFOFLG RRCR^",
  "HZVZT[P[NZMYLWLQMONNPMTMVN RRJR^",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "F^J[O[OWMVKTJQJLKIMGPFTFWGYIZLZQYTWVUWU[Z[",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "E_ZSJS RNWJSNO",
  "E_R[RK RNORKVO",
  "E_JSZS RVWZSVO",
  "E_RKR[ RVWR[NW",
  "E_JSZS RVWZSVO RNOJSNW",
  "E_R[RK RNORKVO RVWR[NW",
  "E_KLYZ RRLKLKS",
  "E_YLKZ RRLYLYS",
  "E_YZKL RRZYZYS",
  "E_KZYL RRZKZKS",
  "E_ZSJS RRWVO RNOJSNW",
  "E_JSZS RRONW RVWZSVO",
  "E_JWJQPQ RJQMTOUQTSRUQWRZU",
  "E_ZWZQTQ RZQWTUUSTQROQMRJU",
  "E_ZSJS RTOPSTW RNWJSNO",
  "E_R[RK RNURQVU RNORKVO",
  "E_JSZS RPOTSPW RVWZSVO",
  "E_RKR[ RVQRUNQ RVWR[NW",
  "E_JSVS RZOVSZW RNWJSNO",
  "E_ZSNS RJONSJW RVWZSVO",
  "E_ZOZW RJSZS RNWJSNO",
  "E_R[RK RV[N[ RNORKVO",
  "E_JOJW RZSJS RVWZSVO",
  "E_RKR[ RNKVK RVWR[NW",
  "E_N[V[ RR[RK RNWR[VW RNORKVO",
  "E_NWJSNO RJSWSYRZPYNWM",
  "E_VWZSVO RZSMSKRJPKNMM",
  "E_NWJSNO RJSWSYRZPYNWMUNTPTW",
  "E_VWZSVO RZSMSKRJPKNMMONPPPW",
  "E_PUJUJO RZWZQTQ RZQWTUUSTQROQMRJU",
  "E_JSZS RTOPW RNOJSNW RVWZSVO",
  "E_PWR[VY ROKLTVOR[",
  "E_V[VOJO RNSJONK",
  "E_N[NOZO RVSZOVK",
  "E_VKVWJW RNSJWN[",
  "E_NKNWZW RVSZWV[",
  "E_JOVOV[ RZWV[RW",
  "E_VKVWJW RNSJWN[",
  "E_OQKUGQ RYRYQXNVLSKQKNLLNKQKU",
  "E_UQYU]Q RKRKQLNNLQKSKVLXNYQYU",
  "E_KLYZ RKHYH RRLKLKS",
  "E_JWZW RJKJS RZSZ[ RZOJO RNSJONK RV[ZWVS",
  "E_[KUKUQ RMMLNKQKSLVNXQYSYVXXVYSYQXNUK",
  "E_IKOKOQ RWMXNYQYSXVVXSYQYNXLVKSKQLNOK",
  "E_ZSJSNO",
  "E_ZSJSNW",
  "E_R[RKVO",
  "E_R[RKNO",
  "E_JSZSVO",
  "E_JSZSVW",
  "E_RKR[VW",
  "E_RKR[NW",
  "E_ZWJW RJOZO RVSZOVK RN[JWNS",
  "E_N[NK RVKV[ RJONKRO RRWV[ZW",
  "E_JWZW RZOJO RNSJONK RV[ZWVS",
  "E_ZWJW RJOZO RN[JWNSJONK",
  "E_N[NK RVKV[ RJONKROVKZO",
  "E_JWZW RZOJO RV[ZWVSZOVK",
  "E_VKV[ RN[NK RZWV[RWN[JW",
  "E_JVZVVZ RZPJPNL",
  "E_ZVJVNZ RJPZPVL",
  "E_ZPMP RZVMV RRXVN ROXJSON",
  "E_MVWV RMPWP RSNQX ROXJSON RUNZSUX",
  "E_JVWV RJPWP RRNNX RUNZSUX",
  "E_ZPMP RZVMV ROXJSON",
  "E_ONO[ RUNU[ RWPRKMP",
  "E_JVWV RJPWP RUNZSUX",
  "E_UXUK ROXOK RMVR[WV",
  "E_MVWV RMPWP ROXJSON RUNZSUX",
  "E_OXON RUXUN RMVR[WV RWPRKMP",
  "E_[XOL RW\\KP RSLKLKT",
  "E_IXUL RM\\YP RQLYLYT",
  "E_INUZ RMJYV RQZYZYR",
  "E_[NOZ RWJKV RSZKZKR",
  "E_ZXOX RZSJS RZNON RQLJSQZ",
  "E_JXUX RJSZS RJNUN RSLZSSZ",
  "E_NWJSNO RZUWQTUQQNULSJS",
  "E_VWZSVO RJUMQPUSQVUXSZS",
  "E_NXVX RNSVS RR[RK RNORKVO",
  "E_VNNN RVSNS RRKR[ RVWR[NW",
  "E_ZSWS RSSQS RMSJS RNOJSNW",
  "E_R[RX RRTRR RRNRK RNORKVO",
  "E_JSMS RQSSS RWSZS RVWZSVO",
  "E_RKRN RRRRT RRXR[ RVWR[NW",
  "E_ZSJS RJWJO RNOJSNW",
  "E_JSZS RZOZW RVWZSVO",
  "E_ZPZVOVOXJSONOPZP",
  "E_U[O[OPMPRKWPUPU[",
  "E_JVJPUPUNZSUXUVJV",
  "E_OKUKUVWVR[MVOVOK",
  "E_U[O[OWUWU[ RUSOSOPMPRKWPUPUS",
  "E_W[M[MWOWOPMPRKWPUPUWWWW[",
  "E_ONUN RW[M[MWOWOPMPRKWPUPUWWWW[",
  "E_RKR[ RW[M[MWOWOPMPRKWPUPUWWWW[",
  "E_PPMPRKWPTP RU[O[OSMSRNWSUSU[",
  "E_PPMPRKWPTP RW[M[MWOWOSMSRNWSUSUWWWW[",
  "E_JNNNNPUPUNZSUXUVNVNXJXJN",
  "E_Z[NO RZKJKJ[ RUONONV",
  "E_JKVW RJ[Z[ZK ROWVWVP",
  "E_MPRKWPUPUVWVR[MVOVOPMP",
  "E_JSZS RVWZSVO RTRTTSVQWOWMVLTLRMPOOQOSPTR",
  "E_V[VK RNKN[ RZOVKRO RRWN[JW",
  "E_J[Z[ RJKZK RZSJS RVGZKVOZSVWZ[V_",
  "E_ZSJS RTWTO RNOJSNW",
  "E_JSZS RPOPW RVWZSVO",
  "E_JSZS RRORW RNOJSNW RVWZSVO",
  "E_ZSJS RWWWO RRWRO RNOJSNW",
  "E_JSZS RMOMW RRORW RVWZSVO",
  "E_JSZS RPOPW RTOTW RNWJSNO RVWZSVO",
  "E_NSZS RNWNOJSNW",
  "E_VSJS RVWVOZSVW",
  "E_NSVS RNWJSNONW RVWVOZSVW",
  "I[MLWL RKFR[YF",
  "HZVHUGSFPFNGMHLKLVMYNZP[S[UZVY",
  "H[WOVNTMPMNNMOLQLWMYNZP[S[UZVYWWWJVHUGSFOFMG",
  "I\\WPPP RM[W[WFMF",
  "I\\WQPQ RMFWFW[M[ RXCL`",
  "C`G[\\F ROFTFXHZJ\\N\\SZWXYT[O[KYIWGSGNIJKHOF",
  "I[K[RFY[K[",
  "I[YFR[KFYF",
  "C`\\QGQ R\\GOGKIIKGOGSIWKYO[\\[",
  "C`[CH^ R\\QGQ R\\GOGKIIKGOGSIWKYO[\\[",
  "E_JSZS RZZPZMYKWJTJRKOMMPLZL",
  "DaHP]P RHZUZYX[V]R]N[JYHUFHF",
  "DaI^\\C RHP]P RHZUZYX[V]R]N[JYHUFHF",
  "E_ZSJS RJZTZWYYWZTZRYOWMTLJL",
  "E_M[WQ RMZWP RMYWO RMXWN RMWWM RMVWL RMUWK RMTVK RMSUK RMRTK RMQSK RMPRK RMOQK RMNPK RMMOK RMLNK RN[WR RO[WS RP[WT RQ[WU RR[WV RS[WW RT[WX RU[WY RV[WZ RM[MKWKW[M[",
  "E_Z`ZFJFJ`",
  "E_ZFZ`J`JF",
  "E_Z`I`TSIF[F",
  0,
  "E_ZWJW RROR_ RJKZK",
  "E_JSZS RR[RK RRDQERFSERDRF",
  1,
  "KYID[_",
  "E_KOYW RR[RK RYOKW",
  "E_PQRPTQUSTURVPUOSPQ",
  "E_PQPU RQUQQ RRPRV RSUSQ RTQTU RPTRVTT RPRRPTR RPQRPTQUSTURVPUOSPQ",
  "IbMTQSS[bB",
  "IbMTQSS[bB RN@V@RESEUFVHVKUMSNPNNM",
  "IbMTQSS[bB RUFUN RQ@NJWJ",
  "E_XPWPUQQUOVMULSMQOPQQUUWVXV",
  "E_TQVPXQYSXUVVTUPQNPLQKSLUNVPUTQ",
  "E_JKJ[Z[",
  "E_ZKJ[Z[",
  "E_ZKJ[Z[ RPSRUTZT]",
  "E_Z[JSZK RSYTWUSTOSM",
  22,
  "H\\NUVQ RRDRb",
  "H\\ODOb RUDUb",
  "H\\LVXP RODOb RUDUb",
  "E_[[RKI[",
  "E_IKR[[K",
  "E_Z[ZQXMTKPKLMJQJ[",
  "E_JKJULYP[T[XYZUZK",
  "H\\L]M_O`Q_R]RISGUFWGXI",
  "D`H]I_K`M_N]NIOGQFSGTI RP]Q_S`U_V]VIWGYF[G\\I",
  "@dD]E_G`I_J]JIKGMFOGPI RL]M_O`Q_R]RISGUFWGXI RT]U_W`Y_Z]ZI[G]F_G`I",
  "H\\L]M_O`Q_R]RISGUFWGXI RRMUNWPXSWVUXRYOXMVLSMPONRM",
  "D`H]I_K`M_N]NIOGQFSGTI RP]Q_S`U_V]VIWGYF[G\\I RVMYN[P\\S[VYXVYNYKXIVHSIPKNNMVM",
  "@dD]E_G`I_J]JIKGMFOGPI RL]M_O`Q_R]RISGUFWGXI RT]U_W`Y_Z]ZI[G]F_G`I RZM]N_P`S_V]XZYJYGXEVDSEPGNJMZM",
  "H\\URXU[R RLSMPONRMUNWPXSXU RL]M_O`Q_R]RISGUFWGXI",
  "H\\UQXT[Q RL]M_O`Q_R]RISGUFWGXI RLSMPONRMUNWPXSWVUXRYOXMVLS",
  "H\\UUXR[U RL]M_O`Q_R]RISGUFWGXI RLSMPONRMUNWPXSWVUXRYOXMVLS",
  "E_KXLYKZJYKXKZ RRLSMRNQMRLRN RYXZYYZXYYXYZ",
  "E_YNXMYLZMYNYL RRZQYRXSYRZRX RKNJMKLLMKNKL",
  "JZRXSYRZQYRXRZ RRLSMRNQMRLRN",
  "E_LXMYLZKYLXLZ RLLMMLNKMLLLN RXXYYXZWYXXXZ RXLYMXNWMXLXN",
  "E_JSZS RRFQGRHSGRFRH",
  "E_JSTS RYXZYYZXYYXYZ RYLZMYNXMYLYN",
  "E_JSZS RLXMYLZKYLXLZ RLLMMLNKMLLLN RXXYYXZWYXXXZ RXLYMXNWMXLXN",
  "E_JSKRNQQRSTVUYTZS RRXSYRZQYRXRZ RRLSMRNQMRLRN",
  "E_JSKRNQQRSTVUYTZS",
  "E_ZSYRVQSRQTNUKTJS",
  "E_WPYQZSYUWVTUPQMPKQJSKUMV",
  "E_JSKNLLNKPLQNSXTZV[XZYXZS",
  "E_RKSLTOSRQTPWQZR[",
  "E_JSKRNQQRSTVUYTZS RVKN[",
  "E_ZPJP RZVYWVXSWQUNTKUJV",
  "E_JVZV RJPKONNQOSQVRYQZP",
  "E_JVZV RJPKONNQOSQVRYQZP RVKN[",
  "E_JYZY RJSZS RJMKLNKQLSNVOYNZM",
  "E_JYZY RJSZS RUPO\\ RJMKLNKQLSNVOYNZM",
  "E_JYZY RJSZS RJMKLNKQLSNVOYNZM RXGL_",
  "E_JVKUNTQUSWVXYWZV RJPKONNQOSQVRYQZP",
  "E_JVKUNTQUSWVXYWZV RJPKONNQOSQVRYQZP RVKN[",
  "E_JYZY RJSKRNQQRSTVUYTZS RJMKLNKQLSNVOYNZM",
  "E_JYKXNWQXSZV[YZZY RJSKRNQQRSTVUYTZS RJMKLNKQLSNVOYNZM",
  "E_ZYJY RZSJS RZMYLVKSLQNNOKNJM",
  "E_JXLWPVTVXWZX RJNLOPPTPXOZN",
  "E_JVNVNWOYQZSZUYVWVVZV RJPNPNOOMQLSLUMVOVPZP",
  "E_ZVJV RJPNPNOOMQLSLUMVOVPZP",
  "E_JPZP RZVJV RRHQIRJSIRHRJ",
  "E_JPZP RZVJV RRXSYRZQYRXRZ RRLSMRNQMRLRN",
  "E_JPZP RZVJV RKJLKKLJKKJKL RYZZ[Y\\X[YZY\\",
  "E_ZPJP RJVZV RYJXKYLZKYJYL RKZJ[K\\L[KZK\\",
  "AcNP^P R^VNV RGVHWGXFWGVGX RGNHOGPFOGNGP",
  "AcVPFP RFVVV R]V\\W]X^W]V]X R]N\\O]P^O]N]P",
  "E_JPZP RZVJV RPQRPTQUSTURVPUOSPQ",
  "E_JPZP RZVJV RRJPIOGPERDTEUGTIRJ",
  "E_JPZP RZVJV RNJOHQGSGUHVJ",
  "E_JPZP RZVJV RNJRGVJ",
  "E_JPZP RZVJV RNGRJVG",
  "E_JPZP RZVJV RRATGOCUCPGRA",
  "E_JPZP RZVJV RR?NJVJR?",
  "E_JPZP RYC]C RZVJV R]?[@ZBZJ RM?MJKJIIHGHEICKBMB RQFVFVCUBRBQCQIRJUJ",
  "E_JPZP RZVJV RMBMJ RMCNBQBRCRJ RRCSBVBWCWJ",
  "E_JPZP RZVJV RRHSIRJQIRHRJ RN@P?S?U@VBUDSE",
  "E_JPZP RTMPY RZVJV",
  "E_JYZY RJSZS RJMZM",
  "E_JYZY RJSZS RJMZM RXGL_",
  "E_J\\Z\\ RJPZP RJJZJ RZVJV",
  "E_ZZJZ RZVJPZJ",
  "E_JZZZ RJVZPJJ",
  "E_J]Z] RZWJW RZSJMZG",
  "E_Z]J] RJWZW RJSZMJG",
  "E_J]Z] RTTP` RZWJW RZSJMZG",
  "E_JWZW RTTP` RZ]J] RJSZMJG",
  "=gRMBSRY RbMRSbY",
  "=gRMbSRY RBMRSBY",
  "I[OCPDRGSITLUQUUTZS]R_PbOc RUcTbR_Q]PZOUOQPLQIRGTDUC",
  "E_JXLWPVTVXWZX RJNLOPPTPXOZN RVKN[",
  "E_ZMJSZY RVKN[",
  "E_JMZSJY RVKN[",
  "E_ZZJZ RZVJPZJ RXGL_",
  "E_JZZZ RJVZPJJ RXGL_",
  "E_ZVJPZJ RJZKYNXQYS[V\\Y[ZZ",
  "E_JVZPJJ RJZKYNXQYS[V\\Y[ZZ",
  "E_ZVJPZJ RJZKYNXQYS[V\\Y[ZZ RXGL_",
  "E_JVZPJJ RJZKYNXQYS[V\\Y[ZZ RXGL_",
  "E_JSZYJ_ RZSJMZG",
  "E_ZSJYZ_ RJSZMJG",
  "E_JSZYJ_ RZSJMZG RXGL_",
  "E_ZSJYZ_ RJSZMJG RXGL_",
  "E_ZKXNVPRRJSRTVVXXZ[",
  "E_JKLNNPRRZSRTNVLXJ[",
  "E_JVRWVYX[Z^ RZHXKVMROJPRQVSXUZX",
  "E_ZVRWNYL[J^ RJHLKNMROZPRQNSLUJX",
  "E_J[KZNYQZS\\V]Y\\Z[ RZHXKVMROJPRQVSXUZX",
  "E_J[KZNYQZS\\V]Y\\Z[ RJXLUNSRQZPRONMLKJH",
  "E_ZKXNVPRRJSRTVVXXZ[ RVKN[",
  "E_JKLNNPRRZSRTNVLXJ[ RVKN[",
  "E_ZMNMLNKOJQJUKWLXNYZY",
  "E_JMVMXNYOZQZUYWXXVYJY",
  "E_ZMNMLNKOJQJUKWLXNYZY RVKN[",
  "E_JMVMXNYOZQZUYWXXVYJY RVKN[",
  "E_J\\Z\\ RZJNJLKKLJNJRKTLUNVZV",
  "E_Z\\J\\ RJJVJXKYLZNZRYTXUVVJV",
  "E_J\\Z\\ RZJNJLKKLJNJRKTLUNVZV RXGL_",
  "E_Z\\J\\ RJJVJXKYLZNZRYTXUVVJV RXGL_",
  "E_J\\Z\\ RZJNJLKKLJNJRKTLUNVZV RSYQ_",
  "E_Z\\J\\ RJJVJXKYLZNZRYTXUVVJV RSYQ_",
  "E_JKJULYP[T[XYZUZK ROSUS RSUUSSQ",
  "E_JKJULYP[T[XYZUZK RRRQSRTSSRRRT",
  "E_JKJULYP[T[XYZUZK RLSXS RRMRY",
  "E_ZYJYJMZM",
  "E_JYZYZMJM",
  "E_Z\\J\\ RZVJVJJZJ",
  "E_J\\Z\\ RJVZVZJJJ",
  "E_Z[ZKJKJ[",
  "E_JKJ[Z[ZK",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RLSXS RRMRY",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RLSXS",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RMNWX RWNMX",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RWFM^",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRRQSRTSSRRRT",
  47,
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRNRS RMQRSWQ ROWRSUW",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RLUXU RLQXQ",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RNSVS",
  "E_JKZKZ[J[JK RLSXS RRMRY",
  "E_JKZKZ[J[JK RLSXS",
  "E_JKZKZ[J[JK RMNWX RWNMX",
  "E_JKZKZ[J[JK RRRQSRTSSRRRT",
  "E_J[JK RJSZS",
  "E_Z[ZK RZSJS",
  "E_ZKJK RRKR[",
  "E_J[Z[ RR[RK",
  "I[NSVS RNKN[",
  "I[NVVV RNPVP RNKN[",
  "E_JVZV RJPZP RJKJ[",
  "E_JKJ[ RPSZS RPKP[",
  "E_JKJ[ ROKO[ RTKT[ RYSTS",
  "E_JKJ[ RPVYV RPPYP RPKP[",
  "E_J[JK RJSZS RXGL_",
  "E_JVZV RJPZP RJKJ[ RXGL_",
  "E_JKJ[ RPSZS RPKP[ RXGL_",
  "E_JKJ[ RPVYV RPPYP RPKP[ RXGL_",
  "E_VKXLYNXPVQRRJSRTVUXVYXXZV[",
  "E_NKLLKNLPNQRRZSRTNULVKXLZN[",
  "E_JSZYZMJS",
  "E_ZSJYJMZS",
  "E_Z[J[ RJQZWZKJQ",
  "E_J[Z[ RZQJWJKZQ",
  "BbXQXU RYQYU RZPZV R[Q[U R\\Q\\U RMSLQJPHQGSHUJVLUMSWSXUZV\\U]S\\QZPXQWS",
  "BbLQLU RKQKU RJPJV RIQIU RHQHU RWSXQZP\\Q]S\\UZVXUWSMSLUJVHUGSHQJPLQMS",
  "E_JSTSUUWVYUZSYQWPUQTS",
  "E_JSNS RR[RW RRKRO RZSVS",
  "I[NFVF RRFR[",
  "E_J[Z[ RZKRVJK",
  "E_ZKJK RJ[RPZ[",
  "E_JKZK RZPR[JP",
  "E_JKJ[Z[ RJOLOQQTTVYV[",
  "E_Z[ZKJ[Z[",
  "Bb_`REE`",
  "BbEFRa_F",
  "Bb]`]O\\KZHWFSEQEMFJHHKGOG`",
  "BbGFGWH[J^M`QaSaW`Z^\\[]W]F",
  "E_RaJSRFZSRa",
  26,
  "I[RRTXOTUTPXRR",
  "E_ZSJS RRXSYRZQYRXRZ RRLSMRNQMRLRN RLMXY RXMLY",
  "E_JKZ[ZKJ[JK",
  "E_ZKJ[JKZ[",
  "E_JKZ[ZKJ[",
  "E_JKZ[ RRSJ[",
  "E_ZKJ[ RRSZ[",
  "E_ZVJV RZPYOVNSOQQNRKQJP",
  "E_JKMMOOQSR[SSUOWMZK",
  "E_Z[WYUWSSRKQSOWMYJ[",
  "E_ZPSPQQPSQUSVZV RZ\\Q\\N[KXJUJQKNNKQJZJ",
  "E_JPQPSQTSSUQVJV RJ\\S\\V[YXZUZQYNVKSJJJ",
  "E_U[UTTRRQPROTO[ R[[[RZOWLTKPKMLJOIRI[",
  "E_OKORPTRUTTURUK RIKITJWMZP[T[WZZW[T[K",
  "E_RKR[ RL[LSMPNOQNSNVOWPXSX[",
  "E_JPZP RZVJV RODOb RUDUb",
  "E_ZMJSZY RYRXSYTZSYRYT",
  "E_JMZSJY RKRJSKTLSKRKT",
  "5oJM:SJY RZMJSZY RjMZSjY",
  "5oZMjSZY RJMZSJY R:MJS:Y",
  "E_ZSJS RJWZ[J_ RZOJKZG",
  "E_JSZS RZWJ[Z_ RJOZKJG",
  "E_ZLJL RZPJVZ\\",
  "E_JLZL RJPZVJ\\",
  "E_JPROVMXKZH RZ^X[VYRWJVRUVSXQZN",
  "E_ZPRONMLKJH RJ^L[NYRWZVRUNSLQJN",
  "E_JPROVMXKZH RZ^X[VYRWJVRUVSXQZN RXGL_",
  "E_ZPRONMLKJH RJ^L[NYRWZVRUNSLQJN RXGL_",
  "E_Z\\J\\ RZVJVJJZJ RXGL_",
  "E_J\\Z\\ RJVZVZJJJ RXGL_",
  "E_Z\\J\\ RZVJVJJZJ RSYQ_",
  "E_J\\Z\\ RJVZVZJJJ RSYQ_",
  "E_ZVJPZJ RJZKYNXQYS[V\\Y[ZZ RSWQ]",
  "E_JVZPJJ RJZKYNXQYS[V\\Y[ZZ RSWQ]",
  "E_J[KZNYQZS\\V]Y\\Z[ RZHXKVMROJPRQVSXUZX RSXQ^",
  "E_J[KZNYQZS\\V]Y\\Z[ RJXLUNSRQZPRONMLKJH RSXQ^",
  "E_JSZYZMJS RXGL_",
  "E_ZSJYJMZS RXGL_",
  "E_Z[J[ RJQZWZKJQ RXGL_",
  "E_J[Z[ RZQJWJKZQ RXGL_",
  "CaR\\S]R^Q]R\\R^ RRRSSRTQSRRRT RRHSIRJQIRHRJ",
  "CaHRISHTGSHRHT RRRSSRTQSRRRT R\\R]S\\T[S\\R\\T",
  "Ca\\H[I\\J]I\\H\\J RRRQSRTSSRRRT RH\\G]H^I]H\\H^",
  "CaHHIIHJGIHHHJ RRRSSRTQSRRRT R\\\\]]\\^[]\\\\\\^",
  ">`BQ\\Q R\\GOGKIIKGOGSIWKYO[\\[",
  ">`GQ\\Q R\\M\\U R\\GOGKIIKGOGSIWKYO[\\[",
  "E_JSZS RZPZV RZZPZMYKWJTJRKOMMPLZL",
  "C`\\QGQ R\\GOGKIIKGOGSIWKYO[\\[ RR@QARBSAR@RB",
  "C`GA\\A R\\QGQ R\\[O[KYIWGSGOIKKIOG\\G",
  "E_JSZS RZGJG RZLPLMMKOJRJTKWMYPZZZ",
  "C`G`\\` R\\PGP R\\FOFKHIJGNGRIVKXOZ\\Z",
  "C`HT\\T RHN\\N R\\GOGKIIKGOGSIWKYO[\\[",
  "DfbQHQ RHGUGYI[K]O]S[WYYU[H[",
  "Df]QHQ RHMHU RHGUGYI[K]O]S[WYYU[H[",
  "E_ZSJS RJPJV RJZTZWYYWZTZRYOWMTLJL",
  "Da]AHA RHQ]Q RH[U[YY[W]S]O[KYIUGHG",
  "E_ZSJS RJGZG RJLTLWMYOZRZTYWWYTZJZ",
  "C`GQ\\Q R\\GGGG[\\[",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RZKJ[",
  "E_JQRWROZU",
  "E_J[JORGZOZ[J[",
  "E_NORKVO",
  "E_VWR[NW",
  "E_ZKJK RJ[RPZ[",
  "E_JNZN RJHZH RJ[RSZ[",
  "H\\RDSETGSIRJQLRNSOTQSSRTQVRXSYT[S]R^Q`Rb",
  "KYQbQDVD",
  "KYSbSDND",
  "KYQDQbVb",
  "KYSDSbNb",
  "E_RWR[ RVSZS",
  "E_RWR[ RNSJS",
  "E_RORK RVSZS",
  "E_RORK RNSJS",
  "E_ZQJQJV",
  "D`[JZLYPYVZZ[\\Y[UZOZK[I\\JZKVKPJLIJKKOLULYK[J",
  "E_JSJQLMPKTKXMZQZS",
  "E_JSJQLMPKTKXMZQZS RJSZS",
  "E_JMLLPKTKXLZMR[JM",
  "E_PUJ[ RTKWLYNZQYTWVTWQVOTNQONQLTK",
  "E_JSZS RR[RK RVRUPSOQOOPNRNTOVQWSWUVVTVR",
  "E_JWZW RJOZO RNKN[ RVKV[",
  "E_LPXPZO[MZKXJVKUMUYV[X\\Z[[YZWXVLVJWIYJ[L\\N[OYOMNKLJJKIMJOLP",
  "E_ZUJUJP",
  "E_RORSUS RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_M[RVW[ RN[RWV[ RP[RYT[ RS[RZQ[ RU[RXO[ RYMRPKMROYM RJFZFZKYMKTJVJ[Z[ZVYTKMJJJF",
  "JZVFNFNM",
  "JZNFVFVM",
  "JZV[N[NT",
  "JZN[V[VT",
  "H\\RbRMSITGVFXGYI",
  "H\\RDRYQ]P_N`L_K]",
  "E_JUKTMSRRWSYTZU",
  "E_ZQYRWSRTMSKRJQ",
  "E_LKHK RXK\\K RNORKVO",
  "@dXK^K RFKLKX[^[",
  "AfJKZ[ RZKJ[ RFKZKbSZ[F[FK",
  "AcJKZ[ RZKJ[ RFK^K^[F[FK",
  "9k>VfV R>LfL RCQCL RD[DV REVEQ RFLFG RHQHL RJVJQ RK[KV RKLKG RMQML ROVOQ RPLPG RRQRL RTVTQ RULUG RWQWL RYVYQ RZ[ZV RZLZG R\\Q\\L R^V^Q R_L_G R`[`V R>QaQaL R>[>GfGf[>[",
  "KYUcOSUC",
  "KYOcUSOC",
  ">cZKJ[ RJKZ[ R^KJKBSJ[^[^K",
  "AcKOKW RR[YW RRKYO RRE^L^ZRaFZFLRE",
  "H\\PNKX RYNTX RVRUPSOQOOPNRNTOVQWSWUVVTVR",
  "E_N[J[JW RZSRSJ[ RVRUPSOQOOPNRNTOVQWSWUVVTVR",
  "E_JSZS RNYVY RVMNM",
  "E_RPRKNN RZPZKVN RRKJ[R[ZK",
  "H\\LS[S RRMRY RXP[SXV RVRUPSOQOOPNRNTOVQWSWUVVTVR",
  "E_ZSJ\\JJZS RJSZS",
  "E_J[JRZ[J[",
  "E_JWJ[Z[ZW",
  "E_VWR[NW",
  "D`JaZa RJFZF RRFRa",
  "D`MFWFWaMaMF",
  "D`IF[F[aIaIF RJPZP RZVJV",
  "D`IF[F[aIaIF RZSJS RRXSYRZQYRXRZ RRLSMRNQMRLRN",
  "D`IF[F[aIaIF RRJ[SR\\ISRJ",
  "D`IF[F[aIaIF RPQRPTQUSTURVPUOSPQ",
  "D`IF[F[aIaIF RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRbRD",
  47,
  "E_JSZS RZKJ[",
  "E_JSZS RJKZ[",
  "D`IaIF[F[aIa[F",
  "D`[a[FIFIa[aIF",
  "D`IF[F[aIaIF RZMJSZY",
  "D`IF[F[aIaIF RJMZSJY",
  "E_ZSJS RNWJSNO RR[RK",
  "E_JSZS RVWZSVO RR[RK",
  "D`IF[F[aIaIF RZSJS RNWJSNO",
  "D`IF[F[aIaIF RJSZS RVWZSVO",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RLGX_",
  "E_J[Z[ RR[RK RZaJa",
  "E_RKX[L[RK RRbRD",
  "D`IF[F[aIaIF RIKR[[K",
  "D`IF[F[aIaIF RRKX[L[RK",
  "E_ZKJK RRKR[ RVRUPSOQOOPNRNTOVQWSWUVVTVR",
  "E_R[RK RNORKVO RJSZS",
  "D`IF[F[aIaIF RR[RK RNORKVO",
  "E_ZKJK RRKR[ RMEWE",
  "E_R[LKXKR[ RRbRD",
  "D`IF[F[aIaIF R[[RKI[",
  "D`IF[F[aIaIF RR[LKXKR[",
  "E_J[Z[ RR[RK RPQRPTQUSTURVPUOSPQ",
  "E_RKR[ RVWR[NW RJSZS",
  "D`IF[F[aIaIF RRKR[ RVWR[NW",
  "JZJ]Z] RSFQJ",
  "E_RKX[L[RK RJ]Z]",
  "E_RJ[SR\\ISRJ RJ]Z]",
  "E_PQRPTQUSTURVPUOSPQ RJ]Z]",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RJ]Z]",
  "E_Z[ZQXMTKPKLMJQJ[ RPQRPTQUSTURVPUOSPQ",
  "D`IF[F[aIaIF RSFQJ",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRPTVORURPVRP",
  "D`IF[F[aIaIF RRYSZR[QZRYR[ RRNSORPQORNRP",
  "E_ZKJK RRKR[ RNDOENFMENDNF RVDWEVFUEVDVF",
  "E_R[LKXKR[ RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "E_RKWZJQZQMZRK RNDOENFMENDNF RVDWEVFUEVDVF",
  "E_PQRPTQUSTURVPUOSPQ RNIOJNKMJNINK RVIWJVKUJVIVK",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RNDOENFMENDNF RVDWEVFUEVDVF",
  "E_JKJULYP[T[XYZUZK RRbRD",
  "E_ZMNMLNKOJQJUKWLXNYZY RRbRD",
  "E_JSKRNQQRSTVUYTZS RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "E_JMZSJY RNFOGNHMGNFNH RVFWGVHUGVFVH",
  "E_JSZS RSZS[R]Q^",
  "E_R[LKXKR[ RJSKRNQQRSTVUYTZS",
  "H\\QFSFUGVHWJXNXSWWVYUZS[Q[OZNYMWLSLNMJNHOGQF RJPKONNQOSQVRYQZP",
  "E_JSKRNQQRSTVUYTZS RRbRD",
  "MWSZS[R]Q^ RRNSORPQORNRP RJ]Z]",
  "D`IF[F[aIaIF RJPZP RTMPY RZVJV",
  "D`IF[F[aIaIF RQYRZQ[PZQYQ[ RMGOFTFVGWIWKVMUNSORPQRQS",
  "E_IKR[[K RJSKRNQQRSTVUYTZS",
  "E_[[RKI[ RJSKRNQQRSTVUYTZS",
  36,
  "H\\MbMQNOONQMTMVNWOXQXWWYVZT[Q[OZMX",
  43,
  "H]YMVWUYTZR[P[NZMYLVLRMONNPMRMTNUOVQWXXZZ[ RJ]Z]",
  "HZLTST RVZT[P[NZMYLWLQMONNPMTMVN RJ]Z]",
  "MXRMRXSZU[ RJ]Z]",
  "G]RTRX RMMLNKPKXLZN[O[QZRXSZU[V[XZYXYPXNWM RJ]Z]",
  34,
  "IbMTQSS[bB RXL`L",
  "A_J_F_F[ RJKJ[Z[ RF_OVEQOG",
  "E_JWNWN[V[VWZW",
  "E_NSN[J[ RVSV[Z[ RJSJQLMPKTKXMZQZSJS",
  "E_PQPU RQUQQ RRPRV RSUSQ RTQTU RPTRVTT RPRRPTR RPQRPTQUSTURVPUOSPQ RRbRD",
  "E_VWR[NW ROEQDSDUEVGVN RVMTNQNOMNKOIQHVH",
  "BbF[^[ RGLIKKKMLNNNU RUSVTUUTTUSUU R]S^T]U\\T]S]U RNTLUIUGTFRGPIONO",
  "BbF[N[ RV[^[ RGLIKKKMLNNNU RWLYK[K]L^N^U RNTLUIUGTFRGPIONO R^T\\UYUWTVRWPYO^O",
  "BbHPDP RJUFX RJKFH R^XZU R^HZK R`P\\P RTTRUPUNTMRMQNNPLRKVKTU",
  "=_RKR[B[BKRK RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_JKZKZ[J[JK RRbRD",
  "C_ESUS RQWUSQO RJWJ[Z[ZKJKJO",
  "@dX[^[ RZO^KZG RF[L[XK^K",
  "E_KOYW RR[RK RYOKW RRMONMPLSMVOXRYUXWVXSWPUNRM",
  "E_JSOSR[USZS RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_R[KOYOR[ RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_STJK RJOJKNK RSKTKXMZQZUXYT[P[LYJUJT",
  "D`KNKROR RYRWPTOPOMPKR RNXMVKUIVHXIZK[MZNX RVXWZY[[Z\\X[VYUWVVX",
  "E_I[N[NKVKV[[[",
  "E_I[V[VK RN[NK[K",
  "E_JKZK RJSRKZSR[JS",
  "E_Z[J[ RZSR[JSRKZS",
  "E_JKZK RJSRKZSR[JS RJSZS",
  "E_Z[J[ RZSR[JSRKZS RJSZS",
  "E_JVLV RJPZP RQVSV RXVZV",
  "BbL[FQLGXG^QX[L[",
  "D`IF[F[aIaIF",
  "MWTFQL",
  "AcZSJS RRORK RR[RW RNOJSNW R^[F[FK^K^[",
  "AcJSZS RRWR[ RRKRO RVWZSVO RFK^K^[F[FK",
  "BbLHQHQC RLSLHQCXCXSLS RLKJKHLGNGXHZJ[Z[\\Z]X]N\\LZKXK",
  "BbROJW RZORW RGXGNHLJKZK\\L]N]X\\ZZ[J[HZGX",
  "H\\XDVGUITLSQR[Rb",
  22,
  "H\\XbV_U]TZSURKRD",
  "H\\LDNGOIPLQQR[Rb",
  22,
  "H\\LbN_O]PZQURKRD",
  "H\\XGRGRb",
  22,
  "H\\X_R_RD",
  "H\\LGRGRb",
  22,
  "H\\L_R_RD",
  "H\\XDTHSJRNRb",
  "H\\RDRIQMPOLSPWQYR]Rb",
  "H\\XbT^S\\RXRD",
  22,
  "H\\LDPHQJRNRb",
  "H\\RDRISMTOXSTWSYR]Rb",
  "H\\LbP^Q\\RXRD",
  22,
  "H\\HS\\S",
  "H\\WDSHRKR[Q^Mb",
  "H\\MDQHRKR[S^Wb",
  "E_VbIF\\F",
  "E_VDI`\\`",
  ">fC^CYaYa^",
  ">fCHCMaMaH",
  ">fC^CYaYa^ RaHaMCMCH",
  "IbMTQSS[bB",
  22,
  22,
  "H\\HG\\G",
  "H\\HM\\M",
  "H\\\\YHY",
  "H\\\\_H_",
  "E_UFOFO[",
  "E_U[O[OF",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRbRD",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RZEJE RRERa",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RJaZa RRaRE",
  "E_RK[[I[RK RRbRD",
  "E_RK[[I[RK RZEJE RRERa",
  "E_RK[[I[RK RJaZa RRaRE",
  "E_JSKRNQQRSTVUYTZS RRbRD",
  "E_JSKRNQQRSTVUYTZS RZEJE RRERa",
  "E_JSKRNQQRSTVUYTZS RJaZa RRaRE",
  "E_JaZa RRaRE",
  "E_ZEJE RRERa",
  "E_OFUFU[",
  "E_O[U[UF",
  "D`TFQL RMKJKJ[Z[ZKWK",
  "E_IWN\\NZZZZKTKTTNTNRIW",
  "E_Z[J[ RJVRKZV",
  22,
  "H\\NQNROTQUSUUTVRVQ",
  "H\\NQNROTQUSUUTVRVQ RMKWK",
  "H\\NQNROTQUSUUTVRVQ RW[M[",
  "CaGQGRHTJULUNTOROQ RUQURVTXUZU\\T]R]Q RGK]K",
  "CaGQGRHTJULUNTOROQ RUQURVTXUZU\\T]R]Q R][G[",
  "E_JQJRKTMUOUQTRRRQ RRRSTUUWUYTZRZQ",
  "E_JUZUZP",
  "E_JPJUZUZP",
  "E_RPRU RJPJUZUZP",
  "E_HO\\O RLUXU RRFRO RT[P[",
  "E_HS\\S RJMZMZYJYJM",
  ">fB]C\\FZHYKXPWTWYX\\Y^Za\\b]",
  ">fbIaJ^L\\MYNTOPOKNHMFLCJBI",
  ">fB^B]C[EZOZQYRWSYUZ_Za[b]b^",
  ">fbHbIaK_LULSMROQMOLELCKBIBH",
  ">fB^FY^Yb^",
  ">fbH^MFMBH",
  "E_I[NKVK[[I[",
  "AcRE^L^ZRaFZFLRE RQLSLVMXOYRYTXWVYSZQZNYLWKTKRLONMQL",
  0,
  "E_HXMN\\NWXHX",
  "E_JSZS RJSKNLLNKPLQNSXTZV[XZYXZS",
  "E_LMXY RXMLY RPQRPTQUSTURVPUOSPQ",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "E_KKK[ RL[LK RMKM[ RN[NK ROKO[ RP[PK RQKQ[ RR[RK RSKS[ RT[TK RUKU[ RV[VK RWKW[ RX[XK RYKY[ RJKZKZ[J[JK",
  "E_JKZKZ[J[JK",
  "E_KLMKWKYLZNZXYZW[M[KZJXJNKL",
  "E_JKZKZ[J[JK RPPPV RQVQP RRPRV RSVSP RTPTV ROVOPUPUVOV",
  "E_JWZW RJSZS RJOZO RJKZKZ[J[JK",
  "E_NKN[ RRKR[ RVKV[ RJKZKZ[J[JK",
  "E_JWZW RJSZS RJOZO RNKN[ RRKR[ RVKV[ RJKZKZ[J[JK",
  "E_JKZ[ RN[JW RT[JQ RZUPK RZOVK RJKZKZ[J[JK",
  "E_J[ZK RJUTK RJONK RP[ZQ RV[ZW RJKZKZ[J[JK",
  "E_J[ZK RJUTK RJONK RJKZ[ RN[JW RP[ZQ RT[JQ RV[ZW RZUPK RZOVK RJKZKZ[J[JK",
  "E_PPPV RQVQP RRPRV RSVSP RTPTV ROVOPUPUVOV",
  "E_OVOPUPUVOV",
  "E_JXTN RJWSN RJVRN RJUQN RJTPN RJSON RJRNN RJQMN RJPLN RJOKN RKXUN RLXVN RMXWN RNXXN ROXYN RPXZN RQXZO RRXZP RSXZQ RTXZR RUXZS RVXZT RWXZU RXXZV RYXZW RJNZNZXJXJN",
  "E_JNZNZXJXJN",
  "E_M[WQ RMZWP RMYWO RMXWN RMWWM RMVWL RMUWK RMTVK RMSUK RMRTK RMQSK RMPRK RMOQK RMNPK RMMOK RMLNK RN[WR RO[WS RP[WT RQ[WU RR[WV RS[WW RT[WX RU[WY RV[WZ RM[MKWKW[M[",
  "E_M[MKWKW[M[",
  "E_NNLP RONKR RPNJT RQNIV RRNHX RSNIX RTNJX RUNKX RVNLX RWNMX RXVVX RXNNX RYTUX RYNOX RZRTX RZNPX R[PSX R[NQX R\\NRX RHXMN\\NWXHX",
  "E_HXMN\\NWXHX",
  "E_JZJ[ RKXK[ RLVL[ RMTM[ RNSN[ ROQO[ RPOP[ RQMQ[ RRKR[ RSMS[ RTOT[ RUQU[ RVSV[ RWTW[ RXVX[ RYXY[ RZ[RLJ[ RZZZ[ RRK[[I[RK",
  "E_RK[[I[RK",
  "E_OUOV RPSPV RQQQV RRORV RSQSV RTSTV RUUUV ROVRPUV RROVVNVRO",
  "E_ROVVNVRO",
  "E_KKK[ RLLLZ RMLMZ RNMNY ROMOY RPNPX RQNQX RRORW RSPSV RTPTV RUQUU RVQVU RWSXS RWRWT RJKYSJ[ RZSJ\\JJZS",
  "E_ZSJ\\JJZS",
  "E_PPPV RQQQU RRQRU RSSUS RSRST ROPUSOV RVSOWOOVS",
  "E_VSOWOOVS",
  "E_KNKX RLNLX RMOMW RNONW ROOOW RPPPV RQPQV RRPRV RSQSU RTQTU RURUT RVRVT RWRWT RXSWS RJNYSJX RZSJYJMZS",
  "E_ZSJYJMZS",
  "E_ZLZK RYNYK RXPXK RWRWK RVSVK RUUUK RTWTK RSYSK RR[RK RQYQK RPWPK ROUOK RNSNK RMRMK RLPLK RKNKK RJKRZZK RJLJK RR[IK[KR[",
  "E_R[IK[KR[",
  "E_UQUP RTSTP RSUSP RRWRP RQUQP RPSPP ROQOP RUPRVOP RRWNPVPRW",
  "E_RWNPVPRW",
  "E_Y[YK RXZXL RWZWL RVYVM RUYUM RTXTN RSXSN RRWRO RQVQP RPVPP ROUOQ RNUNQ RMSLS RMTMR RZ[KSZK RJSZJZ\\JS",
  "E_JSZJZ\\JS",
  "E_TVTP RSUSQ RRURQ RQSOS RQTQR RUVOSUP RNSUOUWNS",
  "E_NSUOUWNS",
  "E_YXYN RXXXN RWWWO RVWVO RUWUO RTVTP RSVSP RRVRP RQUQQ RPUPQ ROTOR RNTNR RMTMR RLSMS RZXKSZN RJSZMZYJS",
  "E_JSZMZYJS",
  "E_JRJT RKUKQ RLPLV RMWMO RNNNX ROYOM RPLPZ RQ[QK RRJR\\ RS[SK RTLTZ RUYUM RVNVX RWWWO RXPXV RYUYQ RZRZT RRJ[SR\\ISRJ",
  "E_RJ[SR\\ISRJ",
  "E_RJ[SR\\ISRJ RPRPT RQUQQ RRPRV RSUSQ RTRTT RRPUSRVOSRP",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RPQPU RQUQQ RRPRV RSUSQ RTQTU RPTRVTT RPRRPTR RPQRPTQUSTURVPUOSPQ",
  "E_RaJSRFZSRa",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_JQKO RKWJU RNLPK RP[NZ RTKVL RVZT[ RYOZQ RZUYW",
  "E_NLNZ RRKR[ RVLVZ RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  47,
  "E_KOKW RLXP[ RLNPK RLMLY RMYMM RNLNZ ROZOL RPKP[ RQ[QK RRKR[ RS[SK RT[XX RTKT[ RTKXN RUZUL RVLVZ RWYWM RXMXY RYWYO RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RKOKW RLYLM RMMMY RNZNL ROLOZ RP[LX RP[PK RLN RQKQ[ RR[P[LYJUJQLMPKRKR[",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RYWYO RXMXY RWYWM RVLVZ RUZUL RTKXN RTKT[ RXX RS[SK RRKTKXMZQZUXYT[R[RK",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RKOKS RLMLS RMSMM RNLNS ROSOL RPKLN RPKPS RQKQS RRKRS RSKSS RTSTK RXN RULUS RVSVL RWMWS RXMXS RYOYS RJSJQLMPKTKXMZQZSJS",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RYWYS RXYXS RWSWY RVZVS RUSUZ RT[XX RT[TS RS[SS RR[RS RQ[QS RPSP[ RLX ROZOS RNSNZ RMYMS RLYLS RKWKS RZSZUXYT[P[LYJUJSZS",
  "E_SSSK RTKTS RTKXN RUSUL RVLVS RWSWM RXMXS RYSYO RZSRSRK RPKTKXMZQZUXYT[P[LYJUJQLMPK",
  "E_QSQ[ RP[PS RP[LX ROSOZ RNZNS RMSMY RLYLS RKSKW RJSRSR[ RT[P[LYJUJQLMPKTKXMZQZUXYT[ RYWYO RXMXY RWYWM RVLVZ RUZUL RTKXN RTKT[ RXX RS[SK RRKTKXMZQZUXYT[R[RK",
  "E_KOKW RLYLM RMMMY RNZNL ROLOZ RP[LX RP[PK RLN RQKQ[ RR[P[LYJUJQLMPKRKR[",
  "E_YWYO RXMXY RWYWM RVLVZ RUZUL RTKXN RTKT[ RXX RS[SK RRKTKXMZQZUXYT[R[RK",
  "E_FDFb RGbGD RHDHb RIbID RJDJb RKbKD RLbLW RLDLO RMXMb RMNMD RNbNY RNDNM ROZOb ROLOD RPbPZ RPDPL RQZQb RQLQD RRbRZ RRDRL RSZSb RSLSD RTbTZ RTDTL RUZUb RULUD RVbVY RVDVM RWXWb RWNWD RXbXW RXDXO RYbYD RZDZb R[b[D R\\D\\b R]b]D R^D^b R_bEbED_D_b RKTKRLONMQLSLVMXOYRYTXWVYSZQZNYLWKT",
  "E_FRFD RGNIJ RGDGN RHLHD RIDIK RJJJD RJJMG RKDKI RLHLD RMHQF RMDMH RNGND ROPOS RODOG RPSPP RPGPD RQPQS RQDQG RRSRO RRGRD RSPSS RSFWH RSDSG RTSTP RTGTD RUPUS RUDUG RVGVD RWGZJ RWDWH RXHXD RYDYI RZJZD R[J]N R[D[K R\\L\\D R]D]N R^R^D ROQROUQ RNSOPROUPVSNS RFSFRGNIKJJMHQGSGWHZJ[K]N^R^S_S_DEDESFS R^T^b R]X[\\ R]b]X R\\Z\\b R[b[[ RZ\\Zb RZ\\W_ RYbY] RX^Xb RW^S` RWbW^ RV_Vb RUVUS RUbU_ RTSTV RT_Tb RSVSS RSbS_ RRSRW RR_Rb RQVQS RQ`M^ RQbQ_ RPSPV RP_Pb ROVOS RObO_ RN_Nb RM_J\\ RMbM^ RL^Lb RKbK] RJ\\Jb RI\\GX RIbI[ RHZHb RGbGX RFTFb RUURWOU RVSUVRWOVNSVS R^S^T]X[[Z\\W^S_Q_M^J\\I[GXFTFSESEb_b_S^S",
  "E_FRFD RGNIJ RGDGN RHLHD RIDIK RJJJD RJJMG RKDKI RLHLD RMHQF RMDMH RNGND ROPOS RODOG RPSPP RPGPD RQPQS RQDQG RRSRO RRGRD RSPSS RSFWH RSDSG RTSTP RTGTD RUPUS RUDUG RVGVD RWGZJ RWDWH RXHXD RYDYI RZJZD R[J]N R[D[K R\\L\\D R]D]N R^R^D ROQROUQ RNSOPROUPVSNS RFSFRGNIKJJMHQGSGWHZJ[K]N^R^S_S_DEDESFS",
  "E_^T^b R]X[\\ R]b]X R\\Z\\b R[b[[ RZ\\Zb RZ\\W_ RYbY] RX^Xb RW^S` RWbW^ RV_Vb RUVUS RUbU_ RTSTV RT_Tb RSVSS RSbS_ RRSRW RR_Rb RQVQS RQ`M^ RQbQ_ RPSPV RP_Pb ROVOS RObO_ RN_Nb RM_J\\ RMbM^ RL^Lb RKbK] RJ\\Jb RI\\GX RIbI[ RHZHb RGbGX RFTFb RUURWOU RVSUVRWOVNSVS R^S^T]X[[Z\\W^S_Q_M^J\\I[GXFTFSESEb_b_S^S",
  "E_JSJQLMPKRK",
  "E_ZSZQXMTKRK",
  "E_ZSZUXYT[R[",
  "E_JSJULYP[R[",
  "E_JSJQLMPKTKXMZQZS",
  "E_ZSZUXYT[P[LYJUJS",
  "E_KZK[ RLYL[ RMXM[ RNWN[ ROVO[ RPUP[ RQTQ[ RRSR[ RSRS[ RTQT[ RUPU[ RVOV[ RWNW[ RXMX[ RYLY[ RZ[ZKJ[Z[",
  "E_YZY[ RXYX[ RWXW[ RVWV[ RUVU[ RTUT[ RSTS[ RRSR[ RQRQ[ RPQP[ ROPO[ RNON[ RMNM[ RLML[ RKLK[ RJ[JKZ[J[",
  "E_YLYK RXMXK RWNWK RVOVK RUPUK RTQTK RSRSK RRSRK RQTQK RPUPK ROVOK RNWNK RMXMK RLYLK RKZKK RJKJ[ZKJK",
  "E_KLKK RLMLK RMNMK RNONK ROPOK RPQPK RQRQK RRSRK RSTSK RTUTK RUVUK RVWVK RWXWK RXYXK RYZYK RZKZ[JKZK",
  "E_PQRPTQUSTURVPUOSPQ",
  "E_JKZKZ[J[JK RK[KK RLKL[ RM[MK RNKN[ RO[OK RPKP[ RQ[QK RJ[JKRKR[J[",
  "E_JKZKZ[J[JK RYKY[ RX[XK RWKW[ RV[VK RUKU[ RT[TK RSKS[ RZKZ[R[RKZK",
  "E_JKZKZ[J[JK RYLYK RXMXK RWNWK RVOVK RUPUK RTQTK RSRSK RRSRK RQTQK RPUPK ROVOK RNWNK RMXMK RLYLK RKZKK RJKJ[ZKJK",
  "E_JKZKZ[J[JK RKZK[ RLYL[ RMXM[ RNWN[ ROVO[ RPUP[ RQTQ[ RRSR[ RSRS[ RTQT[ RUPU[ RVOV[ RWNW[ RXMX[ RYLY[ RZ[ZKJ[Z[",
  "E_JKZKZ[J[JK RR[RK",
  "E_RK[[I[RK RRUQVRWSVRURW",
  "E_J[RL RJZJ[ RKXK[ RLVL[ RMTM[ RNSN[ ROQO[ RPOP[ RQMQ[ RRKR[ RRK[[I[RK",
  "E_Z[RL RZZZ[ RYXY[ RXVX[ RWTW[ RVSV[ RUQU[ RTOT[ RSMS[ RRKR[ RRKI[[[RK",
  "C`OFTFXHZJ\\N\\SZWXYT[O[KYIWGSGNIJKHOF",
  "E_JKZKZ[J[JK RRKRSJS",
  "E_JKZKZ[J[JK RR[RSJS",
  "E_JKZKZ[J[JK RR[RSZS",
  "E_JKZKZ[J[JK RRKRSZS",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRKRSJS",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RR[RSJS",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RR[RSZS",
  "E_PKTKXMZQZUXYT[P[LYJUJQLMPK RRKRSZS",
  "E_JKJ[ZKJK",
  "E_ZKZ[JKZK",
  "E_J[JKZ[J[",
  "E_JKZKZ[J[JK",
  "E_KKK[ RL[LK RMKM[ RN[NK ROKO[ RP[PK RQKQ[ RR[RK RSKS[ RT[TK RUKU[ RV[VK RWKW[ RX[XK RYKY[ RJKZKZ[J[JK",
  "E_OVOPUPUVOV",
  "E_PPPV RQVQP RRPRV RSVSP RTPTV ROVOPUPUVOV",
  "E_Z[ZKJ[Z[",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  48,
  "PfUUYZ",
  "PfWTYT[V[XYZWZUXUVWT",
  "PfZKXS R^K\\S",
  "PfYFUISMSQUUZXZUXTXRZQ[R[L]N^L^FaIcMcQaU\\X",
  "PfZJYMVQ RYM`M\\T RZR]V",
  "PfbHTWWK^R",
  "PfWG_GcMcS_XWXSSSMWG",
  "PfaD[OaZ",
  "PfUD[OUZ",
  "PfaD[OaZ R^DXO^Z",
  "PfUD[OUZ RXD^OXZ",
  "PfbD^D^R",
  "PfT[X[XO",
  "PfbDbH^H^PZPZDbD",
  "PfT[TWYWYO]O][T[",
  "Pf^DbDaIaOaUbZ^Z^D",
  "PfTDXDX[T[UVUITD",
  "PfUIaI RUNaN R[N[Y",
  "PfUJaJaNUNUJ RURaRaVUVUR",
  "PfbD_H_VbZ",
  "PfTDWHWVTZ",
  "Pf\\DbDaIaOaUbZ\\Z\\D",
  "PfTDZDZ[T[UVUITD",
  "PfbD]F]XbZ R`E`Y",
  "PfTDYFYXTZ RVEVY",
  "PfbD]D][b[ R`D`[",
  "PfTDYDY[T[ RVDV[",
  "PfTOXL^RbO",
  "Pf^EbK RYE]K",
  "PfWDTJ R[DXJ",
  "PfXTTY R]TYY",
  "PfWI_I RWL_L R[L[S RWSXU^U_S RVNXNYPXRVRUPVN R^N`NaP`R^R]P^N RTNRNRSTSVX`XbSdSdNbN",
  "Pf[F[Y",
  "PfXJXU R]F]X",
  "PfVHVX R[J[V R`G`X",
  "PfaK^SUZ RWOaV",
  "PfZHVN]O_R_U]XYXWTWR_M",
  "Pf[M[P RTPbP",
  "Pf[J[M RTMbM RTQbQ",
  "Pf[I[L RTLbL RTPbP RTTbT",
  "PfXLWOTR RWObO R`O_VV[ RVQ[S_Y",
  "PfT\\W\\Y^YaWcTcRaR^T\\",
  "PfTAWAYCYFWHTHRFRCTA",
  "Pf_AbAdCdFbH_H]F]C_A",
  "Pf_\\b\\d^dabc_c]a]^_\\",
  "PfgOjOlQlTjVgVeTeQgO",
  "PfgKjKlMlPjRgRePeMgK RgTjTlVlYj[g[eYeVgT",
  "PfSQVMYQ\\M_QbM",
  "Pf]DWP]Z",
  "Pf]I`L R`HcK R]DWP]Z",
  "Pf_GWY",
  "Pf_MaP RbMdP R_GWY",
  "PfVH_X",
  "PfWG_GcMcS_XWXSSSMWG RWK_K RWO_O R[O[U",
  "PfUFZY R[FUY R\\FaY RaF\\Y",
  "PfULaL R[E[Y",
  "PfTLbL RXEXY R^E^Y",
  "PfTNbN RWGWVUY R[I[V R_H_Y",
  "PfXI^N\\O RXP^U",
  "PfUJaJaWUWUJ RaJUW",
  "PfTLWHZM]JbW",
  "PfTIVI RXIZI R\\I^I R`IbI RbK RbMbO RbQbS RbUbW R`W R^W\\W RZWXW RVWTWTU RTSTQ RTOTM RTKTI RWM[K]N`L RWQ_Q RWT_T R\\PYV",
  "PfUHaHaYUYUH R_JWW RWJ_W",
  48,
  "PfVO]O RYLYTZY R\\QXYWYVXVUZR^R`U`W]Z",
  "PfTI^H RYEXPZY R]LZUVZTUXP^NaRaX][",
  "PfVPVWX[ZX R]Q`W",
  "Pf^J`NaS RTHTOUTWZZT",
  "PfZJ]L RWO]N_Q^VZ[",
  "PfXD]F RUM\\J_M_S]XXZ",
  "PfZN]P RXR^RX[ R[W]W][`[",
  "PfYE]H RWL^KV[ RYU]R]Z`Z",
  "PfUQ[Q RXNX[UYUWZT^T`W`Y[[ R]O`R",
  "PfTJ[I RWEWYTWTSZP^QaS`X[Y R^HaL",
  "PfSLZK\\OZZWY RXDTZ R]IaQ",
  "PfSLZK\\OZZWX RXDTY R]H`Q R`JbM RcIeL",
  "PfVI^G RUNaK RYD]SZS RVTVWXY\\Z",
  "PfVI^G RUNaK RYD]SZS RVTVWXY\\Z R_DaG RbCdF",
  "Pf]EXO]Z",
  "Pf]EXO]Z R_IaL RbHdK",
  "PfZLaL RVDUKURUVVYXS R^E_M_S^W\\Z",
  "PfZLaL RVDUKURUVVYXS R^E_M_S^W\\Z RaEcH RdDfG",
  "PfWG^G[J RWPUUWZ`Z",
  "PfWG^G[J RWPUUWZ`Z R`DbG RcCeF",
  "PfTK`I RYE_R[Q RVRVVXY]Z",
  "PfTK`I RYE_R[Q RVRVVXY]Z R_DaG RbCdF",
  "PfWEWVXYZ[][`YaU",
  "PfWEWVXYZ[][`YaU R\\L^O R_KaN",
  "PfSJaJ R]E]S\\WX[ R\\OZMYMWPWRYSZS\\Q",
  "PfSJaJ R]E]S\\WX[ R\\OZMYMWPWRYSZS\\Q R`DbG RcCeF",
  "PfTMbL R^E^S\\R RWGWZ`Z",
  "PfTMbL R^E^S\\R RWGWZ`Z R`EbH RcDeG",
  "PfWF_EXM RTNaL R_M[PYRYU[X^Z",
  "PfWF_EXM RTNaL R_M[PYRYU[X^Z RaDcG RdCfF",
  "PfTI[I RYDTY RZN`N RYSZW\\YaY",
  "PfTI[I RYDTY RZN`N RYT[YaY R_GaJ RbFdI",
  "PfTI^I RXDUSYO]O_R_V\\YX[",
  "PfTI^I RXDUSYO]O_R_V\\YX[ R^E`H RaDcG",
  "PfTO]M`NaR_UYX",
  "PfSL]I`JaMaP`S]VWX",
  "PfSL]I`JaMaP`S]VWX R`EbH RcDeG",
  "PfTIaG R_H[KYPYV[Y^Z",
  "PfTIaG R_H[KYPYV[Y^Z R`CbF RcBeE",
  "Pf_KWQUSUWWZ_Z RWDXIZN",
  "Pf_KWQUSUWWZ_Z RWDXIZN R_GaJ RbFdI",
  "PfTIZI RXDTU R_HbL R]L]X[YXXXT[SaX",
  "PfZHaH RUDTLTRUYWR RZSZW[XaX",
  "PfUGXW R[EXTUXSUTQWK]JaNaV^Z\\ZZW\\TbY",
  "PfWEWZ RTJWJWK RSVZK^IaJbNaU^Y\\YZXZU]TbX",
  "Pf[GWWTTTLVH[F_GbLbRaV\\Y",
  "PfYIaI R^E^YYXYT\\SaW RUETKTQUYVR",
  "PfYIaI R^E^YYXYT\\SaW RUETKTQUYVR R`EbH RcDeG",
  "PfYIaI R^E^YYXYT\\SaW RUETKTQUYVR RbDcDdEdFcGbGaFaEbD",
  "PfSKYGUNUTVXXZ[Y\\W]S^M]GbO",
  "PfSKYGUNUTVXXZ[Y\\W]S^M]GbO R`EbH RcDeG",
  "PfSKYGUNUTVXXZ[Y\\W]S^M]GbO RbEcEdFdGcHbHaGaFbE",
  "PfYE]H RZK[Q]U\\YYYWW RVPTX R_QaW",
  "PfYE]H RZK[Q]U\\YYYWW RVPTX R_QaW R_DaG RbCdF",
  "PfYE]H RZK[Q]U\\YYYWW RVPTX R_QaW R`DaDbEbFaG`G_F_E`D",
  "PfTRYKbS",
  "Pf^J`M RaIcL RTRYKbS",
  "Pf_I`IaJaK`L_L^K^J_I RTRYKbS",
  "PfYF`F RYL`L R^F^ZZYZW\\UbX RUETKTQUZWS",
  "PfYF`F RYL`L R^F^[ZYZW\\UbX RUETKTQUZWS RaCcF RdBfE",
  "PfYF`F RYL`L R^F^[ZYZW\\UbX RUETKTQUZWS RcCdCeDeEdFcFbEbDcC",
  "PfTH`H RVM^M R[D[YXYUWVUZT`W",
  "PfVG\\GZNVXTUTRWP[PbT R_K_Q^U[Y",
  "PfSHYH RWEVVXZ^Z_V_Q RVRUTTTSRSPTNUNVP R]IaN",
  "PfUHYX R[FYVVZSVSRWM[K_MbRaW]Z",
  "PfYDXVYZ[[^[`ZaV`P RTI\\I RUO\\O",
  "PfUR]N`O`Q_S\\T RVL[[ RYK[M",
  "PfSO_KaLbP_S\\S RUG[[ RYE\\H",
  "PfTLTVWP\\MaQaV]YYV R]J]R[[",
  "PfULUXXP[M_MbPbU_W\\WZU R]J]Y[[",
  "Pf[N[ZVYVVYU`X R[Q_Q",
  "Pf[E[[WZUXUVWTaY R[K`J",
  "PfYE]H RXIVUYQ]P`S_XY[",
  "Pf^E^R]VYZ RWEVJVNWQYN",
  "PfWF_EVS[O`OaRaW][Y[XWZU^Y",
  "PfWEWZ RTJXIWJ RSV\\I_I`L_S_YbU",
  "PfXG^FWT[O`OaRaW^YZZ",
  "PfWIWZ RULXLWN RUU[M^MaNaT_W[Y",
  "PfWEWZ RTKXJWL RSVYN[K_KaMbQ`U[Y",
  "PfWG]FWZUUVQZM^NaQaX][ZY[V_X",
  "PfXE^EVN R\\K`M`QZTWRXP[QTY RVWXW[Z R]W_WaY",
  "PfUH^H RZDUSYM[O\\U R`NWUWXZ[_[",
  "Pf[EU[ZQ\\Q^[_[bV",
  "PfXD]F RUM\\J_M_S]XXZ R`FbI RcEeH",
  "PfUO\\N]P\\YYW RYJUY R^LaQ",
  "PfYP`O RUKTQTUVZWW R]L]V\\X[[",
  48,
  48,
  "Pf^E`H RaDcG",
  "PfaDbDcEcFbGaG`F`EaD",
  "PfSEUH RVDXG",
  "PfTDUDVEVFUGTGSFSETD",
  "PfYI`P\\R",
  "PfYI`P\\R R^G`J RaFcI",
  "PfZJ`J R[EUW RXP^P`S_X\\[YZ",
  "PfTLbL RTTbT",
  "PfVK`K_N]Q R[N[RZUXX",
  "PfTGbGaI_L\\N RZJZQZSYVW[",
  "Pf[P[Z R^J\\NYQVS",
  "Pf[L[[ R`E^H[LWOTQ",
  "PfZHZL RVOVL_L_O^S]U[WXY",
  "Pf[D[H RUOUHaH`N_Q]U[XWZ",
  "PfWL_L R[L[W RVW`W",
  "PfUIaI RTWbW R[I[W",
  "PfWO`O R]K]Z[Y R\\O[RYUVX",
  "PfUKbK R^D^Z[Y R]K[PXSTW",
  "PfUJaJ`Y]W RZCZJZOYSWVUY",
  "PfUJaJ`Y]W RZCZJZOYSWVUY R_EaH RaCcF",
  "PfVL^J RUSaP RYD]Z",
  "Pf]E_G R`DbF RVL^J RUSaP RYD]Z",
  "PfZDYIWLUP RZH`H`L_P]T[WWZ",
  "PfZDYIWLUO RZGaG`L_P]T[WWZ R`DbF RcCeE",
  "PfWKbK RXDWHUMTP R]K]P\\SZVWZ",
  "PfWKbK RXDWHUMTQ R]K]P\\SZVWZ R^G`I RaFcH",
  "PfUIaIaWUW",
  "Pf`FbH RcEeG RUIaIaWUW",
  "PfTKbK RWEWR R_D_K_O^S]U[XYZ",
  "PfTKbK RWEWR R_D_K_O^S]U[XYZ RaDbF RdCeE",
  "PfWFZI RULXO RUYZW]U_SbK",
  "PfWFZI RULXO RUYZW]U_SbK R_GaI RbFdH",
  "PfUF^F]L[PYSWVTY R[Q]T`Y",
  "PfUF^F]L[OYSWVTY R[Q]T`Y R`EbG RcDeF",
  "PfULbJ^R RYEYXaX",
  "Pf_EaG RbDdF RULbJ^R RYDYXaX",
  "PfUFWL R`F`L_P^S\\VWY",
  "PfaG`L_P^T\\WXZ RaDcF RdCfE RUGWM",
  "PfXL]R RYDXHWLUP RYH`H_L^P]T[WXZ",
  "PfXL]R RYDXHWLUP RYH`H_L^P]T[WXZ R`EbG RcDeF",
  "PfTNbN R_E]FZGVH R\\G\\M[QZUYWVZ",
  "PfTNbN R_E]FZGVH R\\G\\M[QZUYWWZ R`DbF RcCeE",
  "PfULWQ RZK[P R`L`Q_T\\WYY",
  "PfUGWN RYF[L R`G`M_Q]U[WXY",
  "PfUGWN RYF[L R`G`M_Q]U[WXY RaEcG RdDfF",
  "PfWG_G RTMbM R[M[RYVVZ",
  "Pf`EbG RcDeF RWG_G RTMbM R[M[RYVVZ",
  "Pf[D[Z R[MaR",
  "Pf_KaM RbJdL R[D[Z R[MaR",
  "PfTLbL R[D[K[QZTXWVZ",
  "PfUKaK RSWcW",
  "PfXM_W RWF`F_L^P\\UZWVZ",
  "PfYD]G R[P[[ R]QaU RVH`H^L\\OYRTU",
  "Pf_F^L]QZUVY",
  "Pf^JbV RYJXOVSTV",
  "Pf^JbV RYJXOVSTV R_HaJ RbGdI",
  "Pf^JbV RYJXOVSTV R`GaGbHbIaJ`J_I_H`G",
  "PfUFUYaY R`J\\MYNVO",
  "PfUFUYaY R`J\\MYNVO R`HbJ RcGeI",
  "PfUFUYaY R`J\\MYNVO RaFbFcGcHbIaI`H`GaF",
  "PfUH`H`M_R]UZWVY",
  "PfUH`H`M_R]UZWVY RaFcH RdEfG",
  "PfUH`H`M_R]UZWVY RbEcEdFdGcHbHaGaFbE",
  "PfTRYJbV",
  "Pf]K_M R`JbL RTRYJbV",
  "Pf_K`KaLaM`N_N^M^L_K RTRYJbV",
  "PfUKaK R[E[ZXY R^OaW RWOVRUTTW",
  "PfUKaK R[E[ZXY R^OaW RWOVRUTTW R`GbI RcFeH",
  "PfUKaK R[E[ZXY R^OaW RWOVRUTTW RaFbFcGcHbIaI`H`GaF",
  "PfTJaJ_N]Q[S RWPZS[U]X",
  "PfWFaJ RWM_P RUT`Y",
  "Pf[FUY_W R]PaZ",
  "Pf`E_J]OZSXUTX RXKZM]Q`U",
  "PfVG`G RSOcO RZGZY`Y",
  "PfUOaL^R RXI[Z",
  "PfXE[Z RTMaI`L_O^Q",
  "PfXL^L^V RVVaV",
  "PfVI`I_W RSWcW",
  "PfWL_L_XWX RWR_R",
  "PfUHaHaXUX RUPaP",
  "PfVG`G RTLaLaQ_T\\WXZ",
  "PfXEXP R_E_M_Q]U\\WYZ",
  "PfWGWOVSUVTY R[E[Y]W_TaP",
  "PfWEWX[W^U`SbO",
  "PfUHUV RUHaHaVUV",
  "PfVPVJ`J_P]UYZ",
  "PfUGUN RaG`M_Q^U\\XYZ RUGaG",
  "PfWJbJ RWJWS RSScS R]D]Z",
  "PfVIaI]P R[L[W RSWcW",
  "PfVM`M RUF`F`L`O_S]VZXVZ",
  "PfUHYL RUXZW]T_QaJ",
  "Pf[D[H RUOUHaH`N_Q]U[XWZ RaEcG RdDfF",
  "PfWM_M^Y\\X R[IZNYSWX",
  "PfYMaM RYIXMWPUS R_M^Q]T\\WZZ",
  "PfaEcG RdDfF RUGUN RaG`N`Q^U\\WYZ RUGaG",
  "Pf`GbI RcFeH RWJbJ RWJWS RSScS R]D]Z",
  "Pf`FbH RcEeG RVIaI]P R[L[W RSWcW",
  "PfVM`M RUF`F`L`O_S]VZXVZ RaEcG RdDfF",
  "PfZP\\P]Q]S\\TZTYSYQZP",
  "PfSPcP",
  "PfWK^U",
  "Pf\\M^O R_KaM RWK^U",
  "PfVF`F`Y",
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  23,
  "PoROlO",
  "PoRFlF RX[`[ R`F`[",
  "PoRFlF R^[e[ RZFVQ RWNiNfZ",
  "Po\\D\\[j[jW RSOkK",
  "PoR[l[ R_D_[",
  "PoRFlF R_F_[",
  "PoRGlG R[UU[ R^LYW R_G\\T",
  "PoRFlF R\\F[PXVT[ R\\NiMiTg[`[",
  "PoRIlI RWLZS^WcYj[ RbDbLaT\\XYZS[",
  "PoTFjF RVPhP RR[l[",
  "Po^MjM RR[l[ R^D^[",
  "PoRElE R^E^[ R^KjQ",
  "PoSGlG RfFf[ RXVR[ RYFYPXV",
  "PoRElE R`H`[ RaGXPRS RaLiOlS",
  "PoYHiH RRTlT R\\[d[ RYCWNgNeZ",
  "PoRElE RURjR Rb[h[ RUJUU R_E_R R_KkKjRi[",
  "PoRElE R_KjK Rb[i[ R_E_P RUQlQi[ RVITR",
  "PoROlO RR[l[ R[FZNX[ RUFgFf[",
  "PoaXhX RR[l[ R`PcT RXUSW R^NVV RVK`P RaH^O RTFkFkNiX",
  "PoTGjG RRLlL ReS`X RYQhQbW R^C\\JXQ RYWeZ",
  "PoWLgL RWTgT RR[l[ RWEW[ RWEgEg[",
  "PoSFkF RR[l[ R`I`Y RcMfOkS RaF`IXQRS",
  "PoRJlJ R_RgR RWYkY RWDW[ R_C_T RgDgT",
  "PoRKlK RWYgY RWCW[ R_C_Y RgCg[",
  "PoWNkN RR[l[ RWGW[ RdNd[ RhEWG",
  "PoRElE Re[j[ RSKS[ RSKkKk[ R_F^PZUVV R^NgV",
  "PoR[l[ R[D[[ RcDc[ RTKXS RjKfS",
  "PoR[l[ RhTlX RaT\\X RYL\\O^T ReMiV RXOTW RcN_W RdHgS RYEWS RdDbR",
  "PoRGlG RUPjP R[[`[ R`K`[ ReSlY RYKUO RXTRZ R\\CYL",
  "Po`VkV RTV]V RR[l[ RkJgN RbJ`NhN`V R]J\\N RVKTO[OTV RZDVM RfDbL",
  "PoYX_X RS[k[ R_J_X RVEgEdG_J RRL[LXQSV RjJgMbN R`JbOgTlV",
  "PoSEkE RUJiJ RRPlP RZZjZ RXZhZ RRZeZ R_E_P ReTl[ R[PWZ"
];

// kicad/text/stroke-font.ts
var StrokeFont = class _StrokeFont extends Font3 {
  static {
    __name(this, "StrokeFont");
  }
  static {
    this.overbar_position_factor = 1.4;
  }
  static {
    this.underline_position_factor = -0.16;
  }
  static {
    this.font_scale = 1 / 21;
  }
  static {
    this.font_offset = -10;
  }
  static default() {
    if (!this.instance) {
      this.instance = new _StrokeFont();
    }
    return this.instance;
  }
  /** Glyph data loaded from newstroke */
  #glyphs = /* @__PURE__ */ new Map();
  #shared_glyphs = [];
  constructor() {
    super("stroke");
    this.#load();
  }
  /**
   * Parses and prepares Newstroke for rendering.
   */
  #load() {
    for (const glyph_data2 of shared_glyphs) {
      this.#shared_glyphs.push(decode_glyph(glyph_data2));
    }
    for (let i = 0; i < 256; i++) {
      this.#load_glyph(i);
    }
  }
  #load_glyph(idx) {
    const data = glyph_data[idx];
    if (is_string(data)) {
      this.#glyphs.set(idx, decode_glyph(data));
    } else if (is_number(data)) {
      const glyph = this.#shared_glyphs[data];
      this.#glyphs.set(idx, glyph);
    } else {
      throw new Error(`Invalid glyph data for glyph ${idx}: ${data}`);
    }
    glyph_data[idx] = void 0;
  }
  /** Get a glyph for a specific character. */
  get_glyph(c) {
    const glyph_index = ord(c) - ord(" ");
    if (glyph_index < 0 || glyph_index > glyph_data.length) {
      return this.get_glyph("?");
    }
    if (!this.#glyphs.has(glyph_index)) {
      this.#load_glyph(glyph_index);
    }
    return this.#glyphs.get(glyph_index);
  }
  get_line_extents(text, size, thickness, bold, italic) {
    const extents = super.get_line_extents(
      text,
      size,
      thickness,
      bold,
      italic
    );
    const padding = thickness * 1.25 * 2;
    extents.x += padding;
    extents.y += padding;
    return extents;
  }
  compute_underline_vertical_position(glyph_height) {
    return glyph_height * _StrokeFont.underline_position_factor;
  }
  compute_overbar_vertical_position(glyph_height) {
    return glyph_height * _StrokeFont.overbar_position_factor;
  }
  get_interline(glyph_height, line_spacing = 1) {
    return glyph_height * line_spacing * _StrokeFont.interline_pitch_ratio;
  }
  get_text_as_glyphs(text, size, position, angle, mirror2, origin, style) {
    const space_width = 0.6;
    const inter_char = 0.2;
    const tab_width = 4 * 0.82;
    const super_sub_size_multiplier = 0.7;
    const super_height_offset = 0.5;
    const sub_height_offset = 0.3;
    const glyphs = [];
    const cursor = position.copy();
    let glyph_size = size.copy();
    const tilt = style.italic ? _StrokeFont.italic_tilt : 0;
    if (style.subscript || style.superscript) {
      glyph_size = glyph_size.multiply(super_sub_size_multiplier);
      if (style.subscript) {
        cursor.y += glyph_size.y * sub_height_offset;
      } else {
        cursor.y -= glyph_size.y * super_height_offset;
      }
    }
    for (const c of text) {
      switch (c) {
        case "	":
          {
            const char_tab_width = Math.round(
              glyph_size.x * tab_width
            );
            const current_intrusion = (cursor.x - origin.x) % char_tab_width;
            cursor.x += char_tab_width - current_intrusion;
          }
          break;
        case " ":
          cursor.x += Math.round(glyph_size.x * space_width);
          break;
        default:
          {
            const source = this.get_glyph(c);
            const extents = source.bbox.end.multiply(glyph_size);
            glyphs.push(
              source.transform(
                glyph_size,
                cursor,
                tilt,
                angle,
                mirror2,
                origin
              )
            );
            if (tilt) {
              extents.x -= extents.y * tilt;
            }
            cursor.x += Math.round(extents.x);
          }
          break;
      }
    }
    let has_bar = false;
    const bar_offset = new Vec2(0, 0);
    const bar_trim = glyph_size.x * 0.1;
    if (style.overbar) {
      has_bar = true;
      bar_offset.y = this.compute_overbar_vertical_position(glyph_size.y);
    } else if (style.underline) {
      has_bar = true;
      bar_offset.y = this.compute_underline_vertical_position(
        glyph_size.y
      );
    }
    if (has_bar) {
      if (style.italic) {
        bar_offset.x = bar_offset.y * _StrokeFont.italic_tilt;
      }
      const bar_start = new Vec2(
        position.x + bar_offset.x + bar_trim,
        cursor.y - bar_offset.y
      );
      const bar_end = new Vec2(
        cursor.x + bar_offset.x - bar_trim,
        cursor.y - bar_offset.y
      );
      const bar_glyph = new StrokeGlyph(
        [[bar_start, bar_end]],
        BBox.from_points([bar_start, bar_end])
      );
      glyphs.push(
        bar_glyph.transform(
          new Vec2(1, 1),
          new Vec2(0, 0),
          0,
          angle,
          mirror2,
          origin
        )
      );
    }
    const bbox = new BBox();
    bbox.start = position;
    bbox.end = new Vec2(
      cursor.x + bar_offset.x - Math.round(glyph_size.x * inter_char),
      cursor.y + Math.max(
        glyph_size.y,
        bar_offset.y * _StrokeFont.overbar_position_factor
      )
    );
    return {
      bbox,
      glyphs,
      cursor: new Vec2(cursor.x, position.y)
    };
  }
};
function ord(c) {
  return c.charCodeAt(0);
}
__name(ord, "ord");
function decode_coord_val(c) {
  return ord(c) - ord("R");
}
__name(decode_coord_val, "decode_coord_val");
function decode_coord(c) {
  return [decode_coord_val(c[0]), decode_coord_val(c[1])];
}
__name(decode_coord, "decode_coord");
function decode_glyph(glyph_data2) {
  let start_x = 0;
  let end_x = 0;
  let width = 0;
  let min_y = 0;
  let max_y = 0;
  const strokes = [];
  let points = null;
  for (let i = 0; i < glyph_data2.length; i += 2) {
    const coord_raw = [
      glyph_data2[i],
      glyph_data2[i + 1]
    ];
    const coord = decode_coord(coord_raw);
    if (i < 2) {
      start_x = coord[0] * StrokeFont.font_scale;
      end_x = coord[1] * StrokeFont.font_scale;
      width = end_x - start_x;
    } else if (coord_raw[0] == " " && coord_raw[1] == "R") {
      points = null;
    } else {
      const point = new Vec2(
        coord[0] * StrokeFont.font_scale - start_x,
        (coord[1] + StrokeFont.font_offset) * StrokeFont.font_scale
      );
      if (points == null) {
        points = [];
        strokes.push(points);
      }
      min_y = Math.min(min_y, point.y);
      max_y = Math.max(max_y, point.y);
      points.push(point);
    }
  }
  const bb = new BBox(0, min_y, width, max_y - min_y);
  const glyph = new StrokeGlyph(strokes, bb);
  return glyph;
}
__name(decode_glyph, "decode_glyph");

// kicad/text/eda-text.ts
var EDAText = class {
  constructor(text) {
    this.text_pos = new Vec2(0, 0);
    this.attributes = new TextAttributes();
    this.text = text;
  }
  static {
    __name(this, "EDAText");
  }
  /**
   * Apply "effects" parsed from schematic or board files.
   *
   * KiCad uses Effects to encapsulate all of the various text
   * options, this translates it into TextAttributes used by Font.
   */
  apply_effects(effects) {
    this.attributes.h_align = effects.justify.horizontal;
    this.attributes.v_align = effects.justify.vertical;
    this.attributes.mirrored = effects.justify.mirror;
    this.attributes.italic = effects.font.italic;
    this.attributes.bold = effects.font.bold;
    this.attributes.size.set(effects.font.size.multiply(1e4));
    this.attributes.stroke_width = (effects.font.thickness ?? 0) * 1e4;
    this.attributes.stroke_width = this.get_effective_text_thickness(1588);
    this.attributes.color = effects.font.color;
  }
  /**
   * Apply "at" parsed from schematic or board files.
   *
   * KiCad uses At to encapsulate both position and rotation. How this is
   * actually applied various based on the actual text item.
   */
  apply_at(at) {
    this.text_pos = at.position.multiply(1e4);
    this.text_angle = Angle.from_degrees(at.rotation);
  }
  /** The processed text that will be used for rendering */
  get shown_text() {
    return this.text;
  }
  /** Effective text width selected either the text thickness specified in
   * attributes if it's a valid value or the given default value. */
  get_effective_text_thickness(default_thickness) {
    let thickness = this.text_thickness;
    if (thickness < 1) {
      thickness = default_thickness ?? 0;
      if (this.bold) {
        thickness = get_bold_thickness(this.text_width);
      } else if (thickness <= 1) {
        thickness = get_normal_thickness(this.text_width);
      }
    }
    thickness = clamp_thickness(thickness, this.text_width, true);
    return thickness;
  }
  // Aliases for attributes
  get text_angle() {
    return this.attributes.angle;
  }
  set text_angle(a) {
    this.attributes.angle = a;
  }
  get italic() {
    return this.attributes.italic;
  }
  get bold() {
    return this.attributes.bold;
  }
  get visible() {
    return this.attributes.visible;
  }
  get mirrored() {
    return this.attributes.mirrored;
  }
  get multiline() {
    return this.attributes.multiline;
  }
  get h_align() {
    return this.attributes.h_align;
  }
  set h_align(v) {
    this.attributes.h_align = v;
  }
  get v_align() {
    return this.attributes.v_align;
  }
  set v_align(v) {
    this.attributes.v_align = v;
  }
  get line_spacing() {
    return this.attributes.line_spacing;
  }
  get text_size() {
    return this.attributes.size;
  }
  get text_width() {
    return this.attributes.size.x;
  }
  get text_height() {
    return this.attributes.size.y;
  }
  get text_color() {
    return this.attributes.color;
  }
  get keep_upright() {
    return this.attributes.keep_upright;
  }
  get text_thickness() {
    return this.attributes.stroke_width;
  }
  /**
   * Get the bounding box for a line or lines of text.
   *
   * Used by .bounding_box in LibText and SchField.
   *
   * Note: text is always treated as non-rotated.
   *
   * @param line - which line to measure, if null all lines are measured.
   * @param invert_y - inverts the y axis when calculating the bbox. Used
   *                   by eeschema for symbol text items.
   */
  get_text_box(line, invert_y) {
    const pos = this.text_pos.copy();
    const bbox = new BBox(0, 0, 0, 0);
    let strings = [];
    let text = this.shown_text;
    const thickness = this.get_effective_text_thickness();
    if (this.multiline) {
      strings = text.split("\n");
      if (strings.length) {
        if (line != void 0 && line < strings.length) {
          text = strings[line];
        } else {
          text = strings[0];
        }
      }
    }
    const font = StrokeFont.default();
    const font_size = this.text_size.copy();
    const bold = this.bold;
    const italic = this.italic;
    let extents = font.get_line_extents(
      text,
      font_size,
      thickness,
      bold,
      italic
    );
    let overbar_offset = 0;
    const text_size = extents.copy();
    if (this.multiline && line && line < strings.length) {
      pos.y -= Math.round(line * font.get_interline(font_size.y));
    }
    if (text.includes("~{")) {
      overbar_offset = extents.y / 14;
    }
    if (invert_y) {
      pos.y = -pos.y;
    }
    bbox.start = pos;
    if (this.multiline && !line && strings.length) {
      for (const line2 of strings.slice(1)) {
        extents = font.get_line_extents(
          line2,
          font_size,
          thickness,
          bold,
          italic
        );
        text_size.x = Math.max(text_size.x, extents.x);
      }
      text_size.y += Math.round(
        (strings.length - 1) * font.get_interline(font_size.y)
      );
    }
    bbox.w = text_size.x;
    bbox.h = text_size.y;
    const italic_offset = this.italic ? Math.round(font_size.y * Font3.italic_tilt) : 0;
    switch (this.h_align) {
      case "left":
        if (this.mirrored) {
          bbox.x = bbox.x - (bbox.w - italic_offset);
        }
        break;
      case "center":
        bbox.x = bbox.x - (bbox.w - italic_offset) / 2;
        break;
      case "right":
        if (!this.mirrored) {
          bbox.x = bbox.x - (bbox.w - italic_offset);
        }
        break;
    }
    switch (this.v_align) {
      case "top":
        break;
      case "center":
        bbox.y = bbox.y - (bbox.h + overbar_offset) / 2;
        break;
      case "bottom":
        bbox.y = bbox.y - (bbox.h + overbar_offset);
        break;
    }
    return bbox;
  }
};
function get_bold_thickness(text_width) {
  return Math.round(text_width / 5);
}
__name(get_bold_thickness, "get_bold_thickness");
function get_normal_thickness(text_width) {
  return Math.round(text_width / 8);
}
__name(get_normal_thickness, "get_normal_thickness");
function clamp_thickness(thickness, text_width, allow_bold) {
  const max_thickness = Math.round(text_width * (allow_bold ? 0.25 : 0.18));
  return Math.min(thickness, max_thickness);
}
__name(clamp_thickness, "clamp_thickness");

// kicad/text/lib-text.ts
var LibText2 = class extends EDAText {
  static {
    __name(this, "LibText");
  }
  constructor(text) {
    super(text);
  }
  get shown_text() {
    return this.text;
  }
  /**
   * Get world space bounding box
   *
   * Schematic symbols use an "inverted" (bottom to top) Y axis, so this
   * flips the box, rotates it, and flips it back so that it's properly
   * in world space.
   */
  get bounding_box() {
    let bbox = this.get_text_box(void 0, true).mirror_vertical();
    const pos = this.text_pos;
    let start = bbox.start;
    let end = bbox.end;
    const angle = this.text_angle.negative();
    start = angle.rotate_point(start, pos);
    end = angle.rotate_point(end, pos);
    bbox = BBox.from_points([start, end]);
    bbox = bbox.mirror_vertical();
    return bbox;
  }
  /**
   * Returns the center of the text's BBox in world coordinates.
   *
   * This contains the positioning logic KiCad performs in
   * SCH_PAINTER::Draw(LIB_TEXT). It made more sense for it to be here for
   * us.
   */
  get world_pos() {
    const bbox = this.bounding_box;
    const pos = bbox.center;
    if (this.attributes.angle.is_vertical) {
      switch (this.attributes.h_align) {
        case "left":
          pos.y = bbox.y2;
          break;
        case "center":
          pos.y = (bbox.y + bbox.y2) / 2;
          break;
        case "right":
          pos.y = bbox.y;
          break;
      }
    } else {
      switch (this.attributes.h_align) {
        case "left":
          pos.x = bbox.x;
          break;
        case "center":
          pos.x = (bbox.x + bbox.x2) / 2;
          break;
        case "right":
          pos.x = bbox.x2;
          break;
      }
    }
    return pos;
  }
  /**
   * Applies symbol transformation (rotation, position, mirror).
   *
   * Uses the rotate() and mirror_*() methods to properly orient and position
   * symbol text, since KiCad does not directly use a symbol's transformation
   * to orient text. Instead, KiCad deep copies the library symbol then calls
   * rotate() on text items multiple times based on the symbol instance's
   * rotation. This makes it non-trivial to directly set the text's location
   * and orientation, so we adopt their somewhat convoluted method. See
   * KiCad's sch_painter.cpp::orientSymbol.
   */
  apply_symbol_transformations(transforms) {
    for (let i = 0; i < transforms.rotations; i++) {
      this.rotate(new Vec2(0, 0), true);
    }
    if (transforms.mirror_x) {
      this.mirror_vertically(new Vec2(0, 0));
    }
    if (transforms.mirror_y) {
      this.mirror_horizontally(new Vec2(0, 0));
    }
    this.text_pos = this.text_pos.add(
      transforms.position.multiply(new Vec2(1e4, -1e4))
    );
  }
  /**
   * Internal utility method for offsetting the text position based on the
   * horizontal and vertical justification.
   */
  normalize_justification(inverse) {
    let delta = new Vec2(0, 0);
    const bbox = this.get_text_box();
    if (this.text_angle.is_horizontal) {
      if (this.h_align == "left") {
        delta.x = bbox.w / 2;
      } else if (this.h_align == "right") {
        delta.x = -(bbox.w / 2);
      }
      if (this.v_align == "top") {
        delta.y = -(bbox.h / 2);
      } else if (this.v_align == "bottom") {
        delta.y = bbox.h / 2;
      }
    } else {
      if (this.h_align == "left") {
        delta.y = bbox.w / 2;
      } else if (this.h_align == "right") {
        delta.y = -(bbox.w / 2);
      }
      if (this.v_align == "top") {
        delta.x = bbox.h / 2;
      } else if (this.v_align == "bottom") {
        delta.x = -(bbox.h / 2);
      }
    }
    if (inverse) {
      delta = delta.multiply(-1);
    }
    this.text_pos = this.text_pos.add(delta);
  }
  /**
   * Rotate the text
   *
   * KiCad's rotation of LIB_TEXT objects is somewhat convoluted, but
   * essentially the text is moved to the center of its current bounding box,
   * rotated around the center, and then offset from the center of the
   * bounding box based on the text justification.
   */
  rotate(center, ccw = false) {
    this.normalize_justification(false);
    const angle = Angle.from_degrees(ccw ? -90 : 90);
    this.text_pos = angle.rotate_point(this.text_pos, center);
    if (this.text_angle.is_horizontal) {
      this.text_angle.degrees = 90;
    } else {
      this.h_align = swap_values(this.h_align, "left", "right");
      this.v_align = swap_values(this.v_align, "top", "bottom");
      this.text_angle.degrees = 0;
    }
    this.normalize_justification(true);
  }
  /**
   * Mirrors the text horizontally.
   *
   * Deals with reassigning the horizontal justification, as mirroring
   * left aligned text is the same as changing it to right aligned.
   */
  mirror_horizontally(center) {
    this.normalize_justification(false);
    let x = this.text_pos.x;
    x -= center.x;
    x *= -1;
    x += center.x;
    if (this.text_angle.is_horizontal) {
      this.h_align = swap_values(this.h_align, "left", "right");
    } else {
      this.v_align = swap_values(this.v_align, "top", "bottom");
    }
    this.text_pos.x = x;
    this.normalize_justification(true);
  }
  /**
   * Mirrors the text vertically.
   *
   * Deals with reassigning the vertical justification, as mirroring
   * top aligned text is the same as changing it to bottom aligned.
   */
  mirror_vertically(center) {
    this.normalize_justification(false);
    let y = this.text_pos.y;
    y -= center.y;
    y *= -1;
    y += center.y;
    if (this.text_angle.is_horizontal) {
      this.v_align = swap_values(this.v_align, "top", "bottom");
    } else {
      this.h_align = swap_values(this.h_align, "left", "right");
    }
    this.text_pos.y = y;
    this.normalize_justification(true);
  }
};
function swap_values(v, a, b) {
  if (v == a) {
    return b;
  } else if (v == b) {
    return a;
  }
  return v;
}
__name(swap_values, "swap_values");

// kicad/text/sch-field.ts
var SchField = class extends EDAText {
  constructor(text, parent) {
    super(text);
    this.parent = parent;
  }
  static {
    __name(this, "SchField");
  }
  get shown_text() {
    if (this.text == "~") {
      return "";
    }
    return this.text;
  }
  /** Get effective rotation when drawing, taking into account the parent
   * position orientation, and transformation.
   */
  get draw_rotation() {
    let this_deg = this.text_angle.degrees;
    const parent_transform = this.parent?.transform ?? Matrix3.identity();
    if (Math.abs(parent_transform.elements[1]) == 1) {
      if (this_deg == 0 || this_deg == 180) {
        this_deg = 90;
      } else {
        this_deg = 0;
      }
    }
    return Angle.from_degrees(this_deg);
  }
  get position() {
    if (this.parent) {
      let relative_pos = this.text_pos.sub(this.parent.position);
      relative_pos = this.parent.transform.transform(relative_pos);
      return relative_pos.add(this.parent.position);
    }
    return this.text_pos;
  }
  get bounding_box() {
    const bbox = this.get_text_box();
    if (!this.parent?.is_symbol) {
      return bbox;
    }
    const origin = this.parent?.position ?? new Vec2(0, 0);
    const pos = this.text_pos.sub(origin);
    let begin = bbox.start.sub(origin);
    let end = bbox.end.sub(origin);
    begin = this.text_angle.rotate_point(begin, pos);
    end = this.text_angle.rotate_point(end, pos);
    begin.y = mirror(begin.y, pos.y);
    end.y = mirror(end.y, pos.y);
    const transform = this.parent?.transform ?? Matrix3.identity();
    bbox.start = transform.transform(begin);
    bbox.end = transform.transform(end);
    bbox.start = bbox.start.add(origin);
    return bbox;
  }
};
function mirror(v, ref = 0) {
  return -(v - ref) + ref;
}
__name(mirror, "mirror");

// kicad/text/sch-text.ts
var SchText = class extends EDAText {
  static {
    __name(this, "SchText");
  }
  constructor(text) {
    super(text);
  }
  apply_at(at) {
    super.apply_at(at);
    this.set_spin_style_from_angle(this.text_angle);
  }
  set_spin_style_from_angle(a) {
    switch (a.degrees) {
      default:
      case 0:
        this.text_angle.degrees = 0;
        this.h_align = "left";
        break;
      case 90:
        this.text_angle.degrees = 90;
        this.h_align = "left";
        break;
      case 180:
        this.text_angle.degrees = 0;
        this.h_align = "right";
        break;
      case 270:
        this.text_angle.degrees = 90;
        this.h_align = "right";
        break;
    }
    this.v_align = "bottom";
  }
  get shown_text() {
    return this.text;
  }
};

// viewers/base/view-layers.ts
var ViewLayer = class {
  /**
   * Create a new Layer.
   * @param layer_set - the LayerSet that this Layer belongs to
   * @param name - this layer's name
   * @param visible - controls whether the layer is visible when rendering, may be a function returning a boolean.
   */
  constructor(layer_set, name, visible = true, interactive = false, color = Color.white) {
    this.highlighted = false;
    /**
     * True if this layer contains interactive items that are findable via
     * ViewLayerSet.query_point
     */
    this.interactive = false;
    /**
     * A map of board items to bounding boxes
     * A board item can have graphics on multiple layers, the bounding box provided
     * here is only valid for this layer.
     */
    this.bboxes = /* @__PURE__ */ new Map();
    this.#visible = visible;
    this.layer_set = layer_set;
    this.name = name;
    this.color = color;
    this.interactive = interactive;
    this.items = [];
  }
  static {
    __name(this, "ViewLayer");
  }
  #visible;
  dispose() {
    this.clear();
  }
  clear() {
    this.graphics?.dispose();
    this.graphics = void 0;
    this.items = [];
    this.bboxes.clear();
  }
  get visible() {
    if (this.#visible instanceof Function) {
      return this.#visible();
    } else {
      return this.#visible;
    }
  }
  set visible(v) {
    this.#visible = v;
  }
  /** The overall bounding box of all items on this layer */
  get bbox() {
    return BBox.combine(this.bboxes.values());
  }
  /** @yields a list of BBoxes that contain the given point */
  *query_point(p) {
    for (const bb of this.bboxes.values()) {
      if (bb.contains_point(p)) {
        yield bb;
      }
    }
  }
};
var ViewLayerSet = class {
  static {
    __name(this, "ViewLayerSet");
  }
  #layer_list = [];
  #layer_map = /* @__PURE__ */ new Map();
  #overlay;
  /**
   * Create a new LayerSet
   */
  constructor() {
    this.#overlay = new ViewLayer(
      this,
      ":Overlay" /* overlay */,
      true,
      false,
      Color.white
    );
  }
  /**
   * Dispose of any resources held by layers
   */
  dispose() {
    this.#overlay.dispose();
    for (const layer of this.#layer_list) {
      layer.dispose();
    }
    this.#layer_list.length = 0;
    this.#layer_map.clear();
  }
  /**
   * Adds layers to the set. Layers should be added front to back.
   */
  add(...layers) {
    for (const layer of layers) {
      this.#layer_list.push(layer);
      this.#layer_map.set(layer.name, layer);
    }
  }
  /**
   * @yields layers in the order they were added (front to back), does not
   * include the overlay layer.
   */
  *in_order() {
    for (const layer of this.#layer_list) {
      yield layer;
    }
  }
  /**
   * @yields layers in the order they should be drawn (back to front),
   * including the overlay layer.
   */
  *in_display_order() {
    for (let i = this.#layer_list.length - 1; i >= 0; i--) {
      const layer = this.#layer_list[i];
      if (!layer.highlighted) {
        yield layer;
      }
    }
    for (let i = this.#layer_list.length - 1; i >= 0; i--) {
      const layer = this.#layer_list[i];
      if (layer.highlighted) {
        yield layer;
      }
    }
    yield this.#overlay;
  }
  /**
   * Gets a Layer by name
   */
  by_name(name) {
    return this.#layer_map.get(name);
  }
  /**
   * Returns all layers that "match" the given pattern.
   */
  *query(predicate) {
    for (const l of this.#layer_list) {
      if (predicate(l)) {
        yield l;
      }
    }
  }
  /**
   * Gets the special overlay layer, which is always visible and always
   * drawn above all others.
   */
  get overlay() {
    return this.#overlay;
  }
  /**
   * Highlights the given layer(s), by default they're drawn above other layers.
   */
  highlight(layer_or_layers) {
    let layer_names = [];
    if (layer_or_layers) {
      layer_names = iterable_as_array(layer_or_layers).map(
        (v) => v instanceof ViewLayer ? v.name : v
      );
    }
    for (const l of this.#layer_list) {
      if (layer_names.includes(l.name)) {
        l.highlighted = true;
      } else {
        l.highlighted = false;
      }
    }
  }
  is_any_layer_highlighted() {
    for (const l of this.#layer_list) {
      if (l.highlighted) {
        return true;
      }
    }
    return false;
  }
  *grid_layers() {
    yield this.by_name(":Grid" /* grid */);
  }
  /**
   * @yields a list of interactive layers
   */
  *interactive_layers() {
    for (const layer of this.in_order()) {
      if (layer.interactive && layer.visible) {
        yield layer;
      }
    }
  }
  /**
   * @yields layers and bounding boxes that contain the given point.
   */
  *query_point(p) {
    for (const layer of this.interactive_layers()) {
      for (const bbox of layer.query_point(p)) {
        yield { layer, bbox };
      }
    }
  }
  /**
   * @yields bboxes on interactive layers for the given item.
   */
  *query_item_bboxes(item) {
    for (const layer of this.interactive_layers()) {
      const bbox = layer.bboxes.get(item);
      if (bbox) {
        yield bbox;
      }
    }
  }
  /**
   * @return a bounding box encompassing all elements from all layers.
   */
  get bbox() {
    const bboxes = [];
    for (const layer of this.in_order()) {
      bboxes.push(layer.bbox);
    }
    return BBox.combine(bboxes);
  }
};

// viewers/base/painter.ts
var log3 = new Logger("kicanvas:project");
var ItemPainter = class {
  constructor(view_painter, gfx) {
    this.view_painter = view_painter;
    this.gfx = gfx;
  }
  static {
    __name(this, "ItemPainter");
  }
  get theme() {
    return this.view_painter.theme;
  }
};
var DocumentPainter = class {
  /**
   * Create a ViewPainter.
   */
  constructor(gfx, layers, theme3) {
    this.gfx = gfx;
    this.layers = layers;
    this.theme = theme3;
  }
  static {
    __name(this, "DocumentPainter");
  }
  #painters = /* @__PURE__ */ new Map();
  set painter_list(painters) {
    for (const painter of painters) {
      for (const type of painter.classes) {
        this.#painters.set(type, painter);
      }
    }
  }
  get painters() {
    return this.#painters;
  }
  paint(document2) {
    log3.debug("Painting");
    log3.debug("Sorting paintable items into layers");
    for (const item of document2.items()) {
      const painter = this.painter_for(item);
      if (!painter) {
        log3.warn(`No painter found for ${item?.constructor.name}`);
        continue;
      }
      for (const layer_name of painter.layers_for(item)) {
        this.layers.by_name(layer_name)?.items.push(item);
      }
    }
    for (const layer of this.paintable_layers()) {
      log3.debug(
        `Painting layer ${layer.name} with ${layer.items.length} items`
      );
      this.paint_layer(layer);
    }
    log3.debug("Painting complete");
  }
  *paintable_layers() {
    yield* this.layers.in_display_order();
  }
  paint_layer(layer) {
    const bboxes = /* @__PURE__ */ new Map();
    this.gfx.start_layer(layer.name);
    for (const item of layer.items) {
      this.gfx.start_bbox();
      this.paint_item(layer, item);
      const bbox = this.gfx.end_bbox(item);
      bboxes.set(item, bbox);
    }
    layer.graphics = this.gfx.end_layer();
    layer.bboxes = bboxes;
  }
  paint_item(layer, item, ...rest) {
    const painter = this.painter_for(item);
    painter?.paint(layer, item, ...rest);
  }
  painter_for(item) {
    return this.painters.get(item.constructor);
  }
  layers_for(item) {
    return this.painters.get(item.constructor)?.layers_for(item) || [];
  }
};
var StrokePainter = class _StrokePainter {
  static {
    __name(this, "StrokePainter");
  }
  static line(lines, width, stroke_style, draw_line) {
    const stroke_type = stroke_style.stroke;
    if (stroke_type.type === "solid" || stroke_type.type === "default") {
      draw_line(lines);
      return;
    }
    for (const [start, end] of _StrokePainter.windowed2_iter(lines)) {
      this.line_helper(start, end, width, stroke_style, draw_line);
    }
  }
  static line_helper(start, end, width, stroke_style, draw_line) {
    const line_vec = end.sub(start);
    const line_len = line_vec.magnitude;
    const line_dir_vec = line_vec.normalize();
    const dot_len = StrokeParams.dot_length(width);
    const gap_len = StrokeParams.gap_length(width, stroke_style);
    const dash_len = StrokeParams.dash_length(width, stroke_style);
    let line_pattern = [];
    switch (stroke_style.stroke.type) {
      case "dash":
        line_pattern = [dash_len, gap_len];
        break;
      case "dot":
        line_pattern = [dot_len, gap_len];
        break;
      case "dash_dot":
        line_pattern = [dash_len, gap_len, dot_len, gap_len];
        break;
      case "dash_dot_dot":
        line_pattern = [
          dash_len,
          gap_len,
          dot_len,
          gap_len,
          dot_len,
          gap_len
        ];
        break;
      default:
        return;
    }
    let draw_len = 0;
    let pattern_index = 0;
    while (draw_len < line_len) {
      const pattern = line_pattern[pattern_index];
      const segment_len = Math.min(pattern, line_len - draw_len);
      if (pattern_index % 2 === 0 && segment_len > 0) {
        const seg_start = start.add(line_dir_vec.multiply(draw_len));
        const seg_end = seg_start.add(
          line_dir_vec.multiply(segment_len)
        );
        draw_line([seg_start, seg_end]);
      }
      draw_len += segment_len;
      pattern_index = (pattern_index + 1) % line_pattern.length;
    }
  }
  /** [1, 2, 3, 4, 5] -> [(1, 2), (2, 3), (3, 4), (4, 5), ...] */
  static *windowed2_iter(items) {
    for (let i = 0; i < items.length - 1; i++) {
      yield [items[i], items[i + 1]];
    }
  }
};

// viewers/drawing-sheet/painter.ts
function offset_point(sheet, point, anchor, constrain = true) {
  const tl = sheet.top_left;
  const tr = sheet.top_right;
  const bl = sheet.bottom_left;
  const br = sheet.bottom_right;
  const bbox = sheet.margin_bbox;
  switch (anchor) {
    case "ltcorner":
      point = tl.add(point);
      break;
    case "rbcorner":
      point = br.sub(point);
      break;
    case "lbcorner":
      point = bl.add(new Vec2(point.x, -point.y));
      break;
    case "rtcorner":
      point = tr.add(new Vec2(-point.x, point.y));
      break;
  }
  if (constrain && !bbox.contains_point(point)) {
    return;
  }
  return point;
}
__name(offset_point, "offset_point");
var LinePainter = class extends ItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Line2];
  }
  static {
    __name(this, "LinePainter");
  }
  layers_for(item) {
    return [":DrawingSheet" /* drawing_sheet */];
  }
  paint(layer, l) {
    const sheet = l.parent;
    const [incrx, incry] = [l.incrx ?? 0, l.incry ?? 0];
    for (let i = 0; i < l.repeat; i++) {
      const offset = new Vec2(incrx * i, incry * i);
      const [start, end] = [
        offset_point(
          sheet,
          l.start.position.add(offset),
          l.start.anchor
        ),
        offset_point(sheet, l.end.position.add(offset), l.start.anchor)
      ];
      if (!start || !end) {
        return;
      }
      this.gfx.line(
        new Polyline2(
          [start, end],
          l.linewidth || sheet.setup.linewidth,
          layer.color
        )
      );
    }
  }
};
var RectPainter = class extends ItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Rect2];
  }
  static {
    __name(this, "RectPainter");
  }
  layers_for(item) {
    return [":DrawingSheet" /* drawing_sheet */];
  }
  paint(layer, r) {
    const sheet = r.parent;
    const [incrx, incry] = [r.incrx ?? 0, r.incry ?? 0];
    for (let i = 0; i < r.repeat; i++) {
      const offset = new Vec2(incrx * i, incry * i);
      const [start, end] = [
        offset_point(
          sheet,
          r.start.position.add(offset),
          r.start.anchor,
          i > 0
        ),
        offset_point(
          sheet,
          r.end.position.add(offset),
          r.end.anchor,
          i > 0
        )
      ];
      if (!start || !end) {
        return;
      }
      const bbox = BBox.from_points([start, end]);
      this.gfx.line(
        Polyline2.from_BBox(
          bbox,
          r.linewidth || sheet.setup.linewidth,
          layer.color
        )
      );
    }
  }
};
var TbTextPainter = class extends ItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [TbText];
  }
  static {
    __name(this, "TbTextPainter");
  }
  layers_for(item) {
    return [":DrawingSheet" /* drawing_sheet */];
  }
  paint(layer, t) {
    const edatext = new EDAText(t.shown_text);
    edatext.h_align = "left";
    edatext.v_align = "center";
    edatext.text_angle = Angle.from_degrees(t.rotate);
    switch (t.justify) {
      case "center":
        edatext.h_align = "center";
        edatext.v_align = "center";
        break;
      case "left":
        edatext.h_align = "left";
        break;
      case "right":
        edatext.h_align = "right";
        break;
      case "top":
        edatext.v_align = "top";
        break;
      case "bottom":
        edatext.v_align = "bottom";
        break;
    }
    edatext.attributes.bold = t.font?.bold ?? false;
    edatext.attributes.italic = t.font?.italic ?? false;
    edatext.attributes.color = layer.color;
    edatext.attributes.size = (t.font?.size ?? t.parent.setup.textsize).multiply(1e4);
    edatext.attributes.stroke_width = (t.font?.linewidth ?? t.parent.setup.textlinewidth) * 1e4;
    const [incrx, incry] = [t.incrx ?? 0, t.incry ?? 0];
    for (let i = 0; i < t.repeat; i++) {
      const offset = new Vec2(incrx * i, incry * i);
      const pos = offset_point(
        t.parent,
        t.pos.position.add(offset),
        t.pos.anchor
      );
      if (!pos) {
        return;
      }
      if (t.incrlabel && t.text.length == 1) {
        const incr = t.incrlabel * i;
        const chrcode = t.text.charCodeAt(0);
        if (chrcode >= "0".charCodeAt(0) && chrcode <= "9".charCodeAt(0)) {
          edatext.text = `${incr + chrcode - "0".charCodeAt(0)}`;
        } else {
          edatext.text = String.fromCharCode(chrcode + incr);
        }
      }
      edatext.text_pos = pos?.multiply(1e4);
      this.gfx.state.push();
      StrokeFont.default().draw(
        this.gfx,
        edatext.shown_text,
        edatext.text_pos,
        edatext.attributes
      );
      this.gfx.state.pop();
    }
  }
};
var DrawingSheetPainter = class extends DocumentPainter {
  static {
    __name(this, "DrawingSheetPainter");
  }
  constructor(gfx, layers, theme3) {
    super(gfx, layers, theme3);
    this.painter_list = [
      new LinePainter(this, gfx),
      new RectPainter(this, gfx),
      new TbTextPainter(this, gfx)
    ];
  }
  *paintable_layers() {
    yield this.layers.by_name(":DrawingSheet" /* drawing_sheet */);
  }
};

// viewers/base/grid.ts
var GridLOD = class {
  constructor(min_zoom, spacing, radius) {
    this.min_zoom = min_zoom;
    this.spacing = spacing;
    this.radius = radius;
  }
  static {
    __name(this, "GridLOD");
  }
};
var Grid = class {
  constructor(gfx, camera, layer, origin = new Vec2(0, 0), color = Color.white, origin_color = Color.white, lods = [new GridLOD(2.5, 10, 0.2), new GridLOD(15, 1, 0.05)]) {
    this.gfx = gfx;
    this.camera = camera;
    this.layer = layer;
    this.origin = origin;
    this.color = color;
    this.origin_color = origin_color;
    this.lods = lods;
  }
  static {
    __name(this, "Grid");
  }
  #last_grid_bbox = new BBox(0, 0, 0, 0);
  #last_grid_lod;
  reset() {
    this.#last_grid_lod = void 0;
    this.#last_grid_bbox.w = 0;
    this.#last_grid_bbox.h = 0;
    this.layer.clear();
  }
  update() {
    let lod;
    for (const l of this.lods) {
      if (this.camera.zoom >= l.min_zoom) {
        lod = l;
      }
    }
    if (!lod) {
      this.reset();
      return;
    }
    let bbox = this.camera.bbox;
    if (this.#last_grid_lod == lod && this.#last_grid_bbox.contains(bbox)) {
      return;
    }
    bbox = bbox.grow(bbox.w * 0.2);
    this.#last_grid_lod = lod;
    this.#last_grid_bbox = bbox;
    let grid_start_x = Math.round((bbox.x - this.origin.x) / lod.spacing);
    let grid_end_x = Math.round((bbox.x2 - this.origin.x) / lod.spacing);
    let grid_start_y = Math.round((bbox.y - this.origin.y) / lod.spacing);
    let grid_end_y = Math.round((bbox.y2 - this.origin.y) / lod.spacing);
    if (grid_start_x > grid_end_x) {
      [grid_start_x, grid_end_x] = [grid_end_x, grid_start_x];
    }
    if (grid_start_y > grid_end_y) {
      [grid_start_y, grid_end_y] = [grid_end_y, grid_start_y];
    }
    grid_end_x += 1;
    grid_end_y += 1;
    this.gfx.start_layer(this.layer.name);
    for (let grid_x = grid_start_x; grid_x <= grid_end_x; grid_x += 1) {
      for (let grid_y = grid_start_y; grid_y <= grid_end_y; grid_y += 1) {
        const pos = new Vec2(
          grid_x * lod.spacing + this.origin.x,
          grid_y * lod.spacing + this.origin.y
        );
        this.gfx.circle(pos, lod.radius, this.color);
      }
    }
    if (this.origin.x != 0 && this.origin.y != 0) {
      this.gfx.arc(
        this.origin,
        1,
        new Angle(0),
        new Angle(2 * Math.PI),
        lod.radius / 2,
        this.origin_color
      );
      let origin_offset = new Vec2(1.5, 1.5);
      this.gfx.line(
        [
          this.origin.sub(origin_offset),
          this.origin.add(origin_offset)
        ],
        lod.radius / 2,
        this.origin_color
      );
      origin_offset = new Vec2(-1.5, 1.5);
      this.gfx.line(
        [
          this.origin.sub(origin_offset),
          this.origin.add(origin_offset)
        ],
        lod.radius / 2,
        this.origin_color
      );
    }
    this.layer.graphics = this.gfx.end_layer();
  }
};

// base/local-storage.ts
var LocalStorage = class {
  constructor(prefix = "kc", reviver) {
    this.prefix = prefix;
    this.reviver = reviver;
  }
  static {
    __name(this, "LocalStorage");
  }
  key_for(key) {
    return `${this.prefix}:${key}`;
  }
  set(key, val, exp) {
    window.localStorage.setItem(
      this.key_for(key),
      JSON.stringify({
        val,
        exp
      })
    );
  }
  get(key, fallback) {
    const item_data = window.localStorage.getItem(this.key_for(key));
    if (item_data === null) {
      return fallback;
    }
    const item = JSON.parse(item_data, this.reviver);
    if (item.exp && item.exp < Date.now()) {
      this.delete(key);
      return fallback;
    }
    return item.val;
  }
  delete(key) {
    window.localStorage.removeItem(this.key_for(key));
  }
};

// kicanvas/themes/witch-hazel.ts
var theme = {
  name: "witchhazel",
  friendly_name: "Witch Hazel",
  board: {
    anchor: Color.from_css("rgb(100, 203, 150)"),
    aux_items: Color.from_css("rgb(255, 98, 0)"),
    b_adhes: Color.from_css("rgb(0, 0, 132)"),
    b_crtyd: Color.from_css("rgb(174, 129, 255)"),
    b_fab: Color.from_css("rgb(113, 103, 153)"),
    b_mask: Color.from_css("rgba(78, 129, 137, 0.800)"),
    b_paste: Color.from_css("rgba(167, 234, 255, 0.502)"),
    b_silks: Color.from_css("rgb(136, 100, 203)"),
    background: Color.from_css("rgb(19, 18, 24)"),
    cmts_user: Color.from_css("rgb(129, 255, 190)"),
    copper: {
      b: Color.from_css("rgb(111, 204, 219)"),
      f: Color.from_css("rgb(226, 114, 153)"),
      in1: Color.from_css("rgb(127, 200, 127)"),
      in10: Color.from_css("rgb(237, 124, 51)"),
      in11: Color.from_css("rgb(91, 195, 235)"),
      in12: Color.from_css("rgb(247, 111, 142)"),
      in13: Color.from_css("rgb(167, 165, 198)"),
      in14: Color.from_css("rgb(40, 204, 217)"),
      in15: Color.from_css("rgb(232, 178, 167)"),
      in16: Color.from_css("rgb(242, 237, 161)"),
      in17: Color.from_css("rgb(237, 124, 51)"),
      in18: Color.from_css("rgb(91, 195, 235)"),
      in19: Color.from_css("rgb(247, 111, 142)"),
      in2: Color.from_css("rgb(206, 125, 44)"),
      in20: Color.from_css("rgb(167, 165, 198)"),
      in21: Color.from_css("rgb(40, 204, 217)"),
      in22: Color.from_css("rgb(232, 178, 167)"),
      in23: Color.from_css("rgb(242, 237, 161)"),
      in24: Color.from_css("rgb(237, 124, 51)"),
      in25: Color.from_css("rgb(91, 195, 235)"),
      in26: Color.from_css("rgb(247, 111, 142)"),
      in27: Color.from_css("rgb(167, 165, 198)"),
      in28: Color.from_css("rgb(40, 204, 217)"),
      in29: Color.from_css("rgb(232, 178, 167)"),
      in3: Color.from_css("rgb(79, 203, 203)"),
      in30: Color.from_css("rgb(242, 237, 161)"),
      in4: Color.from_css("rgb(219, 98, 139)"),
      in5: Color.from_css("rgb(167, 165, 198)"),
      in6: Color.from_css("rgb(40, 204, 217)"),
      in7: Color.from_css("rgb(232, 178, 167)"),
      in8: Color.from_css("rgb(242, 237, 161)"),
      in9: Color.from_css("rgb(141, 203, 129)")
    },
    cursor: Color.from_css("rgb(220, 200, 255)"),
    drc_error: Color.from_css("rgba(255, 0, 237, 0.800)"),
    drc_exclusion: Color.from_css("rgba(255, 255, 255, 0.800)"),
    drc_warning: Color.from_css("rgba(255, 208, 66, 0.800)"),
    dwgs_user: Color.from_css("rgb(248, 248, 240)"),
    eco1_user: Color.from_css("rgb(129, 238, 255)"),
    eco2_user: Color.from_css("rgb(255, 129, 173)"),
    edge_cuts: Color.from_css("rgb(129, 255, 190)"),
    f_adhes: Color.from_css("rgb(132, 0, 132)"),
    f_crtyd: Color.from_css("rgb(174, 129, 255)"),
    f_fab: Color.from_css("rgb(113, 103, 153)"),
    f_mask: Color.from_css("rgb(137, 78, 99)"),
    f_paste: Color.from_css("rgba(252, 249, 255, 0.502)"),
    f_silks: Color.from_css("rgb(220, 200, 255)"),
    footprint_text_invisible: Color.from_css("rgb(40, 38, 52)"),
    grid: Color.from_css("rgb(113, 103, 153)"),
    grid_axes: Color.from_css("rgb(255, 129, 173)"),
    margin: Color.from_css("rgb(78, 137, 107)"),
    no_connect: Color.from_css("rgb(255, 148, 0)"),
    pad_plated_hole: Color.from_css("rgb(194, 194, 0)"),
    pad_through_hole: Color.from_css("rgb(227, 209, 46)"),
    non_plated_hole: Color.from_css("rgb(129, 255, 190)"),
    ratsnest: Color.from_css("rgb(128, 119, 168)"),
    user_1: Color.from_css("rgb(194, 118, 0)"),
    user_2: Color.from_css("rgb(89, 148, 220)"),
    user_3: Color.from_css("rgb(180, 219, 210)"),
    user_4: Color.from_css("rgb(216, 200, 82)"),
    user_5: Color.from_css("rgb(194, 194, 194)"),
    user_6: Color.from_css("rgb(89, 148, 220)"),
    user_7: Color.from_css("rgb(180, 219, 210)"),
    user_8: Color.from_css("rgb(216, 200, 82)"),
    user_9: Color.from_css("rgb(232, 178, 167)"),
    via_blind_buried: Color.from_css("rgb(203, 196, 100)"),
    via_hole: Color.from_css("rgb(40, 38, 52)"),
    via_micro: Color.from_css("rgb(255, 148, 0)"),
    via_through: Color.from_css("rgb(227, 209, 46)"),
    worksheet: Color.from_css("rgb(100, 190, 203)")
  },
  schematic: {
    anchor: Color.from_css("rgb(174, 129, 255)"),
    aux_items: Color.from_css("rgb(255, 160, 0)"),
    background: Color.from_css("rgb(19, 18, 24)"),
    brightened: Color.from_css("rgb(200, 255, 227)"),
    bus: Color.from_css("rgb(129, 238, 255)"),
    bus_junction: Color.from_css("rgb(163, 243, 255)"),
    component_body: Color.from_css("rgb(67, 62, 86)"),
    component_outline: Color.from_css("rgb(197, 163, 255)"),
    cursor: Color.from_css("rgb(220, 200, 255)"),
    erc_error: Color.from_css("rgba(255, 55, 162, 0.800)"),
    erc_warning: Color.from_css("rgba(255, 92, 0, 0.800)"),
    fields: Color.from_css("rgb(174, 129, 255)"),
    grid: Color.from_css("rgb(113, 103, 153)"),
    grid_axes: Color.from_css("rgb(255, 129, 173)"),
    hidden: Color.from_css("rgb(67, 62, 86)"),
    junction: Color.from_css("rgb(220, 200, 255)"),
    label_global: Color.from_css("rgb(255, 247, 129)"),
    label_hier: Color.from_css("rgb(163, 255, 207)"),
    label_local: Color.from_css("rgb(220, 200, 255)"),
    netclass_flag: Color.from_css("rgb(220, 200, 255)"),
    no_connect: Color.from_css("rgb(255, 129, 173)"),
    note: Color.from_css("rgb(248, 248, 240)"),
    pin: Color.from_css("rgb(129, 255, 190)"),
    pin_name: Color.from_css("rgb(129, 255, 190)"),
    pin_number: Color.from_css("rgb(100, 203, 150)"),
    reference: Color.from_css("rgb(129, 238, 255)"),
    rule_area: Color.from_css("rgb(197, 163, 255)"),
    shadow: Color.from_css("rgb(200, 248, 255)"),
    sheet: Color.from_css("rgb(174, 129, 255)"),
    sheet_background: Color.from_css("rgb(19, 18, 24)"),
    sheet_fields: Color.from_css("rgb(129, 255, 190)"),
    sheet_filename: Color.from_css("rgb(78, 129, 137)"),
    sheet_label: Color.from_css("rgb(129, 255, 190)"),
    sheet_name: Color.from_css("rgb(129, 238, 255)"),
    value: Color.from_css("rgb(129, 238, 255)"),
    wire: Color.from_css("rgb(174, 129, 255)"),
    worksheet: Color.from_css("rgb(100, 190, 203)")
  }
};
var witch_hazel_default = theme;

// kicanvas/themes/kicad-default.ts
var theme2 = {
  name: "kicad",
  friendly_name: "KiCad",
  board: {
    anchor: Color.from_css("rgb(255, 38, 226)"),
    aux_items: Color.from_css("rgb(255, 255, 255)"),
    b_adhes: Color.from_css("rgb(0, 0, 132)"),
    b_crtyd: Color.from_css("rgb(38, 233, 255)"),
    b_fab: Color.from_css("rgb(88, 93, 132)"),
    b_mask: Color.from_css("rgba(2, 255, 238, 0.400)"),
    b_paste: Color.from_css("rgba(0, 194, 194, 0.902)"),
    b_silks: Color.from_css("rgb(232, 178, 167)"),
    background: Color.from_css("rgb(0, 16, 35)"),
    cmts_user: Color.from_css("rgb(89, 148, 220)"),
    // conflicts_shadow: Color.from_css("rgba(255, 0, 5, 0.502)"),
    copper: {
      b: Color.from_css("rgb(77, 127, 196)"),
      f: Color.from_css("rgb(200, 52, 52)"),
      in1: Color.from_css("rgb(127, 200, 127)"),
      in10: Color.from_css("rgb(237, 124, 51)"),
      in11: Color.from_css("rgb(91, 195, 235)"),
      in12: Color.from_css("rgb(247, 111, 142)"),
      in13: Color.from_css("rgb(167, 165, 198)"),
      in14: Color.from_css("rgb(40, 204, 217)"),
      in15: Color.from_css("rgb(232, 178, 167)"),
      in16: Color.from_css("rgb(242, 237, 161)"),
      in17: Color.from_css("rgb(237, 124, 51)"),
      in18: Color.from_css("rgb(91, 195, 235)"),
      in19: Color.from_css("rgb(247, 111, 142)"),
      in2: Color.from_css("rgb(206, 125, 44)"),
      in20: Color.from_css("rgb(167, 165, 198)"),
      in21: Color.from_css("rgb(40, 204, 217)"),
      in22: Color.from_css("rgb(232, 178, 167)"),
      in23: Color.from_css("rgb(242, 237, 161)"),
      in24: Color.from_css("rgb(237, 124, 51)"),
      in25: Color.from_css("rgb(91, 195, 235)"),
      in26: Color.from_css("rgb(247, 111, 142)"),
      in27: Color.from_css("rgb(167, 165, 198)"),
      in28: Color.from_css("rgb(40, 204, 217)"),
      in29: Color.from_css("rgb(232, 178, 167)"),
      in3: Color.from_css("rgb(79, 203, 203)"),
      in30: Color.from_css("rgb(242, 237, 161)"),
      in4: Color.from_css("rgb(219, 98, 139)"),
      in5: Color.from_css("rgb(167, 165, 198)"),
      in6: Color.from_css("rgb(40, 204, 217)"),
      in7: Color.from_css("rgb(232, 178, 167)"),
      in8: Color.from_css("rgb(242, 237, 161)"),
      in9: Color.from_css("rgb(141, 203, 129)")
    },
    cursor: Color.from_css("rgb(255, 255, 255)"),
    drc_error: Color.from_css("rgba(215, 91, 107, 0.800)"),
    drc_exclusion: Color.from_css("rgba(255, 255, 255, 0.800)"),
    drc_warning: Color.from_css("rgba(255, 208, 66, 0.800)"),
    dwgs_user: Color.from_css("rgb(194, 194, 194)"),
    eco1_user: Color.from_css("rgb(180, 219, 210)"),
    eco2_user: Color.from_css("rgb(216, 200, 82)"),
    edge_cuts: Color.from_css("rgb(208, 210, 205)"),
    f_adhes: Color.from_css("rgb(132, 0, 132)"),
    f_crtyd: Color.from_css("rgb(255, 38, 226)"),
    f_fab: Color.from_css("rgb(175, 175, 175)"),
    f_mask: Color.from_css("rgba(216, 100, 255, 0.400)"),
    f_paste: Color.from_css("rgba(180, 160, 154, 0.902)"),
    f_silks: Color.from_css("rgb(242, 237, 161)"),
    footprint_text_invisible: Color.from_css("rgb(132, 132, 132)"),
    grid: Color.from_css("rgb(132, 132, 132)"),
    grid_axes: Color.from_css("rgb(194, 194, 194)"),
    // locked_shadow: Color.from_css("rgba(255, 38, 226, 0.502)"),
    margin: Color.from_css("rgb(255, 38, 226)"),
    no_connect: Color.from_css("rgb(0, 0, 132)"),
    pad_plated_hole: Color.from_css("rgb(194, 194, 0)"),
    pad_through_hole: Color.from_css("rgb(227, 183, 46)"),
    // page_limits: Color.from_css("rgb(132, 132, 132)"),
    non_plated_hole: Color.from_css("rgb(26, 196, 210)"),
    // plated_hole: Color.from_css("rgb(26, 196, 210)"),
    ratsnest: Color.from_css("rgba(245, 255, 213, 0.702)"),
    user_1: Color.from_css("rgb(194, 194, 194)"),
    user_2: Color.from_css("rgb(89, 148, 220)"),
    user_3: Color.from_css("rgb(180, 219, 210)"),
    user_4: Color.from_css("rgb(216, 200, 82)"),
    user_5: Color.from_css("rgb(194, 194, 194)"),
    user_6: Color.from_css("rgb(89, 148, 220)"),
    user_7: Color.from_css("rgb(180, 219, 210)"),
    user_8: Color.from_css("rgb(216, 200, 82)"),
    user_9: Color.from_css("rgb(232, 178, 167)"),
    via_blind_buried: Color.from_css("rgb(187, 151, 38)"),
    via_hole: Color.from_css("rgb(227, 183, 46)"),
    via_micro: Color.from_css("rgb(0, 132, 132)"),
    via_through: Color.from_css("rgb(236, 236, 236)"),
    worksheet: Color.from_css("rgb(200, 114, 171)")
  },
  schematic: {
    anchor: Color.from_css("rgb(0, 0, 255)"),
    aux_items: Color.from_css("rgb(0, 0, 0)"),
    background: Color.from_css("rgb(245, 244, 239)"),
    brightened: Color.from_css("rgb(255, 0, 255)"),
    bus: Color.from_css("rgb(0, 0, 132)"),
    bus_junction: Color.from_css("rgb(0, 0, 132)"),
    component_body: Color.from_css("rgb(255, 255, 194)"),
    component_outline: Color.from_css("rgb(132, 0, 0)"),
    cursor: Color.from_css("rgb(15, 15, 15)"),
    erc_error: Color.from_css("rgba(230, 9, 13, 0.800)"),
    // erc_exclusion: Color.from_css("rgba(94, 194, 194, 0.800)"),
    erc_warning: Color.from_css("rgba(209, 146, 0, 0.800)"),
    fields: Color.from_css("rgb(132, 0, 132)"),
    grid: Color.from_css("rgb(181, 181, 181)"),
    grid_axes: Color.from_css("rgb(0, 0, 132)"),
    hidden: Color.from_css("rgb(94, 194, 194)"),
    // hovered: Color.from_css("rgb(0, 0, 255)"),
    junction: Color.from_css("rgb(0, 150, 0)"),
    label_global: Color.from_css("rgb(132, 0, 0)"),
    label_hier: Color.from_css("rgb(114, 86, 0)"),
    label_local: Color.from_css("rgb(15, 15, 15)"),
    netclass_flag: Color.from_css("rgb(72, 72, 72)"),
    no_connect: Color.from_css("rgb(0, 0, 132)"),
    note: Color.from_css("rgb(0, 0, 194)"),
    // note_background: Color.from_css("rgba(0, 0, 0, 0.000)"),
    // page_limits: Color.from_css("rgb(181, 181, 181)"),
    pin: Color.from_css("rgb(132, 0, 0)"),
    pin_name: Color.from_css("rgb(0, 100, 100)"),
    pin_number: Color.from_css("rgb(169, 0, 0)"),
    // private_note: Color.from_css("rgb(72, 72, 255)"),
    reference: Color.from_css("rgb(0, 100, 100)"),
    rule_area: Color.from_css("rgb(255, 0, 0)"),
    shadow: Color.from_css("rgba(199, 235, 255, 0.800)"),
    sheet: Color.from_css("rgb(132, 0, 0)"),
    sheet_background: Color.from_css("rgba(255, 255, 255, 0.000)"),
    sheet_fields: Color.from_css("rgb(132, 0, 132)"),
    sheet_filename: Color.from_css("rgb(114, 86, 0)"),
    sheet_label: Color.from_css("rgb(0, 100, 100)"),
    sheet_name: Color.from_css("rgb(0, 100, 100)"),
    value: Color.from_css("rgb(0, 100, 100)"),
    wire: Color.from_css("rgb(0, 150, 0)"),
    worksheet: Color.from_css("rgb(132, 0, 0)")
  }
};
var kicad_default_default = theme2;

// kicanvas/themes/index.ts
var themes = [witch_hazel_default, kicad_default_default];
var themes_by_name = new Map(
  themes.map((v) => {
    return [v.name, v];
  })
);
var themes_default = {
  default: witch_hazel_default,
  by_name(name) {
    return themes_by_name.get(name) ?? this.default;
  },
  list() {
    return themes;
  }
};

// kicanvas/preferences.ts
var Preferences = class _Preferences extends EventTarget {
  constructor() {
    super(...arguments);
    this.storage = new LocalStorage("kc:prefs");
    this.theme = themes_default.default;
    this.alignControlsWithKiCad = true;
  }
  static {
    __name(this, "Preferences");
  }
  static {
    this.INSTANCE = new _Preferences();
  }
  save() {
    this.storage.set("theme", this.theme.name);
    this.storage.set("alignControlsWithKiCad", this.alignControlsWithKiCad);
    this.dispatchEvent(new PreferencesChangeEvent({ preferences: this }));
  }
  load() {
    this.theme = themes_default.by_name(
      this.storage.get("theme", themes_default.default.name)
    );
    this.alignControlsWithKiCad = this.storage.get(
      "alignControlsWithKiCad",
      false
    );
  }
};
Preferences.INSTANCE.load();
var PreferencesChangeEvent = class _PreferencesChangeEvent extends CustomEvent {
  static {
    __name(this, "PreferencesChangeEvent");
  }
  static {
    this.type = "kicanvas:preferences:change";
  }
  constructor(detail) {
    super(_PreferencesChangeEvent.type, {
      detail,
      composed: true,
      bubbles: true
    });
  }
};
function WithPreferences(Base) {
  return class WithPreferences extends Base {
    static {
      __name(this, "WithPreferences");
    }
    constructor(...args) {
      super(...args);
      this.addDisposable(
        listen(
          Preferences.INSTANCE,
          PreferencesChangeEvent.type,
          () => {
            this.preferenceChangeCallback(this.preferences);
          }
        )
      );
    }
    get preferences() {
      return Preferences.INSTANCE;
    }
    async preferenceChangeCallback(preferences) {
    }
  };
}
__name(WithPreferences, "WithPreferences");

// base/dom/pan-and-zoom.ts
var line_delta_multiplier = 8;
var page_delta_multiplier = 24;
var zoom_speed = 5e-3;
var pan_speed = 1;
var prefs = Preferences.INSTANCE;
var PanAndZoom = class {
  /**
   * Create an interactive pan and zoom helper
   * @param {HTMLElement} target - the element to attach to and listen for mouse events
   * @param {Camera2} camera - the camera that will be updated when panning and zooming
   * @param {*} callback - optional callback when pan and zoom happens
   * @param {number} min_zoom
   * @param {number} max_zoom
   */
  constructor(target, camera, callback, min_zoom = 0.5, max_zoom = 10, bounds) {
    this.target = target;
    this.camera = camera;
    this.callback = callback;
    this.min_zoom = min_zoom;
    this.max_zoom = max_zoom;
    this.bounds = bounds;
    this.target.addEventListener(
      "wheel",
      (e) => this.#on_wheel(e),
      { passive: false }
    );
    let startDistance = null;
    let startPosition = null;
    this.target.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        startDistance = this.#getDistanceBetweenTouches(e.touches);
      } else if (e.touches.length === 1) {
        startPosition = e.touches;
      }
    });
    this.target.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        if (startDistance !== null) {
          const currentDistance = this.#getDistanceBetweenTouches(
            e.touches
          );
          if (Math.abs(startDistance - currentDistance) < 10) {
            const scale = currentDistance / startDistance * 4;
            if (startDistance < currentDistance) {
              this.#handle_zoom(scale * -1);
            } else {
              this.#handle_zoom(scale);
            }
          }
          startDistance = currentDistance;
        }
      } else if (e.touches.length === 1 && startPosition !== null) {
        const sx = startPosition[0]?.clientX ?? 0;
        const sy = startPosition[0]?.clientY ?? 0;
        const ex = e.touches[0]?.clientX ?? 0;
        const ey = e.touches[0]?.clientY ?? 0;
        if (Math.abs(sx - ex) < 100 && Math.abs(sy - ey) < 100) {
          this.#handle_pan(sx - ex, sy - ey);
        }
        startPosition = e.touches;
      }
    });
    this.target.addEventListener("touchend", () => {
      startDistance = null;
      startPosition = null;
    });
    let dragStartPosition = null;
    let dragging = false;
    this.target.addEventListener("mousedown", (e) => {
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        dragging = true;
        dragStartPosition = new Vec2(e.clientX, e.clientY);
      }
    });
    this.target.addEventListener("mousemove", (e) => {
      if (dragging && dragStartPosition !== null) {
        const currentPosition = new Vec2(e.clientX, e.clientY);
        const delta = currentPosition.sub(dragStartPosition);
        this.#handle_pan(-delta.x, -delta.y);
        dragStartPosition = currentPosition;
      }
    });
    this.target.addEventListener("mouseup", (e) => {
      if (e.button === 1 || e.button === 2) {
        dragging = false;
        dragStartPosition = null;
      }
    });
    this.target.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }
  static {
    __name(this, "PanAndZoom");
  }
  #rect;
  #getDistanceBetweenTouches(touches) {
    if (touches[0] && touches[1]) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    return 0;
  }
  #on_wheel(e) {
    e.preventDefault();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (!prefs.alignControlsWithKiCad) {
      if (dx == 0 && e.shiftKey) {
        [dx, dy] = [dy, dx];
      }
    } else {
      if (dx == 0 && e.ctrlKey) {
        [dx, dy] = [dy, dx];
      }
    }
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      dx *= line_delta_multiplier;
      dy *= line_delta_multiplier;
    } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      dx *= page_delta_multiplier;
      dy *= page_delta_multiplier;
    }
    dx = Math.sign(dx) * Math.min(page_delta_multiplier, Math.abs(dx));
    dy = Math.sign(dy) * Math.min(page_delta_multiplier, Math.abs(dy));
    if (!prefs.alignControlsWithKiCad) {
      if (e.shiftKey) {
        this.#handle_pan(dx, dy);
      } else {
        this.#rect = this.target.getBoundingClientRect();
        this.#handle_zoom(dy, this.#relative_mouse_pos(e));
      }
    } else {
      if (e.shiftKey || e.ctrlKey) {
        this.#handle_pan(-dx, dy);
      } else {
        this.#rect = this.target.getBoundingClientRect();
        this.#handle_zoom(dy, this.#relative_mouse_pos(e));
      }
    }
    this.target.dispatchEvent(
      new MouseEvent("panzoom", {
        clientX: e.clientX,
        clientY: e.clientY
      })
    );
  }
  #relative_mouse_pos(e) {
    return new Vec2(
      e.clientX - this.#rect.left,
      e.clientY - this.#rect.top
    );
  }
  #handle_pan(dx, dy) {
    const delta = new Vec2(dx * pan_speed, dy * pan_speed).multiply(
      1 / this.camera.zoom
    );
    this.camera.translate(delta);
    if (this.callback) {
      this.callback();
    }
  }
  #handle_zoom(delta, mouse) {
    const mouse_world = mouse != null ? this.camera.screen_to_world(mouse) : null;
    this.camera.zoom *= Math.exp(delta * -zoom_speed);
    this.camera.zoom = Math.min(
      this.max_zoom,
      Math.max(this.camera.zoom, this.min_zoom)
    );
    if (mouse != null && mouse_world != null) {
      const new_world = this.camera.screen_to_world(mouse);
      const center_delta = mouse_world.sub(new_world);
      this.camera.translate(center_delta);
    }
    if (this.callback) {
      this.callback();
    }
  }
};

// base/dom/size-observer.ts
var SizeObserver = class {
  constructor(target, callback) {
    this.target = target;
    this.callback = callback;
    this.#observer = new ResizeObserver(() => {
      this.callback(this.target);
    });
    this.#observer.observe(target);
  }
  static {
    __name(this, "SizeObserver");
  }
  #observer;
  dispose() {
    this.#observer?.disconnect();
    this.#observer = void 0;
  }
};

// viewers/base/viewport.ts
var Viewport = class {
  /**
   * Create a Scene
   * @param callback - a callback used to redraw the viewport when it changes.
   */
  constructor(renderer, callback) {
    this.renderer = renderer;
    this.callback = callback;
    this.ready = new Barrier();
    this.camera = new Camera2(
      new Vec2(0, 0),
      new Vec2(0, 0),
      1,
      new Angle(0)
    );
    this.#observer = new SizeObserver(this.renderer.canvas, () => {
      this.#update_camera();
      this.callback();
    });
    this.#update_camera();
  }
  static {
    __name(this, "Viewport");
  }
  #observer;
  #pan_and_zoom;
  dispose() {
    this.#observer.dispose();
  }
  /**
   * Update the camera with the new canvas size.
   */
  #update_camera() {
    const canvas = this.renderer.canvas;
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0 && (this.width != canvas.clientWidth || this.height != canvas.clientHeight)) {
      this.width = canvas.clientWidth;
      this.height = canvas.clientHeight;
      this.camera.viewport_size = new Vec2(this.width, this.height);
      if (this.width && this.height) {
        this.ready.open();
      }
    }
  }
  enable_pan_and_zoom(min_zoom, max_zoom) {
    this.#pan_and_zoom = new PanAndZoom(
      this.renderer.canvas,
      this.camera,
      () => {
        this.callback();
      },
      min_zoom,
      max_zoom
    );
  }
  /**
   * The matrix representing this viewport. This can be passed into rendering
   * methods to display things at the right spot.
   */
  get view_matrix() {
    return this.camera.matrix;
  }
  /**
   * Limit the camera's center within the given bounds.
   */
  set bounds(bb) {
    if (this.#pan_and_zoom) {
      this.#pan_and_zoom.bounds = bb;
    }
  }
};

// viewers/base/viewer.ts
var Viewer = class extends EventTarget {
  constructor(canvas, interactive = true) {
    super();
    this.canvas = canvas;
    this.interactive = interactive;
    this.mouse_position = new Vec2(0, 0);
    this.loaded = new Barrier();
    this.disposables = new Disposables();
    this.setup_finished = new Barrier();
  }
  static {
    __name(this, "Viewer");
  }
  #selected;
  dispose() {
    this.disposables.dispose();
  }
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    return {
      dispose: /* @__PURE__ */ __name(() => {
        this.removeEventListener(type, listener, options);
      }, "dispose")
    };
  }
  async setup() {
    this.renderer = this.disposables.add(this.create_renderer(this.canvas));
    await this.renderer.setup();
    this.viewport = this.disposables.add(
      new Viewport(this.renderer, () => {
        this.on_viewport_change();
      })
    );
    if (this.interactive) {
      this.viewport.enable_pan_and_zoom(0.5, 190);
      this.disposables.add(
        listen(this.canvas, "mousemove", (e) => {
          this.on_mouse_change(e);
        })
      );
      this.disposables.add(
        listen(this.canvas, "panzoom", (e) => {
          this.on_mouse_change(e);
        })
      );
      this.disposables.add(
        listen(this.canvas, "click", (e) => {
          const items = this.layers.query_point(this.mouse_position);
          this.on_pick(this.mouse_position, items);
        })
      );
    }
    this.setup_finished.open();
  }
  on_viewport_change() {
    if (this.interactive) {
      this.draw();
    }
  }
  on_mouse_change(e) {
    const rect = this.canvas.getBoundingClientRect();
    const new_position = this.viewport.camera.screen_to_world(
      new Vec2(e.clientX - rect.left, e.clientY - rect.top)
    );
    if (this.mouse_position.x != new_position.x || this.mouse_position.y != new_position.y) {
      this.mouse_position.set(new_position);
      this.dispatchEvent(new KiCanvasMouseMoveEvent(this.mouse_position));
    }
  }
  resolve_loaded(value) {
    if (value) {
      this.loaded.open();
      this.dispatchEvent(new KiCanvasLoadEvent());
    }
  }
  on_draw() {
    this.renderer.clear_canvas();
    if (!this.layers) {
      return;
    }
    let depth = 0.01;
    const camera = this.viewport.camera.matrix;
    const should_dim = this.layers.is_any_layer_highlighted();
    for (const layer of this.layers.in_display_order()) {
      if (layer.visible && layer.graphics) {
        let alpha = layer.opacity;
        if (should_dim && !layer.highlighted) {
          alpha = 0.25;
        }
        layer.graphics.render(camera, depth, alpha);
        depth += 0.01;
      }
    }
  }
  draw() {
    if (!this.viewport) {
      return;
    }
    window.requestAnimationFrame(() => {
      this.on_draw();
    });
  }
  on_pick(mouse, items) {
    let selected = null;
    for (const { bbox } of items) {
      selected = bbox;
      break;
    }
    this.select(selected);
  }
  select(item) {
    this.selected = item;
  }
  get selected() {
    return this.#selected;
  }
  set selected(bb) {
    this._set_selected(bb);
  }
  _set_selected(bb) {
    const previous = this.#selected;
    this.#selected = bb?.copy() || null;
    this.dispatchEvent(
      new KiCanvasSelectEvent({
        item: this.#selected?.context,
        previous: previous?.context
      })
    );
    later(() => this.paint_selected());
  }
  get selection_color() {
    return Color.white;
  }
  paint_selected() {
    const layer = this.layers.overlay;
    layer.clear();
    if (this.#selected) {
      const bb = this.#selected.copy().grow(this.#selected.w * 0.1);
      this.renderer.start_layer(layer.name);
      this.renderer.line(
        Polyline2.from_BBox(bb, 0.254, this.selection_color)
      );
      this.renderer.polygon(Polygon2.from_BBox(bb, this.selection_color));
      layer.graphics = this.renderer.end_layer();
      layer.graphics.composite_operation = "overlay";
    }
    this.draw();
  }
  zoom_to_selection() {
    if (!this.selected) {
      return;
    }
    this.viewport.camera.bbox = this.selected.grow(10);
    this.draw();
  }
  flip_view() {
    const flip = !this.viewport.camera.flipped;
    this.viewport.camera.flipped = flip;
    for (const layer of this.layers.in_order()) {
      if (layer.graphics) {
        layer.graphics.renderer.state.flipped = flip;
      }
    }
    this.paint();
    this.draw();
  }
};
__decorateClass([
  no_self_recursion
], Viewer.prototype, "_set_selected", 1);

// viewers/base/document-viewer.ts
var log4 = new Logger("kicanvas:viewer");
var DocumentViewer = class extends Viewer {
  static {
    __name(this, "DocumentViewer");
  }
  constructor(canvas, interactive, theme3) {
    super(canvas, interactive);
    this.theme = theme3;
  }
  get grid_origin() {
    return new Vec2(0, 0);
  }
  async load(src) {
    await this.setup_finished;
    if (this.document == src) {
      return;
    }
    log4.info(`Loading ${src.filename} into viewer`);
    this.document = src;
    this.paint();
    later(async () => {
      log4.info("Waiting for viewport");
      await this.viewport.ready;
      this.viewport.bounds = this.drawing_sheet.page_bbox.grow(50);
      log4.info("Positioning camera");
      this.zoom_to_page();
      this.resolve_loaded(true);
      if (this.selected) {
        this.selected = null;
      }
      this.draw();
    });
  }
  paint() {
    if (!this.document) {
      return;
    }
    this.renderer.background_color = this.theme.background;
    log4.info("Loading drawing sheet");
    if (!this.drawing_sheet) {
      this.drawing_sheet = DrawingSheet.default();
    }
    this.drawing_sheet.document = this.document;
    log4.info("Creating layers");
    this.disposables.disposeAndRemove(this.layers);
    this.layers = this.disposables.add(this.create_layer_set());
    log4.info("Painting items");
    this.painter = this.create_painter();
    this.painter.paint(this.document);
    log4.info("Painting drawing sheet");
    new DrawingSheetPainter(this.renderer, this.layers, this.theme).paint(
      this.drawing_sheet
    );
    log4.info("Painting grid");
    this.grid = new Grid(
      this.renderer,
      this.viewport.camera,
      this.layers.by_name(":Grid" /* grid */),
      this.grid_origin,
      this.theme.grid,
      this.theme.grid_axes
    );
  }
  zoom_to_page() {
    this.viewport.camera.bbox = this.drawing_sheet.page_bbox.grow(10);
    this.draw();
  }
  draw() {
    if (!this.viewport) {
      return;
    }
    this.grid?.update();
    super.draw();
  }
  select(item) {
    if (item != null && !(item instanceof BBox)) {
      throw new Error(
        `Unable to select item ${item}, could not find an object that matched.`
      );
    }
    this.selected = item ?? null;
  }
};

// viewers/board/layers.ts
var LayerNames = ((LayerNames3) => {
  LayerNames3["dwgs_user"] = "Dwgs.User";
  LayerNames3["cmts_user"] = "Cmts.User";
  LayerNames3["eco1_user"] = "Eco1.User";
  LayerNames3["eco2_user"] = "Eco2.User";
  LayerNames3["edge_cuts"] = "Edge.Cuts";
  LayerNames3["margin"] = "Margin";
  LayerNames3["user_1"] = "User.1";
  LayerNames3["user_2"] = "User.2";
  LayerNames3["user_3"] = "User.3";
  LayerNames3["user_4"] = "User.4";
  LayerNames3["user_5"] = "User.5";
  LayerNames3["user_6"] = "User.6";
  LayerNames3["user_7"] = "User.7";
  LayerNames3["user_8"] = "User.8";
  LayerNames3["user_9"] = "User.9";
  LayerNames3["anchors"] = ":Anchors";
  LayerNames3["non_plated_holes"] = ":NonPlatedHoles";
  LayerNames3["via_holes"] = ":Via:Holes";
  LayerNames3["pad_holes_netname"] = ":Pad:Holes:NetName";
  LayerNames3["pad_holes"] = ":Pad:Holes";
  LayerNames3["pad_holewalls"] = ":Pad:HoleWalls";
  LayerNames3["via_holewalls"] = ":Via:HoleWalls";
  LayerNames3["pads_front_netname"] = ":Pads:Front:NetName";
  LayerNames3["pads_front"] = ":Pads:Front";
  LayerNames3["f_cu"] = "F.Cu";
  LayerNames3["f_mask"] = "F.Mask";
  LayerNames3["f_silks"] = "F.SilkS";
  LayerNames3["f_adhes"] = "F.Adhes";
  LayerNames3["f_paste"] = "F.Paste";
  LayerNames3["f_crtyd"] = "F.CrtYd";
  LayerNames3["f_fab"] = "F.Fab";
  LayerNames3["in1_cu"] = "In1.Cu";
  LayerNames3["in2_cu"] = "In2.Cu";
  LayerNames3["in3_cu"] = "In3.Cu";
  LayerNames3["in4_cu"] = "In4.Cu";
  LayerNames3["in5_cu"] = "In5.Cu";
  LayerNames3["in6_cu"] = "In6.Cu";
  LayerNames3["in7_cu"] = "In7.Cu";
  LayerNames3["in8_cu"] = "In8.Cu";
  LayerNames3["in9_cu"] = "In9.Cu";
  LayerNames3["in10_cu"] = "In10.Cu";
  LayerNames3["in11_cu"] = "In11.Cu";
  LayerNames3["in12_cu"] = "In12.Cu";
  LayerNames3["in13_cu"] = "In13.Cu";
  LayerNames3["in14_cu"] = "In14.Cu";
  LayerNames3["in15_cu"] = "In15.Cu";
  LayerNames3["in16_cu"] = "In16.Cu";
  LayerNames3["in17_cu"] = "In17.Cu";
  LayerNames3["in18_cu"] = "In18.Cu";
  LayerNames3["in19_cu"] = "In19.Cu";
  LayerNames3["in20_cu"] = "In20.Cu";
  LayerNames3["in21_cu"] = "In21.Cu";
  LayerNames3["in22_cu"] = "In22.Cu";
  LayerNames3["in23_cu"] = "In23.Cu";
  LayerNames3["in24_cu"] = "In24.Cu";
  LayerNames3["in25_cu"] = "In25.Cu";
  LayerNames3["in26_cu"] = "In26.Cu";
  LayerNames3["in27_cu"] = "In27.Cu";
  LayerNames3["in28_cu"] = "In28.Cu";
  LayerNames3["in29_cu"] = "In29.Cu";
  LayerNames3["in30_cu"] = "In30.Cu";
  LayerNames3["pads_back_netname"] = ":Pads:Back:NetName";
  LayerNames3["pads_back"] = ":Pads:Back";
  LayerNames3["b_cu"] = "B.Cu";
  LayerNames3["b_mask"] = "B.Mask";
  LayerNames3["b_silks"] = "B.SilkS";
  LayerNames3["b_adhes"] = "B.Adhes";
  LayerNames3["b_paste"] = "B.Paste";
  LayerNames3["b_crtyd"] = "B.CrtYd";
  LayerNames3["b_fab"] = "B.Fab";
  LayerNames3[LayerNames3["drawing_sheet"] = ":DrawingSheet" /* drawing_sheet */] = "drawing_sheet";
  LayerNames3[LayerNames3["grid"] = ":Grid" /* grid */] = "grid";
  return LayerNames3;
})(LayerNames || {});
var HoleLayerNames = [
  ":NonPlatedHoles" /* non_plated_holes */,
  ":Via:Holes" /* via_holes */,
  ":Pad:Holes" /* pad_holes */,
  ":Pad:HoleWalls" /* pad_holewalls */,
  ":Via:HoleWalls" /* via_holewalls */
];
var CopperLayerNames = [
  "F.Cu" /* f_cu */,
  "In1.Cu" /* in1_cu */,
  "In2.Cu" /* in2_cu */,
  "In3.Cu" /* in3_cu */,
  "In4.Cu" /* in4_cu */,
  "In5.Cu" /* in5_cu */,
  "In6.Cu" /* in6_cu */,
  "In7.Cu" /* in7_cu */,
  "In8.Cu" /* in8_cu */,
  "In9.Cu" /* in9_cu */,
  "In10.Cu" /* in10_cu */,
  "In11.Cu" /* in11_cu */,
  "In12.Cu" /* in12_cu */,
  "In13.Cu" /* in13_cu */,
  "In14.Cu" /* in14_cu */,
  "In15.Cu" /* in15_cu */,
  "In16.Cu" /* in16_cu */,
  "In17.Cu" /* in17_cu */,
  "In18.Cu" /* in18_cu */,
  "In19.Cu" /* in19_cu */,
  "In20.Cu" /* in20_cu */,
  "In21.Cu" /* in21_cu */,
  "In22.Cu" /* in22_cu */,
  "In23.Cu" /* in23_cu */,
  "In24.Cu" /* in24_cu */,
  "In25.Cu" /* in25_cu */,
  "In26.Cu" /* in26_cu */,
  "In27.Cu" /* in27_cu */,
  "In28.Cu" /* in28_cu */,
  "In29.Cu" /* in29_cu */,
  "In30.Cu" /* in30_cu */,
  "B.Cu" /* b_cu */
];
function virtual_layer_for(physical_layer, virtual_name) {
  return `:${physical_layer}:${virtual_name}`;
}
__name(virtual_layer_for, "virtual_layer_for");
function is_virtual(name) {
  return name.startsWith(":");
}
__name(is_virtual, "is_virtual");
function is_virtual_for(physical_layer, layer_name) {
  return is_virtual(layer_name) && layer_name.startsWith(`:${physical_layer}:`);
}
__name(is_virtual_for, "is_virtual_for");
function is_pad_layer_for(physical_layer, layer_name) {
  let pad_layer_prefix = ":invaild";
  if (physical_layer === "F.Cu" /* f_cu */) {
    pad_layer_prefix = ":Pads:Front";
  } else if (physical_layer === "B.Cu" /* b_cu */) {
    pad_layer_prefix = ":Pads:Back";
  }
  const is_thru_hole = layer_name === ":Pad:Holes:NetName" /* pad_holes_netname */ || layer_name === ":Pad:Holes" /* pad_holes */ || layer_name === ":NonPlatedHoles" /* non_plated_holes */;
  const is_pad_copper = layer_name.startsWith(pad_layer_prefix);
  const is_pad_thru_hole = is_thru_hole && is_copper(physical_layer);
  return is_pad_copper || is_pad_thru_hole;
}
__name(is_pad_layer_for, "is_pad_layer_for");
function is_copper(name) {
  return name.endsWith(".Cu");
}
__name(is_copper, "is_copper");
function is_manufacturing_layer(name) {
  return name === "Edge.Cuts" /* edge_cuts */ || name === "Margin" /* margin */ || name.startsWith("F.") || name.startsWith("B.") || name.endsWith(".Cu");
}
__name(is_manufacturing_layer, "is_manufacturing_layer");
function* copper_layers_between(start_layer_name, end_layer_name) {
  let found_start = false;
  for (const layer_name of CopperLayerNames) {
    if (layer_name == start_layer_name) {
      found_start = true;
    }
    if (found_start) {
      yield layer_name;
    }
    if (layer_name == end_layer_name) {
      return;
    }
  }
}
__name(copper_layers_between, "copper_layers_between");
var LayerSet = class extends ViewLayerSet {
  /**
   * Create a new LayerSet
   */
  constructor(board, theme3) {
    super();
    this.theme = theme3;
    const board_layers = /* @__PURE__ */ new Map();
    for (const l of board.layers) {
      board_layers.set(l.canonical_name, l);
    }
    for (const layer_name of Object.values(LayerNames)) {
      if (!is_virtual(layer_name) && !board_layers.has(layer_name)) {
        continue;
      }
      let visible = true;
      let interactive = false;
      if (HoleLayerNames.includes(layer_name)) {
        visible = /* @__PURE__ */ __name(() => this.is_any_copper_layer_visible(), "visible");
        interactive = true;
      }
      if (layer_name == ":Pads:Front" /* pads_front */ || layer_name == ":Pads:Front:NetName" /* pads_front_netname */) {
        visible = /* @__PURE__ */ __name(() => this.by_name("F.Cu" /* f_cu */).visible, "visible");
        interactive = true;
      }
      if (layer_name == ":Pads:Back" /* pads_back */ || layer_name == ":Pads:Back:NetName" /* pads_back_netname */) {
        visible = /* @__PURE__ */ __name(() => this.by_name("B.Cu" /* b_cu */).visible, "visible");
        interactive = true;
      }
      if (layer_name == ":Pad:Holes:NetName" /* pad_holes_netname */) {
        visible = /* @__PURE__ */ __name(() => this.by_name(":Pad:Holes" /* pad_holes */).visible, "visible");
        interactive = true;
      }
      if (is_copper(layer_name)) {
        interactive = true;
        this.add(
          new ViewLayer(
            this,
            virtual_layer_for(
              layer_name,
              "BBViaHoles" /* bb_via_holes */
            ),
            () => this.by_name(layer_name).visible,
            false,
            this.color_for(":Via:Holes" /* via_holes */)
          )
        );
        this.add(
          new ViewLayer(
            this,
            virtual_layer_for(
              layer_name,
              "BBViaHoleWalls" /* bb_via_hole_walls */
            ),
            () => this.by_name(layer_name).visible,
            false,
            this.color_for(":Via:HoleWalls" /* via_holewalls */)
          )
        );
        this.add(
          new ViewLayer(
            this,
            virtual_layer_for(
              layer_name,
              "Zones" /* zones */
            ),
            () => this.by_name(layer_name).visible,
            false,
            this.color_for(layer_name)
          )
        );
      }
      this.add(
        new ViewLayer(
          this,
          layer_name,
          visible,
          interactive,
          this.color_for(layer_name)
        )
      );
    }
  }
  static {
    __name(this, "LayerSet");
  }
  /**
   * Get the theme color for a given layer.
   */
  color_for(layer_name) {
    switch (layer_name) {
      case LayerNames.drawing_sheet:
        return this.theme["worksheet"] ?? Color.white;
      case ":Pads:Front" /* pads_front */:
        return this.theme["copper"]?.["f"] ?? Color.white;
      case ":Pads:Back" /* pads_back */:
        return this.theme["copper"]?.["b"] ?? Color.white;
      case ":NonPlatedHoles" /* non_plated_holes */:
        return this.theme["non_plated_hole"] ?? Color.white;
      case ":Via:Holes" /* via_holes */:
        return this.theme["via_hole"] ?? Color.white;
      case ":Via:HoleWalls" /* via_holewalls */:
        return this.theme["via_through"] ?? Color.white;
      case ":Pad:Holes" /* pad_holes */:
        return this.theme["background"] ?? Color.white;
      case ":Pad:HoleWalls" /* pad_holewalls */:
        return this.theme["pad_through_hole"] ?? Color.white;
      case ":Pads:Front:NetName" /* pads_front_netname */:
        return Color.white.with_alpha(0.8);
      case ":Pads:Back:NetName" /* pads_back_netname */:
        return Color.white.with_alpha(0.8);
      case ":Pad:Holes:NetName" /* pad_holes_netname */:
        return Color.white.with_alpha(0.8);
    }
    let name = layer_name;
    name = name.replace(":Zones:", "").replace(".", "_").toLowerCase();
    if (name.endsWith("_cu")) {
      name = name.replace("_cu", "");
      const copper_theme = this.theme.copper;
      return copper_theme[name] ?? Color.white;
    }
    return this.theme[name] ?? Color.white;
  }
  /**
   * @yields layers that correspond to board layers that should be
   *      displayed in the layer selection UI
   */
  *in_ui_order() {
    const order = [
      ...CopperLayerNames,
      "F.Adhes" /* f_adhes */,
      "B.Adhes" /* b_adhes */,
      "F.Paste" /* f_paste */,
      "B.Paste" /* b_paste */,
      "F.SilkS" /* f_silks */,
      "B.SilkS" /* b_silks */,
      "F.Mask" /* f_mask */,
      "B.Mask" /* b_mask */,
      "Dwgs.User" /* dwgs_user */,
      "Cmts.User" /* cmts_user */,
      "Eco1.User" /* eco1_user */,
      "Eco2.User" /* eco2_user */,
      "Edge.Cuts" /* edge_cuts */,
      "Margin" /* margin */,
      "F.CrtYd" /* f_crtyd */,
      "B.CrtYd" /* b_crtyd */,
      "F.Fab" /* f_fab */,
      "B.Fab" /* b_fab */,
      "User.1" /* user_1 */,
      "User.2" /* user_2 */,
      "User.3" /* user_3 */,
      "User.4" /* user_4 */,
      "User.5" /* user_5 */,
      "User.6" /* user_6 */,
      "User.7" /* user_7 */,
      "User.8" /* user_8 */,
      "User.9" /* user_9 */
    ];
    for (const name of order) {
      const layer = this.by_name(name);
      if (layer) {
        yield layer;
      }
    }
  }
  *copper_layers() {
    for (const name of CopperLayerNames) {
      const layer = this.by_name(name);
      if (layer) {
        yield layer;
      }
    }
  }
  *via_layers() {
    yield this.by_name(":Via:Holes" /* via_holes */);
    yield this.by_name(":Via:HoleWalls" /* via_holewalls */);
    for (const copper_name of CopperLayerNames) {
      for (const virtual_name of [
        "BBViaHoleWalls" /* bb_via_hole_walls */,
        "BBViaHoles" /* bb_via_holes */
      ]) {
        const layer = this.by_name(
          virtual_layer_for(copper_name, virtual_name)
        );
        if (layer) {
          yield layer;
        }
      }
    }
  }
  *zone_layers() {
    for (const copper_name of CopperLayerNames) {
      const zones_name = virtual_layer_for(
        copper_name,
        "Zones" /* zones */
      );
      const layer = this.by_name(zones_name);
      if (layer) {
        yield layer;
      }
    }
  }
  *pad_layers() {
    yield this.by_name(":Pads:Front:NetName" /* pads_front_netname */);
    yield this.by_name(":Pads:Front" /* pads_front */);
    yield this.by_name(":Pads:Back:NetName" /* pads_back_netname */);
    yield this.by_name(":Pads:Back" /* pads_back */);
  }
  *pad_hole_layers() {
    yield this.by_name(":Pad:Holes" /* pad_holes */);
    yield this.by_name(":Pad:Holes:NetName" /* pad_holes_netname */);
    yield this.by_name(":Pad:HoleWalls" /* pad_holewalls */);
  }
  /**
   * @returns true if any copper layer is enabled and visible.
   */
  is_any_copper_layer_visible() {
    for (const layer of this.copper_layers()) {
      if (layer.visible) {
        return true;
      }
    }
    return false;
  }
  /**
   * Highlights the given layer.
   *
   * The board viewer has to make sure to also highlight associated virtual
   * layers when a physical layer is highlighted
   */
  highlight(layer) {
    let layer_name = "";
    if (layer instanceof ViewLayer) {
      layer_name = layer.name;
    } else if (is_string(layer)) {
      layer_name = layer;
    }
    const matching_layers = this.query(
      (l) => l.name == layer_name || is_virtual_for(layer_name, l.name) || is_pad_layer_for(layer_name, l.name)
    );
    super.highlight(matching_layers);
  }
};

// viewers/board/painter.ts
var BoardItemPainter = class extends ItemPainter {
  static {
    __name(this, "BoardItemPainter");
  }
  get theme() {
    return this.view_painter.theme;
  }
  /** Alias for BoardPainter.filter_net */
  get filter_net() {
    return this.view_painter.filter_net;
  }
  isFillValid(fill) {
    return Boolean(fill && fill !== "none" && fill !== "no");
  }
};
var GraphicItemPainter = class extends BoardItemPainter {
  static {
    __name(this, "GraphicItemPainter");
  }
  styled_line(lines, width, color, stroke_style) {
    const draw_line = /* @__PURE__ */ __name((lines2) => {
      this.gfx.line(lines2, width, color);
    }, "draw_line");
    StrokePainter.line(lines, width, stroke_style, draw_line);
  }
};
var NetNameItemPainter = class extends BoardItemPainter {
  static {
    __name(this, "NetNameItemPainter");
  }
  // Drawing the netname on `center` in region `region`
  draw_net_name(net_name, center, text_width, max_font_size, color) {
    const text_attr = new TextAttributes();
    const text_center = center.copy().multiply(1e4);
    const stroke_width = text_width / Math.max(net_name.length, 3);
    const netname_font_size = Math.min(max_font_size, stroke_width) * 1e4 * 0.95;
    text_attr.color = color;
    text_attr.bold = true;
    text_attr.size = new Vec2(netname_font_size, netname_font_size);
    text_attr.stroke_width = netname_font_size / 8;
    text_attr.mirrored = this.gfx.state.flipped;
    StrokeFont.default().draw(this.gfx, net_name, text_center, text_attr);
  }
  // Get displayed netname, e.g. "Sheet/Name" -> "Name"
  static displayed_netname(netname) {
    if (!netname) return void 0;
    const level_names = netname.split("/");
    return level_names.slice(-1)[0];
  }
};
var LinePainter2 = class extends GraphicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [GrLine, FpLine];
  }
  static {
    __name(this, "LinePainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, s) {
    if (this.filter_net) return;
    const points = [s.start, s.end];
    this.styled_line(points, s.width, layer.color, s.stroke_params);
  }
};
var RectPainter2 = class extends GraphicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [GrRect, FpRect];
  }
  static {
    __name(this, "RectPainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, r) {
    if (this.filter_net) return;
    const color = layer.color;
    const points = [
      r.start,
      new Vec2(r.end.x, r.start.y),
      r.end,
      new Vec2(r.start.x, r.end.y),
      r.start
    ];
    this.styled_line(points, r.width, color, r.stroke_params);
    if (this.isFillValid(r.fill)) {
      this.gfx.polygon(new Polygon2(points, color));
    }
  }
};
var PolyPainter = class extends GraphicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Poly, GrPoly, FpPoly];
  }
  static {
    __name(this, "PolyPainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, p) {
    if (this.filter_net) return;
    const color = layer.color;
    if (p.width) {
      this.styled_line(
        [...p.polyline, p.polyline[0]],
        p.width,
        color,
        p.stroke_params
      );
    }
    if (this.isFillValid(p.fill)) {
      this.gfx.polygon(new Polygon2(p.polyline, color));
    }
  }
};
var ArcPainter = class extends GraphicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [GrArc, FpArc];
  }
  static {
    __name(this, "ArcPainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, a) {
    if (this.filter_net) return;
    const arc = a.arc;
    const points = arc.to_polyline();
    this.gfx.line(new Polyline2(points, arc.width, layer.color));
  }
};
var CirclePainter = class extends GraphicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [GrCircle, FpCircle];
  }
  static {
    __name(this, "CirclePainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, c) {
    if (this.filter_net) return;
    const color = layer.color;
    const radius = c.center.sub(c.end).magnitude;
    const arc = new Arc(
      c.center,
      radius,
      new Angle(0),
      new Angle(2 * Math.PI),
      c.width
    );
    if (this.isFillValid(c.fill)) {
      this.gfx.circle(
        new Circle3(arc.center, arc.radius + (c.width ?? 0), color)
      );
    } else {
      const points = arc.to_polyline();
      this.gfx.line(new Polyline2(points, arc.width, color));
    }
  }
};
var TraceSegmentPainter = class extends NetNameItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [LineSegment];
  }
  static {
    __name(this, "TraceSegmentPainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, s) {
    if (this.filter_net && s.net != this.filter_net) {
      return;
    }
    const points = [s.start, s.end];
    this.gfx.line(new Polyline2(points, s.width, layer.color));
  }
};
var TraceArcPainter = class extends NetNameItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [ArcSegment];
  }
  static {
    __name(this, "TraceArcPainter");
  }
  layers_for(item) {
    return [item.layer];
  }
  paint(layer, a) {
    if (this.filter_net && a.net != this.filter_net) {
      return;
    }
    const arc = Arc.from_three_points(a.start, a.mid, a.end, a.width);
    const points = arc.to_polyline();
    this.gfx.line(new Polyline2(points, arc.width, layer.color));
  }
};
var ViaPainter = class extends NetNameItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Via];
  }
  static {
    __name(this, "ViaPainter");
  }
  layers_for(v) {
    if (v.layers) {
      const layers = [];
      for (const cu_layer of copper_layers_between(
        v.layers[0],
        v.layers[1]
      )) {
        layers.push(
          virtual_layer_for(
            cu_layer,
            "BBViaHoles" /* bb_via_holes */
          )
        );
        layers.push(
          virtual_layer_for(
            cu_layer,
            "BBViaHoleWalls" /* bb_via_hole_walls */
          )
        );
      }
      return layers;
    } else {
      return [":Via:Holes" /* via_holes */, ":Via:HoleWalls" /* via_holewalls */];
    }
  }
  paint(layer, v) {
    if (this.filter_net && v.net != this.filter_net) {
      return;
    }
    const color = layer.color;
    if (layer.name.endsWith("HoleWalls") || layer.name == ":Overlay" /* overlay */) {
      this.gfx.circle(new Circle3(v.at.position, v.size / 2, color));
    } else if (layer.name.endsWith("Holes")) {
      this.gfx.circle(new Circle3(v.at.position, v.drill / 2, color));
      if ((v.type == "blind" || v.type == "micro") && v.layers) {
        this.gfx.arc(
          v.at.position,
          v.size / 2 - v.size / 8,
          Angle.from_degrees(180 + 70),
          Angle.from_degrees(360 - 70),
          v.size / 4,
          layer.layer_set.by_name(v.layers[0])?.color ?? Color.transparent_black
        );
        this.gfx.arc(
          v.at.position,
          v.size / 2 - v.size / 8,
          Angle.from_degrees(70),
          Angle.from_degrees(180 - 70),
          v.size / 4,
          layer.layer_set.by_name(v.layers[1])?.color ?? Color.transparent_black
        );
      }
    }
  }
};
var ZonePainter = class extends BoardItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Zone];
  }
  static {
    __name(this, "ZonePainter");
  }
  layers_for(z) {
    const layers = z.layers ?? [z.layer];
    if (layers.length && layers[0] == "F&B.Cu") {
      layers.shift();
      layers.push("F.Cu", "B.Cu");
    }
    return layers.map((l) => {
      if (CopperLayerNames.includes(l)) {
        return virtual_layer_for(l, "Zones" /* zones */);
      } else {
        return l;
      }
    });
  }
  paint(layer, z) {
    if (!z.filled_polygons) {
      return;
    }
    if (this.filter_net && z.net != this.filter_net) {
      return;
    }
    for (const p of z.filled_polygons) {
      if (!layer.name.includes(p.layer) && layer.name != ":Overlay" /* overlay */) {
        continue;
      }
      this.gfx.polygon(new Polygon2(p.polyline, layer.color));
    }
  }
};
var PadPainter = class _PadPainter extends NetNameItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Pad];
  }
  static {
    __name(this, "PadPainter");
  }
  layers_for(pad) {
    const layers = [];
    for (const layer of pad.layers) {
      if (layer == "*.Cu") {
        layers.push(":Pads:Front" /* pads_front */);
        layers.push(":Pads:Back" /* pads_back */);
      } else if (layer == "F.Cu") {
        layers.push(":Pads:Front" /* pads_front */);
      } else if (layer == "B.Cu") {
        layers.push(":Pads:Back" /* pads_back */);
      } else if (layer == "*.Mask") {
        layers.push("F.Mask" /* f_mask */);
        layers.push("B.Mask" /* b_mask */);
      } else if (layer == "*.Paste") {
        layers.push("F.Paste" /* f_paste */);
        layers.push("B.Paste" /* b_paste */);
      } else {
        layers.push(layer);
      }
    }
    switch (pad.type) {
      case "thru_hole":
        layers.push(":Pad:HoleWalls" /* pad_holewalls */);
        layers.push(":Pad:Holes:NetName" /* pad_holes_netname */);
        layers.push(":Pad:Holes" /* pad_holes */);
        break;
      case "np_thru_hole":
        layers.push(":NonPlatedHoles" /* non_plated_holes */);
        break;
      case "smd":
        if (layers.includes(":Pads:Front" /* pads_front */)) {
          layers.push(":Pads:Front:NetName" /* pads_front_netname */);
        } else if (layers.includes(":Pads:Back" /* pads_back */)) {
          layers.push(":Pads:Back:NetName" /* pads_back_netname */);
        }
        break;
      case "connect":
        break;
      default:
        warn(`Unhandled pad type "${pad.type}"`);
        break;
    }
    return layers;
  }
  paint(layer, pad) {
    if (this.filter_net && pad.net?.number != this.filter_net) {
      return;
    }
    const color = layer.color;
    const position_mat = Matrix3.translation(
      pad.at.position.x,
      pad.at.position.y
    );
    position_mat.rotate_self(-Angle.deg_to_rad(pad.parent.at.rotation));
    position_mat.rotate_self(Angle.deg_to_rad(pad.at.rotation));
    this.gfx.state.push();
    this.gfx.state.multiply(position_mat);
    const center = new Vec2(0, 0);
    const is_hole_layer = layer.name == ":Pad:Holes" /* pad_holes */ || layer.name == ":NonPlatedHoles" /* non_plated_holes */;
    const is_netname_layer = layer.name == ":Pads:Front:NetName" /* pads_front_netname */ || layer.name == ":Pads:Back:NetName" /* pads_back_netname */ || layer.name == ":Pad:Holes:NetName" /* pad_holes_netname */;
    const net_name = _PadPainter.pad_netname(pad);
    if (is_netname_layer) {
      const pad_size = _PadPainter.get_pad_orth_size(pad);
      let max_width = pad_size.x;
      let max_font_size = pad_size.y;
      let text_rotated = -pad.parent.at.rotation;
      if (pad_size.x < pad_size.y * 0.95) {
        text_rotated += 90;
        max_width = pad_size.y;
        max_font_size = pad_size.x;
      }
      max_font_size = Math.min(max_font_size, 10);
      const pad_rotate = pad.at.rotation;
      while (pad_rotate + text_rotated > 90) {
        text_rotated -= 180;
      }
      while (pad_rotate + text_rotated <= -90) {
        text_rotated += 180;
      }
      let y_offset_pad_num = 0;
      let y_offset_pad_net = 0;
      if (net_name !== void 0 && pad.number !== "") {
        max_font_size = max_font_size / 3;
        y_offset_pad_net = max_font_size / 1.4;
        y_offset_pad_num = max_font_size / 1.7;
      }
      if (pad.drill?.offset) {
        this.gfx.state.matrix.translate_self(
          pad.drill.offset.x,
          pad.drill.offset.y
        );
      }
      const rotate_mat = Matrix3.rotation(Angle.deg_to_rad(text_rotated));
      this.gfx.state.multiply(rotate_mat);
      if (pad.number !== "") {
        this.draw_net_name(
          pad.number,
          new Vec2(0, -y_offset_pad_num),
          max_width,
          max_font_size,
          color
        );
      }
      if (net_name !== void 0) {
        this.draw_net_name(
          net_name,
          new Vec2(0, y_offset_pad_net),
          max_width,
          max_font_size,
          color
        );
      }
    } else if (is_hole_layer && pad.drill != null) {
      if (!pad.drill.oval) {
        const drill_pos = center;
        this.gfx.circle(
          new Circle3(drill_pos, pad.drill.diameter / 2, color)
        );
      } else {
        const half_size = new Vec2(
          pad.drill.diameter / 2,
          (pad.drill.width ?? 0) / 2
        );
        const half_width = Math.min(half_size.x, half_size.y);
        const half_len = new Vec2(
          half_size.x - half_width,
          half_size.y - half_width
        );
        const drill_pos = center.add(pad.drill.offset);
        const drill_start = drill_pos.sub(half_len);
        const drill_end = drill_pos.add(half_len);
        this.gfx.line(
          new Polyline2(
            [drill_start, drill_end],
            half_width * 2,
            color
          )
        );
      }
    } else {
      let shape = pad.shape;
      if (shape == "custom" && pad.options?.anchor) {
        shape = pad.options.anchor;
      }
      if (pad.drill?.offset) {
        this.gfx.state.matrix.translate_self(
          pad.drill.offset.x,
          pad.drill.offset.y
        );
      }
      switch (shape) {
        case "circle":
          this.gfx.circle(new Circle3(center, pad.size.x / 2, color));
          break;
        case "rect":
          {
            const rect_points = [
              new Vec2(-pad.size.x / 2, -pad.size.y / 2),
              new Vec2(pad.size.x / 2, -pad.size.y / 2),
              new Vec2(pad.size.x / 2, pad.size.y / 2),
              new Vec2(-pad.size.x / 2, pad.size.y / 2)
            ];
            this.gfx.polygon(new Polygon2(rect_points, color));
          }
          break;
        case "roundrect":
        case "trapezoid":
          {
            const rounding = Math.min(pad.size.x, pad.size.y) * (pad.roundrect_rratio ?? 0);
            let half_size = new Vec2(
              pad.size.x / 2,
              pad.size.y / 2
            );
            half_size = half_size.sub(new Vec2(rounding, rounding));
            let trap_delta = pad.rect_delta ? pad.rect_delta.copy() : new Vec2(0, 0);
            trap_delta = trap_delta.multiply(0.5);
            const rect_points = [
              new Vec2(
                -half_size.x - trap_delta.y,
                half_size.y + trap_delta.x
              ),
              new Vec2(
                half_size.x + trap_delta.y,
                half_size.y - trap_delta.x
              ),
              new Vec2(
                half_size.x - trap_delta.y,
                -half_size.y + trap_delta.x
              ),
              new Vec2(
                -half_size.x + trap_delta.y,
                -half_size.y - trap_delta.x
              )
            ];
            this.gfx.polygon(new Polygon2(rect_points, color));
            this.gfx.line(
              new Polyline2(
                [...rect_points, rect_points[0]],
                rounding * 2,
                color
              )
            );
          }
          break;
        case "oval":
          {
            const half_size = new Vec2(
              pad.size.x / 2,
              pad.size.y / 2
            );
            const half_width = Math.min(half_size.x, half_size.y);
            const half_len = new Vec2(
              half_size.x - half_width,
              half_size.y - half_width
            );
            const pad_pos = center;
            const pad_start = pad_pos.sub(half_len);
            const pad_end = pad_pos.add(half_len);
            if (pad_start.equals(pad_end)) {
              this.gfx.circle(
                new Circle3(pad_pos, half_width, color)
              );
            } else {
              this.gfx.line(
                new Polyline2(
                  [pad_start, pad_end],
                  half_width * 2,
                  color
                )
              );
            }
          }
          break;
        default:
          warn(`Unknown pad shape "${pad.shape}"`);
          break;
      }
      if (pad.shape == "custom" && pad.primitives) {
        for (const prim of pad.primitives) {
          this.view_painter.paint_item(layer, prim);
        }
      }
    }
    this.gfx.state.pop();
  }
  // Get displayed netname for a pad, if it's no_connect, return "X"
  static pad_netname(pad) {
    if (pad.pintype !== void 0 && pad.pintype.includes("no_connect")) {
      return "X";
    }
    return _PadPainter.displayed_netname(pad.netname);
  }
  // Get pad outline size
  static get_pad_orth_size(pad) {
    const pad_size = pad.size.copy();
    const obj_angle = pad.parent.at.rotation + 36e3;
    if (obj_angle % 180 !== 0) {
      [pad_size.x, pad_size.y] = [pad_size.y, pad_size.x];
    }
    const limit = Math.min(pad_size.x, pad_size.y) * 1.1;
    if (pad_size.x > limit && pad_size.y > limit) {
      pad_size.x = limit;
      pad_size.y = limit;
    }
    return pad_size;
  }
};
var GrTextPainter = class extends BoardItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [GrText];
  }
  static {
    __name(this, "GrTextPainter");
  }
  layers_for(t) {
    return [t.layer.name];
  }
  paint(layer, t) {
    if (this.filter_net) return;
    if (t.hide || !t.shown_text) {
      return;
    }
    if (t.render_cache) {
      for (const poly of t.render_cache.polygons) {
        this.view_painter.paint_item(layer, poly);
      }
      return;
    }
    const edatext = new EDAText(t.shown_text);
    edatext.apply_effects(t.effects);
    edatext.apply_at(t.at);
    edatext.attributes.color = layer.color;
    if (!is_manufacturing_layer(layer.name) && this.gfx.state.flipped) {
    }
    this.gfx.state.push();
    StrokeFont.default().draw(
      this.gfx,
      edatext.shown_text,
      edatext.text_pos,
      edatext.attributes
    );
    this.gfx.state.pop();
  }
};
var FpTextPainter = class extends BoardItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [FpText];
  }
  static {
    __name(this, "FpTextPainter");
  }
  layers_for(t) {
    if (t.hide) {
      return [];
    } else {
      return [t.layer.name];
    }
  }
  paint(layer, t) {
    if (this.filter_net) return;
    if (t.hide || !t.shown_text) {
      return;
    }
    if (t.render_cache) {
      this.gfx.state.push();
      this.gfx.state.matrix = Matrix3.identity();
      for (const poly of t.render_cache.polygons) {
        this.view_painter.paint_item(layer, poly);
      }
      this.gfx.state.pop();
      return;
    }
    const edatext = new EDAText(t.shown_text);
    edatext.apply_effects(t.effects);
    edatext.apply_at(t.at);
    edatext.attributes.keep_upright = !t.at.unlocked;
    edatext.attributes.color = layer.color;
    if (t.parent) {
      const rot = Angle.from_degrees(t.parent.at.rotation);
      let pos = edatext.text_pos;
      pos = rot.rotate_point(pos, new Vec2(0, 0));
      pos = pos.add(t.parent.at.position.multiply(1e4));
      edatext.text_pos.set(pos);
    }
    if (edatext.attributes.keep_upright) {
      while (edatext.text_angle.degrees > 90) {
        edatext.text_angle.degrees -= 180;
      }
      while (edatext.text_angle.degrees <= -90) {
        edatext.text_angle.degrees += 180;
      }
    }
    this.gfx.state.push();
    this.gfx.state.matrix = Matrix3.identity();
    StrokeFont.default().draw(
      this.gfx,
      edatext.shown_text,
      edatext.text_pos,
      edatext.attributes
    );
    this.gfx.state.pop();
  }
};
var PropertyTextPainter = class extends BoardItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [SymbolProperty];
  }
  static {
    __name(this, "PropertyTextPainter");
  }
  layers_for(t) {
    return [t.layer];
  }
  paint(layer, t) {
    if (this.filter_net) return;
    if (t.hide || !t.shown_text || !t.has_symbol_prop) {
      return;
    }
    const edatext = new EDAText(t.shown_text);
    edatext.apply_effects(t.effects);
    edatext.apply_at(t.at);
    edatext.attributes.color = layer.color;
    edatext.attributes.keep_upright = !t.at.unlocked;
    if (edatext.attributes.keep_upright) {
      while (edatext.text_angle.degrees > 90) {
        edatext.text_angle.degrees -= 180;
      }
      while (edatext.text_angle.degrees <= -90) {
        edatext.text_angle.degrees += 180;
      }
    }
    if (t.parent) {
      const rot = t.parent.at.rotation;
      edatext.text_angle.degrees -= rot;
    }
    this.gfx.state.push();
    StrokeFont.default().draw(
      this.gfx,
      edatext.shown_text,
      edatext.text_pos,
      edatext.attributes
    );
    this.gfx.state.pop();
  }
};
var DimensionPainter = class extends BoardItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Dimension];
  }
  static {
    __name(this, "DimensionPainter");
  }
  layers_for(d) {
    return [d.layer];
  }
  paint(layer, d) {
    switch (d.type) {
      case "orthogonal":
      case "aligned":
        this.paint_linear(layer, d);
        break;
      case "center":
        this.paint_center(layer, d);
        break;
      case "radial":
        this.paint_radial(layer, d);
        break;
      case "leader":
        this.paint_leader(layer, d);
        break;
    }
  }
  paint_center(layer, d) {
    const thickness = d.style.thickness ?? 0.2;
    let arm = d.end.sub(d.start);
    this.gfx.line(
      [d.start.sub(arm), d.start.add(arm)],
      thickness,
      layer.color
    );
    arm = Angle.from_degrees(90).rotate_point(arm);
    this.gfx.line(
      [d.start.sub(arm), d.start.add(arm)],
      thickness,
      layer.color
    );
  }
  paint_radial(layer, d) {
    const thickness = d.style.thickness ?? 0.2;
    const center = d.start.copy();
    let center_arm = new Vec2(0, d.style.arrow_length);
    this.gfx.line(
      [center.sub(center_arm), center.add(center_arm)],
      thickness,
      layer.color
    );
    center_arm = Angle.from_degrees(90).rotate_point(center_arm);
    this.gfx.line(
      [center.sub(center_arm), center.add(center_arm)],
      thickness,
      layer.color
    );
    let radial = d.end.sub(d.start);
    radial = radial.resize(d.leader_length);
    const text = this.make_text(layer, d);
    const text_bbox = text.get_text_box().scale(1 / 1e4);
    const line_segs = [d.end, d.end.add(radial), d.gr_text.at.position];
    const textbox_pt = text_bbox.intersect_segment(
      line_segs[1],
      line_segs[2]
    );
    if (textbox_pt) {
      line_segs[2] = textbox_pt;
    }
    this.gfx.line(line_segs, thickness, layer.color);
    const arrow_angle = Angle.from_degrees(27.5);
    const inv_radial_angle = radial.angle.negative();
    const arrow_seg = new Vec2(d.style.arrow_length, 0);
    const arrow_end_pos = inv_radial_angle.add(arrow_angle).rotate_point(arrow_seg);
    const arrow_end_neg = inv_radial_angle.sub(arrow_angle).rotate_point(arrow_seg);
    this.gfx.line(
      [d.end.add(arrow_end_neg), d.end, d.end.add(arrow_end_pos)],
      thickness,
      layer.color
    );
    this.paint_text(text);
  }
  paint_leader(layer, d) {
    const thickness = d.style.thickness ?? 0.2;
    const text = this.make_text(layer, d);
    const text_bbox = text.get_text_box().grow(text.text_width / 2, text.get_effective_text_thickness() * 2).scale(1 / 1e4);
    const start = d.start.add(
      d.end.sub(d.start).resize(d.style.extension_offset)
    );
    const line_segs = [start, d.end, d.gr_text.at.position];
    const textbox_pt = text_bbox.intersect_segment(
      line_segs[1],
      line_segs[2]
    );
    if (textbox_pt) {
      line_segs[2] = textbox_pt;
    }
    this.gfx.line(line_segs, thickness, layer.color);
    if (d.style.text_frame == 1) {
      this.gfx.line(
        Polyline2.from_BBox(text_bbox, thickness, layer.color)
      );
    }
    if (d.style.text_frame == 2) {
      const radius = text_bbox.w / 2 - text.get_effective_text_thickness() / 1e4 / 2;
      this.gfx.arc(
        text_bbox.center,
        radius,
        Angle.from_degrees(0),
        Angle.from_degrees(360),
        thickness,
        layer.color
      );
    }
    const radial = d.end.sub(d.start);
    const arrow_angle = Angle.from_degrees(27.5);
    const inv_radial_angle = radial.angle.negative();
    const arrow_seg = new Vec2(d.style.arrow_length, 0);
    const arrow_end_pos = inv_radial_angle.add(arrow_angle).rotate_point(arrow_seg);
    const arrow_end_neg = inv_radial_angle.sub(arrow_angle).rotate_point(arrow_seg);
    this.gfx.line(
      [start.add(arrow_end_neg), start, start.add(arrow_end_pos)],
      thickness,
      layer.color
    );
    this.paint_text(text);
  }
  paint_linear(layer, d) {
    const thickness = d.style.thickness ?? 0.2;
    let extension2 = new Vec2();
    let xbar_start = new Vec2();
    let xbar_end = new Vec2();
    if (d.type == "orthogonal") {
      if (d.orientation == 0) {
        extension2 = new Vec2(0, d.height);
        xbar_start = d.start.add(extension2);
        xbar_end = new Vec2(d.end.x, xbar_start.y);
      } else {
        extension2 = new Vec2(d.height, 0);
        xbar_start = d.start.add(extension2);
        xbar_end = new Vec2(xbar_start.x, d.end.y);
      }
    } else {
      const dimension = d.end.sub(d.start);
      if (d.height > 0) {
        extension2 = new Vec2(-dimension.y, dimension.x);
      } else {
        extension2 = new Vec2(dimension.y, -dimension.x);
      }
      const xbar_distance = extension2.resize(d.height).multiply(Math.sign(d.height));
      xbar_start = d.start.add(xbar_distance);
      xbar_end = d.end.add(xbar_distance);
    }
    const extension_height = Math.abs(d.height) - d.style.extension_offset + d.style.extension_height;
    let ext_start = d.start.add(extension2.resize(d.style.extension_offset));
    let ext_end = ext_start.add(extension2.resize(extension_height));
    this.gfx.line([ext_start, ext_end], thickness, layer.color);
    ext_start = d.end.add(extension2.resize(d.style.extension_offset));
    ext_end = ext_start.add(extension2.resize(extension_height));
    this.gfx.line([ext_start, ext_end], thickness, layer.color);
    this.gfx.line([xbar_start, xbar_end], thickness, layer.color);
    const xbar_angle = xbar_end.sub(xbar_start).angle.negative();
    const arrow_angle = Angle.from_degrees(27.5);
    const arrow_end_pos = xbar_angle.add(arrow_angle).rotate_point(new Vec2(d.style.arrow_length, 0));
    const arrow_end_neg = xbar_angle.sub(arrow_angle).rotate_point(new Vec2(d.style.arrow_length, 0));
    this.gfx.line(
      [
        xbar_start.add(arrow_end_neg),
        xbar_start,
        xbar_start.add(arrow_end_pos)
      ],
      thickness,
      layer.color
    );
    this.gfx.line(
      [
        xbar_end.sub(arrow_end_neg),
        xbar_end,
        xbar_end.sub(arrow_end_pos)
      ],
      thickness,
      layer.color
    );
    this.paint_text(this.make_text(layer, d));
  }
  make_text(layer, d) {
    const pcbtext = new EDAText(d.gr_text.shown_text);
    pcbtext.apply_effects(d.gr_text.effects);
    pcbtext.apply_at(d.gr_text.at);
    pcbtext.attributes.color = layer.color;
    return pcbtext;
  }
  paint_text(text) {
    this.gfx.state.push();
    StrokeFont.default().draw(
      this.gfx,
      text.shown_text,
      text.text_pos,
      text.attributes
    );
    this.gfx.state.pop();
  }
};
var FootprintPainter = class extends BoardItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Footprint];
  }
  static {
    __name(this, "FootprintPainter");
  }
  layers_for(fp) {
    const layers = /* @__PURE__ */ new Set();
    for (const item of fp.items()) {
      const item_layers = this.view_painter.layers_for(item);
      for (const layer of item_layers) {
        layers.add(layer);
      }
    }
    return Array.from(layers.values());
  }
  paint(layer, fp) {
    const matrix = Matrix3.translation(
      fp.at.position.x,
      fp.at.position.y
    ).rotate_self(Angle.deg_to_rad(fp.at.rotation));
    this.gfx.state.push();
    this.gfx.state.multiply(matrix);
    for (const item of fp.items()) {
      const item_layers = this.view_painter.layers_for(item);
      if (layer.name == ":Overlay" /* overlay */ || item_layers.includes(layer.name)) {
        this.view_painter.paint_item(layer, item);
      }
    }
    this.gfx.state.pop();
  }
};
var BoardPainter = class extends DocumentPainter {
  constructor(gfx, layers, theme3) {
    super(gfx, layers, theme3);
    // Used to filter out items by net when highlighting nets. Painters
    // should use this to determine whether to draw or skip the current item.
    this.filter_net = null;
    this.painter_list = [
      new LinePainter2(this, gfx),
      new RectPainter2(this, gfx),
      new PolyPainter(this, gfx),
      new ArcPainter(this, gfx),
      new CirclePainter(this, gfx),
      new TraceSegmentPainter(this, gfx),
      new TraceArcPainter(this, gfx),
      new ViaPainter(this, gfx),
      new ZonePainter(this, gfx),
      new PadPainter(this, gfx),
      new FootprintPainter(this, gfx),
      new GrTextPainter(this, gfx),
      new FpTextPainter(this, gfx),
      new PropertyTextPainter(this, gfx),
      new DimensionPainter(this, gfx)
    ];
  }
  static {
    __name(this, "BoardPainter");
  }
  paint_net(board, net) {
    const layer = this.layers.overlay;
    this.filter_net = net;
    layer.clear();
    layer.color = Color.white;
    this.gfx.start_layer(layer.name);
    for (const item of board.items()) {
      const painter = this.painter_for(item);
      if (!painter) {
        continue;
      }
      this.paint_item(layer, item);
    }
    layer.graphics = this.gfx.end_layer();
    layer.graphics.composite_operation = "overlay";
    this.filter_net = null;
  }
};

// viewers/board/viewer.ts
var BoardViewer = class extends DocumentViewer {
  static {
    __name(this, "BoardViewer");
  }
  #contextMenuCallback = null;
  get board() {
    return this.document;
  }
  set contextMenuCallback(callback) {
    this.#contextMenuCallback = callback;
  }
  create_renderer(canvas) {
    const renderer = new WebGL2Renderer(canvas);
    return renderer;
  }
  create_painter() {
    return new BoardPainter(this.renderer, this.layers, this.theme);
  }
  create_layer_set() {
    return new LayerSet(this.board, this.theme);
  }
  get grid_origin() {
    return this.board.setup?.grid_origin ?? new Vec2(0, 0);
  }
  on_pick(mouse, items) {
    const selectableItems = /* @__PURE__ */ new Map();
    for (const { bbox } of items) {
      const item = bbox.context;
      if (item instanceof Footprint) {
        selectableItems.set(`Footprint: ${item.reference}`, item);
      } else if (isNetInfo(item)) {
        selectableItems.set(`Net: ${item.netname}`, item);
      } else {
        console.log(item);
      }
    }
    if (selectableItems.size === 0) {
      this.select(null);
    } else if (selectableItems.size === 1 || !this.#contextMenuCallback) {
      this.handleItemClick(selectableItems.values().next().value);
    } else {
      const { x, y } = this.viewport.camera.world_to_screen(mouse);
      this.#contextMenuCallback(x, y, selectableItems, (selected) => {
        this.handleItemClick(selected);
      });
    }
  }
  handleItemClick(item) {
    if (item instanceof Footprint) {
      this.select(item);
    } else if (isNetInfo(item)) {
      this.highlight_net(getNetNumber(item));
    }
  }
  select(item) {
    if (is_string(item)) {
      item = this.board.find_footprint(item);
    }
    if (item instanceof Footprint) {
      item = item.bbox;
    }
    super.select(item);
  }
  highlight_net(net) {
    this.painter.paint_net(this.board, net);
    this.draw();
  }
  set_layers_opacity(layers, opacity) {
    for (const layer of layers) {
      layer.opacity = opacity;
    }
    this.draw();
  }
  set track_opacity(value) {
    this.set_layers_opacity(
      this.layers.copper_layers(),
      value
    );
  }
  set via_opacity(value) {
    this.set_layers_opacity(this.layers.via_layers(), value);
  }
  set zone_opacity(value) {
    this.set_layers_opacity(this.layers.zone_layers(), value);
  }
  set pad_opacity(value) {
    this.set_layers_opacity(this.layers.pad_layers(), value);
  }
  set pad_hole_opacity(value) {
    this.set_layers_opacity(
      this.layers.pad_hole_layers(),
      value
    );
  }
  set grid_opacity(value) {
    this.set_layers_opacity(this.layers.grid_layers(), value);
  }
  set page_opacity(value) {
    this.layers.by_name(LayerNames.drawing_sheet).opacity = value;
    this.draw();
  }
  zoom_to_board() {
    const edge_cuts = this.layers.by_name("Edge.Cuts" /* edge_cuts */);
    const board_bbox = edge_cuts.bbox;
    this.viewport.camera.bbox = board_bbox.grow(board_bbox.w * 0.1);
  }
};

// kicanvas/elements/common/viewer.ts
var KCViewerElement = class extends WithPreferences(KCUIElement) {
  constructor() {
    super(...arguments);
    this.selected = [];
  }
  static {
    __name(this, "KCViewerElement");
  }
  initialContentCallback() {
    (async () => {
      this.viewer = this.addDisposable(this.make_viewer());
      await this.viewer.setup();
      this.addDisposable(
        this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
          this.loaded = true;
          this.dispatchEvent(new KiCanvasLoadEvent());
        })
      );
    })();
  }
  async preferenceChangeCallback(preferences) {
    if (this.theme || !this.viewer || !this.viewer.loaded) {
      return;
    }
    this.update_theme();
    this.viewer.paint();
    this.viewer.draw();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.selected = [];
  }
  get themeObject() {
    if (this.theme) {
      return themes_default.by_name(this.theme);
    } else {
      return Preferences.INSTANCE.theme;
    }
  }
  async load(src) {
    this.loaded = false;
    await this.viewer.load(src.document);
  }
  render() {
    this.canvas = html`<canvas></canvas>`;
    return html`<style>
                :host {
                    display: block;
                    touch-action: none;
                    width: 100%;
                    height: 100%;
                }

                canvas {
                    width: 100%;
                    height: 100%;
                }
            </style>
            ${this.canvas}`;
  }
};
__decorateClass([
  attribute({ type: Boolean })
], KCViewerElement.prototype, "loaded", 2);
__decorateClass([
  attribute({ type: String })
], KCViewerElement.prototype, "theme", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCViewerElement.prototype, "disableinteraction", 2);

// kicanvas/elements/common/context-menu.ts
var KCContextMenuElement = class extends KCUIElement {
  static {
    __name(this, "KCContextMenuElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                position: fixed;
                z-index: 1000;
                display: none;
            }

            :host([visible]) {
                display: block;
            }

            .menu {
                background: var(--dropdown-bg);
                border-radius: 5px;
                overflow: hidden;
                min-width: 150px;
                max-width: 300px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }

            .menu-item {
                display: block;
                padding: 0.4em 0.8em;
                cursor: pointer;
                color: var(--dropdown-fg);
                user-select: none;
                overflow-wrap: anywhere;
            }

            .menu-item:hover {
                background: var(--dropdown-hover-bg);
                color: var(--dropdown-hover-fg);
            }
        `
    ];
  }
  #items = null;
  #onSelect = null;
  #boundHandleOutsideClick = null;
  #boundHandleDismiss = null;
  show(screenX, screenY, items, onSelect) {
    this.#items = items;
    this.#onSelect = onSelect;
    this.style.left = `${screenX}px`;
    this.style.top = `${screenY}px`;
    this.setAttribute("visible", "");
    requestAnimationFrame(() => {
      this.updateMenuItems();
      this.adjustPosition();
      this.setupDismissListeners();
    });
  }
  hide() {
    this.removeAttribute("visible");
    this.#items = null;
    this.#onSelect = null;
    this.removeDismissListeners();
  }
  updateMenuItems() {
    const menu = this.shadowRoot?.querySelector(".menu");
    if (!menu) return;
    menu.innerHTML = "";
    this.#items?.forEach((item, name) => {
      const menuItem = document.createElement("div");
      menuItem.className = "menu-item";
      menuItem.textContent = name;
      menu.appendChild(menuItem);
    });
  }
  adjustPosition() {
    const rect = this.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let x = parseFloat(this.style.left);
    let y = parseFloat(this.style.top);
    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 10;
    }
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 10;
    }
    this.style.left = `${Math.max(10, x)}px`;
    this.style.top = `${Math.max(10, y)}px`;
  }
  setupDismissListeners() {
    this.removeDismissListeners();
    this.#boundHandleOutsideClick = (e) => {
      const rect = this.getBoundingClientRect();
      const isInside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!isInside) {
        this.hide();
      }
    };
    this.#boundHandleDismiss = () => this.hide();
    setTimeout(() => {
      if (this.#boundHandleOutsideClick) {
        document.addEventListener(
          "pointerdown",
          this.#boundHandleOutsideClick
        );
      }
      if (this.#boundHandleDismiss) {
        window.addEventListener("resize", this.#boundHandleDismiss);
        window.addEventListener(
          "scroll",
          this.#boundHandleDismiss,
          true
        );
      }
    }, 100);
  }
  removeDismissListeners() {
    if (this.#boundHandleOutsideClick) {
      document.removeEventListener(
        "pointerdown",
        this.#boundHandleOutsideClick
      );
      this.#boundHandleOutsideClick = null;
    }
    if (this.#boundHandleDismiss) {
      window.removeEventListener("resize", this.#boundHandleDismiss);
      window.removeEventListener(
        "scroll",
        this.#boundHandleDismiss,
        true
      );
      this.#boundHandleDismiss = null;
    }
  }
  initialContentCallback() {
    super.initialContentCallback();
    this.shadowRoot?.addEventListener("click", (e) => {
      const target = e.target;
      if (target.classList.contains("menu-item") && this.#items) {
        if (this.#onSelect) {
          this.#onSelect(this.#items.get(target.textContent ?? ""));
        }
        this.hide();
      }
    });
  }
  render() {
    return html`<div class="menu"></div>`;
  }
};
window.customElements.define("kc-context-menu", KCContextMenuElement);

// kicanvas/elements/kc-board/viewer.ts
var KCBoardViewerElement = class extends KCViewerElement {
  static {
    __name(this, "KCBoardViewerElement");
  }
  #contextMenu = null;
  update_theme() {
    this.viewer.theme = this.themeObject.board;
  }
  make_viewer() {
    const viewer = new BoardViewer(
      this.canvas,
      !this.disableinteraction,
      this.themeObject.board
    );
    viewer.contextMenuCallback = (screenX, screenY, items, onSelect) => {
      if (!this.#contextMenu) {
        return;
      }
      this.#contextMenu.show(screenX, screenY, items, onSelect);
    };
    return viewer;
  }
  render() {
    this.canvas = html`<canvas></canvas>`;
    this.#contextMenu = html`<kc-context-menu></kc-context-menu>`;
    return html`<style>
                :host {
                    display: block;
                    touch-action: none;
                    width: 100%;
                    height: 100%;
                    position: relative;
                }

                canvas {
                    width: 100%;
                    height: 100%;
                }
            </style>
            ${this.canvas} ${this.#contextMenu}`;
  }
};
window.customElements.define("kc-board-viewer", KCBoardViewerElement);

// kicanvas/elements/common/help-panel.ts
var KCHelpPanel = class extends KCUIElement {
  static {
    __name(this, "KCHelpPanel");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            p {
                margin: 0;
                padding: 0.5em;
            }

            a {
                color: var(--button-bg);
            }

            a:hover {
                color: var(--button-hover-bg);
            }
        `
    ];
  }
  render() {
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Help"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <p>
                        You're using
                        <a href="https://kicanvas.org/home">KiCanvas</a>, an
                        interactive, browser-based viewer for KiCad schematics
                        and boards.
                    </p>
                    <p>
                        KiCanvas is very much in <strong>alpha</strong>, so
                        please
                        <a
                            href="https://github.com/theacodes/kicanvas/issues/new/choose"
                            target="_blank"
                            >file an issue on GitHub</a
                        >
                        if you run into any bugs.
                    </p>
                    <p>
                        KiCanvas is developed by
                        <a href="https://thea.codes" target="_blank"
                            >Thea Flowers</a
                        >
                        and supported by
                        <a
                            href="https://github.com/sponsors/theacodes"
                            target="_blank"
                            >community donations</a
                        >.
                    </p></kc-ui-panel-body
                >
            </kc-ui-panel>
        `;
  }
};
window.customElements.define("kc-help-panel", KCHelpPanel);

// kicanvas/elements/common/preferences-panel.ts
var prefs2 = Preferences.INSTANCE;
var KCPreferencesPanel = class extends KCUIElement {
  static {
    __name(this, "KCPreferencesPanel");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            select {
                box-sizing: border-box;
                display: block;
                width: 100%;
                max-width: 100%;
                margin-top: 0.25em;
                font-family: inherit;
                font-size: inherit;
                font-weight: 300;
                margin-top: 0.25em;
                border-radius: 0.25em;
                text-align: left;
                padding: 0.25em;
                background: var(--input-bg);
                color: var(--input-fg);
                border: var(--input-border);
                transition:
                    color var(--transition-time-medium) ease,
                    box-shadow var(--transition-time-medium) ease,
                    outline var(--transition-time-medium) ease,
                    background var(--transition-time-medium) ease,
                    border var(--transition-time-medium) ease;
            }

            select::after {
                display: block;
                content: "▾";
                color: var(--input-fg);
            }

            select:hover {
                z-index: 10;
                box-shadow: var(--input-hover-shadow);
            }

            select:focus {
                z-index: 10;
                box-shadow: none;
                outline: var(--input-focus-outline);
            }
        `
    ];
  }
  initialContentCallback() {
    this.renderRoot.addEventListener("input", (e) => {
      const target = e.target;
      if (target.name === "theme") {
        prefs2.theme = themes_default.by_name(this.theme_control.value);
      }
      if (target.name === "align-controls-kicad") {
        prefs2.alignControlsWithKiCad = target.checked;
      }
      prefs2.save();
    });
  }
  render() {
    const theme_options = themes_default.list().map((v) => {
      return html`<option
                value="${v.name}"
                selected="${prefs2.theme.name == v.name}">
                ${v.friendly_name}
            </option>`;
    });
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Preferences"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <kc-ui-control-list>
                        <kc-ui-control>
                            <label>Theme</label>
                            <select name="theme" value="kicad">
                                ${theme_options}
                            </select>
                        </kc-ui-control>
                    </kc-ui-control-list>
                    <kc-ui-control>
                        <label>
                            <input
                                type="checkbox"
                                name="align-controls-kicad"
                                checked="${prefs2.alignControlsWithKiCad}" />
                            Align controls with KiCad
                        </label>
                    </kc-ui-control>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
__decorateClass([
  query("[name=theme]", true)
], KCPreferencesPanel.prototype, "theme_control", 2);
window.customElements.define("kc-preferences-panel", KCPreferencesPanel);

// kicanvas/elements/common/project-panel.ts
var KCProjectPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCProjectPanelElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            .page {
                display: flex;
                align-items: center;
            }

            .page span.name {
                margin-right: 1em;
                overflow-wrap: anywhere;
            }

            .page span.filename {
                flex: 1;
                overflow-wrap: anywhere;
                margin-left: 1em;
                text-align: right;
                color: #aaa;
            }

            .page kc-ui-button {
                margin-left: 0.5em;
            }

            .page span.number {
                flex: 0;
                background: var(--dropdown-hover-bg);
                border: 1px solid transparent;
                border-radius: 0.5em;
                font-size: 0.8em;
                padding: 0px 0.3em;
                margin-right: 0.5em;
            }

            kc-ui-menu-item:hover span.number {
                background: var(--dropdown-bg);
            }

            kc-ui-menu-item[selected]:hover span.number {
                background: var(--dropdown-hover-bg);
            }
        `
    ];
  }
  #menu;
  connectedCallback() {
    (async () => {
      this.project = await this.requestContext("project");
      super.connectedCallback();
    })();
  }
  initialContentCallback() {
    super.initialContentCallback();
    this.addDisposable(
      listen(this.project, "load", (e) => {
        this.update();
      })
    );
    this.addDisposable(
      listen(this.project, "change", (e) => {
        this.selected = this.project.active_page?.project_path ?? null;
      })
    );
    this.addEventListener("kc-ui-menu:select", (e) => {
      const source = e.detail;
      this.selected = source?.name ?? null;
      this.change_current_project_page(this.selected);
    });
    delegate(this.renderRoot, "kc-ui-button", "click", (e, source) => {
      const menu_item = source.closest(
        "kc-ui-menu-item"
      );
      this.project.download(menu_item.name);
    });
  }
  get selected() {
    return this.#menu.selected?.name ?? null;
  }
  set selected(name) {
    this.#menu.selected = name;
  }
  change_current_project_page(name) {
    this.project.set_active_page(name);
  }
  render() {
    const file_btn_elms = [];
    if (!this.project) {
      return html``;
    }
    for (const page of this.project.pages()) {
      const icon = page.type == "schematic" ? "svg:schematic_file" : "svg:pcb_file";
      const number = page.page ? html`<span class="number">${page.page}</span>` : "";
      file_btn_elms.push(
        html`<kc-ui-menu-item
                    icon="${icon}"
                    name="${page.project_path}">
                    <span class="page">
                        ${number}
                        <span class="name">
                            ${page.name ?? page.filename}
                        </span>
                        <span class="filename">
                            ${page.name && page.name !== page.filename ? page.filename : ""}
                        </span>
                        <kc-ui-button
                            variant="menu"
                            icon="download"
                            title="Download"></kc-ui-button>
                    </span>
                </kc-ui-menu-item>`
      );
    }
    this.#menu = html`<kc-ui-menu>
            ${file_btn_elms}
        </kc-ui-menu>`;
    return html`<kc-ui-panel>
            <kc-ui-panel-title title="Project"></kc-ui-panel-title>
            <kc-ui-panel-body>${this.#menu}</kc-ui-panel-body>
        </kc-ui-panel>`;
  }
};
__decorateClass([
  no_self_recursion
], KCProjectPanelElement.prototype, "change_current_project_page", 1);
window.customElements.define("kc-project-panel", KCProjectPanelElement);

// kicanvas/elements/common/viewer-bottom-toolbar.ts
var KCViewerBottomToolbarElement = class extends KCUIElement {
  static {
    __name(this, "KCViewerBottomToolbarElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            output {
                width: unset;
                margin: unset;
                padding: 0.5em;
                color: var(--button-toolbar-fg);
                background: var(--button-toolbar-bg);
                border: 1px solid var(--button-toolbar-bg);
                border-radius: 0.25em;
                font-weight: 300;
                font-size: 0.9em;
                box-shadow: var(--input-hover-shadow);
                user-select: none;
            }
        `
    ];
  }
  #position_elm;
  #zoom_to_page_btn;
  #zoom_to_selection_btn;
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
      this.addDisposable(
        this.viewer.addEventListener(
          KiCanvasMouseMoveEvent.type,
          () => {
            this.update_position();
          }
        )
      );
      this.addDisposable(
        this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
          this.#zoom_to_selection_btn.disabled = e.detail.item ? false : true;
        })
      );
      this.#zoom_to_page_btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.viewer.zoom_to_page();
      });
      this.#zoom_to_selection_btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.viewer.zoom_to_selection();
      });
    })();
  }
  update_position() {
    const pos = this.viewer.mouse_position;
    this.#position_elm.value = `${pos.x.toFixed(2)}, ${pos.y.toFixed(
      2
    )} mm`;
  }
  render() {
    this.#position_elm = html`<output
            slot="left"
            class="toolbar"></output>`;
    this.#zoom_to_page_btn = html`<kc-ui-button
            slot="right"
            variant="toolbar"
            name="zoom_to_page"
            title="zoom to page"
            icon="svg:zoom_page">
        </kc-ui-button>`;
    this.#zoom_to_selection_btn = html` <kc-ui-button
            slot="right"
            variant="toolbar"
            name="zoom_to_selection"
            title="zoom to selection"
            icon="svg:zoom_footprint"
            disabled>
        </kc-ui-button>`;
    this.update_position();
    return html`<kc-ui-floating-toolbar location="bottom">
            ${this.#position_elm} ${this.#zoom_to_selection_btn}
            ${this.#zoom_to_page_btn}
        </kc-ui-floating-toolbar>`;
  }
};
window.customElements.define(
  "kc-viewer-bottom-toolbar",
  KCViewerBottomToolbarElement
);

// kicanvas/elements/common/app.ts
var KCViewerAppElement = class extends KCUIElement {
  constructor() {
    super();
    this.viewerReady = new DeferredPromise();
    this.provideLazyContext("viewer", () => this.viewer);
  }
  static {
    __name(this, "KCViewerAppElement");
  }
  #viewer_elm;
  #activity_bar;
  get viewer() {
    return this.#viewer_elm.viewer;
  }
  connectedCallback() {
    this.hidden = true;
    (async () => {
      this.project = await this.requestContext("project");
      await this.project.loaded;
      super.connectedCallback();
    })();
  }
  initialContentCallback() {
    if (this.project.active_page) {
      this.load(this.project.active_page);
    }
    this.addDisposable(
      listen(this.project, "change", async (e) => {
        const page = this.project.active_page;
        if (page) {
          await this.load(page);
        } else {
          this.hidden = true;
        }
      })
    );
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
        this.on_viewer_select(e.detail.item, e.detail.previous);
      })
    );
    delegate(this.renderRoot, "kc-ui-button", "click", (e) => {
      const target = e.target;
      switch (target.name) {
        case "download":
          if (this.project.active_page) {
            this.project.download(
              this.project.active_page.filename
            );
          }
          break;
        case "flip_view":
          this.#viewer_elm.viewer.flip_view();
          break;
        default:
          console.warn("Unknown button", e);
      }
    });
  }
  async load(src) {
    await this.viewerReady;
    if (this.can_load(src)) {
      await this.#viewer_elm.load(src);
      this.hidden = false;
    } else {
      this.hidden = true;
    }
  }
  #has_more_than_one_page() {
    return length(this.project.pages()) > 1;
  }
  make_pre_activities() {
    const activities = [];
    if (this.#has_more_than_one_page()) {
      activities.push(
        html`<kc-ui-activity
                    slot="activities"
                    name="Project"
                    icon="folder">
                    <kc-project-panel></kc-project-panel>
                </kc-ui-activity>`
      );
    }
    return activities;
  }
  make_post_activities() {
    return [
      // Preferences
      html`<kc-ui-activity
                slot="activities"
                name="Preferences"
                icon="settings"
                button-location="bottom">
                <kc-preferences-panel></kc-preferences-panel>
            </kc-ui-activity>`,
      // Help
      html` <kc-ui-activity
                slot="activities"
                name="Help"
                icon="help"
                button-location="bottom">
                <kc-help-panel></kc-help-panel>
            </kc-ui-activity>`
    ];
  }
  change_activity(name) {
    this.#activity_bar?.change_activity(name);
  }
  render() {
    const controls = this.controls ?? "none";
    const controlslist = parseFlagAttribute(
      this.controlslist ?? "",
      controls == "none" ? { fullscreen: false, download: false, flipview: false } : { fullscreen: true, download: true, flipview: true }
    );
    this.#viewer_elm = this.make_viewer_element();
    this.#viewer_elm.disableinteraction = controls == "none";
    let resizer = null;
    if (controls == "full") {
      const pre_activities = this.make_pre_activities();
      const post_activities = this.make_post_activities();
      const activities = this.make_activities();
      this.#activity_bar = html`<kc-ui-activity-side-bar
                collapsed="${this.sidebarcollapsed}">
                ${pre_activities} ${activities} ${post_activities}
            </kc-ui-activity-side-bar>`;
      resizer = html`<kc-ui-resizer></kc-ui-resizer>`;
    } else {
      this.#activity_bar = null;
    }
    const top_toolbar_buttons = [];
    if (controlslist["download"] && !this.#has_more_than_one_page()) {
      top_toolbar_buttons.push(
        html`<kc-ui-button
                    slot="right"
                    name="download"
                    title="download"
                    icon="download"
                    variant="toolbar-alt">
                </kc-ui-button>`
      );
    }
    if (controlslist["flipview"] && this.#viewer_elm instanceof KCBoardViewerElement) {
      top_toolbar_buttons.push(
        html`<kc-ui-button
                    slot="right"
                    name="flip_view"
                    title="flip view"
                    icon="flip"
                    variant="toolbar-alt">
                </kc-ui-button>`
      );
    }
    const top_toolbar = html`<kc-ui-floating-toolbar location="top">
            ${top_toolbar_buttons}
        </kc-ui-floating-toolbar>`;
    let bottom_toolbar = null;
    if (controls != "none") {
      bottom_toolbar = html`<kc-viewer-bottom-toolbar></kc-viewer-bottom-toolbar>`;
    }
    return html`<kc-ui-split-view vertical>
            <kc-ui-view class="grow">
                ${top_toolbar} ${this.#viewer_elm} ${bottom_toolbar}
            </kc-ui-view>
            ${resizer} ${this.#activity_bar}
        </kc-ui-split-view>`;
  }
  renderedCallback() {
    window.requestAnimationFrame(() => {
      this.viewerReady.resolve(true);
    });
  }
};
__decorateClass([
  attribute({ type: String })
], KCViewerAppElement.prototype, "controls", 2);
__decorateClass([
  attribute({ type: String })
], KCViewerAppElement.prototype, "controlslist", 2);
__decorateClass([
  attribute({ type: Boolean })
], KCViewerAppElement.prototype, "sidebarcollapsed", 2);

// kicanvas/elements/kc-board/footprints-panel.ts
var KCBoardFootprintsPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCBoardFootprintsPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      this.sort_footprints();
      super.connectedCallback();
    })();
  }
  sort_footprints() {
    this.sorted_footprints = sorted_by_numeric_strings(
      this.viewer.board.footprints,
      (fp) => fp.reference || "REF"
    );
  }
  initialContentCallback() {
    this.addEventListener("kc-ui-menu:select", (e) => {
      const item = e.detail;
      if (!item.name) {
        return;
      }
      this.viewer.select(item.name);
    });
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasSelectEvent.type, () => {
        this.menu.selected = this.viewer.selected?.context.uuid_text ?? null;
      })
    );
    this.search_input_elm.addEventListener("input", (e) => {
      this.item_filter_elem.filter_text = this.search_input_elm.value ?? null;
    });
  }
  render() {
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Footprints"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-text-filter-input></kc-ui-text-filter-input>
                    <kc-ui-filtered-list>
                        <kc-ui-menu class="outline">
                            ${this.render_list()}
                        </kc-ui-menu>
                    </kc-ui-filtered-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
  render_list() {
    const front_footprints = [];
    const back_footprints = [];
    for (const fp of this.sorted_footprints) {
      const ref = fp.reference || "REF";
      const val = fp.value || "VAL";
      const match_text = `${fp.library_link} ${fp.descr} ${fp.layer} ${ref} ${val} ${fp.tags}`;
      const entry = html`<kc-ui-menu-item
                name="${fp.unique_id}"
                data-match-text="${match_text}">
                <span class="narrow">${ref}</span><span>${val}</span>
            </kc-ui-menu-item>`;
      if (fp.layer == "F.Cu") {
        front_footprints.push(entry);
      } else {
        back_footprints.push(entry);
      }
    }
    return html`<kc-ui-menu-label>Front</kc-ui-menu-label>
            ${front_footprints}
            <kc-ui-menu-label>Back</kc-ui-menu-label>
            ${back_footprints}`;
  }
};
__decorateClass([
  query("kc-ui-menu", true)
], KCBoardFootprintsPanelElement.prototype, "menu", 2);
__decorateClass([
  query("kc-ui-text-filter-input", true)
], KCBoardFootprintsPanelElement.prototype, "search_input_elm", 2);
__decorateClass([
  query("kc-ui-filtered-list", true)
], KCBoardFootprintsPanelElement.prototype, "item_filter_elem", 2);
window.customElements.define(
  "kc-board-footprints-panel",
  KCBoardFootprintsPanelElement
);

// kicanvas/elements/kc-board/info-panel.ts
var KCBoardInfoPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCBoardInfoPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
    })();
  }
  render() {
    const ds = this.viewer.drawing_sheet;
    const board = this.viewer.board;
    const board_bbox = board.edge_cuts_bbox;
    const header = /* @__PURE__ */ __name((name) => html`<kc-ui-property-list-item
                name="${name}"
                class="label"></kc-ui-property-list-item>`, "header");
    const entry = /* @__PURE__ */ __name((name, desc, suffix = "") => html` <kc-ui-property-list-item name="${name}">
                ${desc} ${suffix}
            </kc-ui-property-list-item>`, "entry");
    const comments = Object.entries(board.title_block?.comment || {}).map(
      ([k, v]) => entry(`Comment ${k}`, v)
    );
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Info"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-property-list>
                        ${header("Page properties")}
                        ${entry("Size", ds.paper?.size)}
                        ${entry("Width", ds.width, "mm")}
                        ${entry("Height", ds.height, "mm")}
                        ${header("Board properties")}
                        ${entry("KiCad version", board.version)}
                        ${entry("Generator", board.generator)}
                        ${entry(
      "Thickness",
      board.general?.thickness ?? 1.6,
      "mm"
    )}
                        ${entry("Title", board.title_block?.title)}
                        ${entry("Date", board.title_block?.date)}
                        ${entry("Revision", board.title_block?.rev)}
                        ${entry("Company", board.title_block?.company)}
                        ${comments}
                        ${entry(
      "Dimensions",
      `${board_bbox.w.toFixed(1)} x
                            ${board_bbox.h.toFixed(1)} mm`
    )}
                        ${entry("Footprints", board.footprints.length)}
                        ${entry("Nets", board.nets.length)}
                        ${entry("Track segments", board.segments.length)}
                        ${entry("Vias", board.vias.length)}
                        ${entry("Zones", board.zones.length)}
                        ${entry(
      "Pad to mask clearance",
      board.setup?.pad_to_mask_clearance ?? 0,
      "mm"
    )}
                        ${entry(
      "Soldermask min width",
      board.setup?.solder_mask_min_width ?? 0,
      "mm"
    )}
                        ${entry(
      "Pad to paste clearance",
      board.setup?.pad_to_paste_clearance ?? 0,
      "mm"
    )}
                        ${entry(
      "Pad to paste clearance ratio",
      board.setup?.pad_to_paste_clearance_ratio ?? 0
    )}
                        ${entry(
      "Grid origin",
      `${board.setup?.grid_origin?.x ?? 0}, ${board.setup?.grid_origin?.y ?? 0}`
    )}
                    </kc-ui-property-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
window.customElements.define("kc-board-info-panel", KCBoardInfoPanelElement);

// kicanvas/elements/kc-board/layers-panel.ts
var KCBoardLayersPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCBoardLayersPanelElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                display: block;
                height: 100%;
                overflow-y: auto;
                overflow-x: hidden;
                user-select: none;
            }

            kc-ui-panel-title button {
                all: unset;
                flex-shrink: 0;
                margin-left: 1em;
                color: white;
                border: 0 none;
                background: transparent;
                padding: 0 0.25em 0 0.25em;
                margin-right: -0.25em;
                display: flex;
                align-items: center;
            }
        `
    ];
  }
  get items() {
    return Array.from(
      this.panel_body.querySelectorAll("kc-board-layer-control") ?? []
    );
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
    })();
  }
  initialContentCallback() {
    this.panel_body.addEventListener(
      KCBoardLayerControlElement.select_event,
      (e) => {
        const item = e.detail;
        for (const n of this.items) {
          n.layer_highlighted = false;
        }
        const layer = this.viewer.layers.by_name(item.layer_name);
        if (layer.highlighted) {
          this.viewer.layers.highlight(null);
        } else {
          this.viewer.layers.highlight(layer);
          layer.visible = true;
          item.layer_visible = true;
          item.layer_highlighted = true;
        }
        this.viewer.draw();
      }
    );
    this.panel_body.addEventListener(
      KCBoardLayerControlElement.visibility_event,
      (e) => {
        const item = e.detail;
        const layer = this.viewer.layers.by_name(item.layer_name);
        layer.visible = !layer.visible;
        item.layer_visible = layer.visible;
        this.presets_menu.deselect();
        this.viewer.draw();
      }
    );
    this.renderRoot.querySelector("button")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const ui_layers = this.viewer.layers.in_ui_order();
      if (this.items.some((n) => n.layer_visible)) {
        for (const l of ui_layers) {
          l.visible = false;
        }
      } else {
        for (const l of ui_layers) {
          l.visible = true;
        }
      }
      this.viewer.draw();
      this.presets_menu.deselect();
      this.update_item_states();
    });
    this.presets_menu.addEventListener("kc-ui-menu:select", (e) => {
      const item = e.detail;
      const ui_layers = this.viewer.layers.in_ui_order();
      switch (item.name) {
        case "all":
          for (const l of ui_layers) {
            l.visible = true;
          }
          break;
        case "front":
          for (const l of ui_layers) {
            l.visible = l.name.startsWith("F.") || l.name == "Edge.Cuts" /* edge_cuts */;
          }
          break;
        case "back":
          for (const l of ui_layers) {
            l.visible = l.name.startsWith("B.") || l.name == "Edge.Cuts" /* edge_cuts */;
          }
          break;
        case "copper":
          for (const l of ui_layers) {
            l.visible = l.name.includes(".Cu") || l.name == "Edge.Cuts" /* edge_cuts */;
          }
          break;
        case "outer-copper":
          for (const l of ui_layers) {
            l.visible = l.name == "F.Cu" /* f_cu */ || l.name == "B.Cu" /* b_cu */ || l.name == "Edge.Cuts" /* edge_cuts */;
          }
          break;
        case "inner-copper":
          for (const l of ui_layers) {
            l.visible = l.name.includes(".Cu") && !(l.name == "F.Cu" /* f_cu */ || l.name == "B.Cu" /* b_cu */) || l.name == "Edge.Cuts" /* edge_cuts */;
          }
          break;
        case "drawings":
          for (const l of ui_layers) {
            l.visible = !l.name.includes(".Cu") && !l.name.includes(".Mask") && !l.name.includes(".Paste") && !l.name.includes(".Adhes");
          }
      }
      this.viewer.draw();
      this.update_item_states();
    });
  }
  update_item_states() {
    for (const item of this.items) {
      const layer = this.viewer.layers.by_name(item.layer_name);
      item.layer_visible = layer?.visible ?? false;
      item.layer_highlighted = layer?.highlighted ?? false;
    }
  }
  render() {
    const layers = this.viewer.layers;
    const items = [];
    for (const layer of layers.in_ui_order()) {
      const visible = layer.visible ? "" : void 0;
      const css_color = layer.color.to_css();
      items.push(
        html`<kc-board-layer-control
                    layer-name="${layer.name}"
                    layer-color="${css_color}"
                    layer-visible="${visible}"></kc-board-layer-control>`
      );
    }
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Layers">
                    <button slot="actions" type="button">
                        <kc-ui-icon>visibility</kc-ui-icon>
                    </button>
                </kc-ui-panel-title>
                <kc-ui-panel-body>
                    ${items}
                    <kc-ui-panel-label>Presets</kc-ui-panel-label>
                    <kc-ui-menu id="presets" class="outline">
                        <kc-ui-menu-item name="all">All</kc-ui-menu-item>
                        <kc-ui-menu-item name="front">Front</kc-ui-menu-item>
                        <kc-ui-menu-item name="back">Back</kc-ui-menu-item>
                        <kc-ui-menu-item name="copper">Copper</kc-ui-menu-item>
                        <kc-ui-menu-item name="outer-copper">
                            Outer copper
                        </kc-ui-menu-item>
                        <kc-ui-menu-item name="inner-copper">
                            Inner copper
                        </kc-ui-menu-item>
                        <kc-ui-menu-item name="drawings">
                            Drawings
                        </kc-ui-menu-item>
                    </kc-ui-menu>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
__decorateClass([
  query("kc-ui-panel-body", true)
], KCBoardLayersPanelElement.prototype, "panel_body", 2);
__decorateClass([
  query("#presets", true)
], KCBoardLayersPanelElement.prototype, "presets_menu", 2);
var _KCBoardLayerControlElement = class _KCBoardLayerControlElement extends KCUIElement {
  static {
    __name(this, "KCBoardLayerControlElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      css`
            :host {
                box-sizing: border-box;
                padding: 0.1em 0.8em 0.1em 0.4em;
                color: white;
                text-align: left;
                display: flex;
                flex-direction: row;
                width: 100%;
                align-items: center;
            }

            button {
                all: unset;
                cursor: pointer;
                flex-shrink: 0;
                margin-left: 1em;
                color: white;
                border: 0 none;
                background: transparent;
                padding: 0 0.25em 0 0.25em;
                margin-right: -0.25em;
                display: flex;
                align-items: center;
            }

            .color {
                flex-shrink: 0;
                display: block;
                width: 1em;
                height: 1em;
                margin-right: 0.5em;
            }

            .name {
                display: block;
                flex-grow: 1;
            }

            .for-hidden {
                color: #888;
            }

            :host {
                background: var(--list-item-disabled-bg);
                color: var(--list-item-disabled-fg);
            }

            :host(:hover) {
                background: var(--list-item-hover-bg);
                color: var(--list-item-hover-fg);
            }

            :host(:hover) button {
                color: var(--list-item-bg);
            }

            :host(:hover) button:hover {
                color: var(--list-item-fg);
            }

            :host([layer-visible]) {
                background: var(--list-item-bg);
                color: var(--list-item-fg);
            }

            :host([layer-highlighted]) {
                background: var(--list-item-active-bg);
                color: var(--list-item-active-fg);
            }

            :host([layer-highlighted]:hover) button {
                color: var(--list-item-fg);
            }

            :host kc-ui-icon.for-visible,
            :host([layer-visible]) kc-ui-icon.for-hidden {
                display: none;
            }

            :host kc-ui-icon.for-hidden,
            :host([layer-visible]) kc-ui-icon.for-visible {
                display: revert;
            }
        `
    ];
  }
  static {
    this.select_event = "kicanvas:layer-control:select";
  }
  static {
    this.visibility_event = "kicanvas:layer-control:visibility";
  }
  initialContentCallback() {
    super.initialContentCallback();
    this.renderRoot.addEventListener("click", (e) => {
      e.stopPropagation();
      const button = e.target?.closest("button");
      let event_name;
      if (button) {
        event_name = _KCBoardLayerControlElement.visibility_event;
      } else {
        event_name = _KCBoardLayerControlElement.select_event;
      }
      this.dispatchEvent(
        new CustomEvent(event_name, {
          detail: this,
          bubbles: true
        })
      );
    });
  }
  render() {
    return html`<span
                class="color"
                style="background: ${this.layer_color};"></span>
            <span class="name">${this.layer_name}</span>
            <button type="button" name="${this.layer_name}">
                <kc-ui-icon class="for-visible">visibility</kc-ui-icon>
                <kc-ui-icon class="for-hidden">visibility_off</kc-ui-icon>
            </button>`;
  }
};
__decorateClass([
  attribute({ type: String })
], _KCBoardLayerControlElement.prototype, "layer_name", 2);
__decorateClass([
  attribute({ type: String })
], _KCBoardLayerControlElement.prototype, "layer_color", 2);
__decorateClass([
  attribute({ type: Boolean })
], _KCBoardLayerControlElement.prototype, "layer_highlighted", 2);
__decorateClass([
  attribute({ type: Boolean })
], _KCBoardLayerControlElement.prototype, "layer_visible", 2);
var KCBoardLayerControlElement = _KCBoardLayerControlElement;
window.customElements.define(
  "kc-board-layer-control",
  KCBoardLayerControlElement
);
window.customElements.define(
  "kc-board-layers-panel",
  KCBoardLayersPanelElement
);

// kicanvas/elements/kc-board/nets-panel.ts
var KCBoardNetsPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCBoardNetsPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
    })();
  }
  initialContentCallback() {
    this.addEventListener("kc-ui-menu:select", (e) => {
      const item = e.detail;
      const number = parseInt(item?.name, 10);
      if (!number) {
        return;
      }
      this.viewer.highlight_net(number);
    });
    this.search_input_elm.addEventListener("input", (e) => {
      this.item_filter_elem.filter_text = this.search_input_elm.value ?? null;
    });
  }
  render() {
    const board = this.viewer.board;
    const nets = [];
    for (const net of board.nets) {
      nets.push(
        html`<kc-ui-menu-item
                    name="${net.number}"
                    data-match-text="${net.number} ${net.name}">
                    <span class="very-narrow"> ${net.number} </span>
                    <span>${net.name}</span>
                </kc-ui-menu-item>`
      );
    }
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Nets"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-text-filter-input></kc-ui-text-filter-input>
                    <kc-ui-filtered-list>
                        <kc-ui-menu class="outline">${nets}</kc-ui-menu>
                    </kc-ui-filtered-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
__decorateClass([
  query("kc-ui-text-filter-input", true)
], KCBoardNetsPanelElement.prototype, "search_input_elm", 2);
__decorateClass([
  query("kc-ui-filtered-list", true)
], KCBoardNetsPanelElement.prototype, "item_filter_elem", 2);
window.customElements.define("kc-board-nets-panel", KCBoardNetsPanelElement);

// kicanvas/elements/kc-board/objects-panel.ts
var KCBoardObjectsPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCBoardObjectsPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
      this.setup_events();
    })();
  }
  setup_events() {
    delegate(this.renderRoot, "kc-ui-range", "kc-ui-range:input", (e) => {
      const control = e.target;
      const opacity = control.valueAsNumber;
      switch (control.name) {
        case "tracks":
          this.viewer.track_opacity = opacity;
          break;
        case "vias":
          this.viewer.via_opacity = opacity;
          break;
        case "pads":
          this.viewer.pad_opacity = opacity;
          break;
        case "holes":
          this.viewer.pad_hole_opacity = opacity;
          break;
        case "zones":
          this.viewer.zone_opacity = opacity;
          break;
        case "grid":
          this.viewer.grid_opacity = opacity;
          break;
        case "page":
          this.viewer.page_opacity = opacity;
          break;
      }
    });
  }
  render() {
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Objects"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <kc-ui-control-list>
                        <kc-ui-control>
                            <label>Tracks</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="tracks"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Vias</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="vias"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Pads</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="pads"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Through holes</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="holes"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Zones</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="zones"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Grid</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="grid"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Page</label>
                            <kc-ui-range
                                min="0"
                                max="1.0"
                                step="0.01"
                                value="1"
                                name="page"></kc-ui-range>
                        </kc-ui-control>
                    </kc-ui-control-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
window.customElements.define(
  "kc-board-objects-panel",
  KCBoardObjectsPanelElement
);

// kicanvas/elements/kc-board/properties-panel.ts
var KCBoardPropertiesPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCBoardPropertiesPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
      this.setup_events();
    })();
  }
  setup_events() {
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
        this.selected_item = e.detail.item;
        this.update();
      })
    );
  }
  render() {
    const header = /* @__PURE__ */ __name((name) => html`<kc-ui-property-list-item class="label" name="${name}">
            </kc-ui-property-list-item>`, "header");
    const entry = /* @__PURE__ */ __name((name, desc, suffix = "") => html`<kc-ui-property-list-item name="${name}">
                ${desc ?? ""} ${suffix}
            </kc-ui-property-list-item>`, "entry");
    const checkbox = /* @__PURE__ */ __name((value) => value ? html`<kc-ui-icon>check</kc-ui-icon>` : html`<kc-ui-icon>close</kc-ui-icon>`, "checkbox");
    let entries;
    if (!this.selected_item) {
      entries = header("No item selected");
    } else {
      const itm = this.selected_item;
      const properties = Object.entries(itm.properties).map(
        ([k, prop]) => {
          return entry(k, prop.value);
        }
      );
      entries = html`
                ${header("Basic properties")}
                ${entry("X", itm.at.position.x.toFixed(4), "mm")}
                ${entry("Y", itm.at.position.y.toFixed(4), "mm")}
                ${entry("Orientation", itm.at.rotation, "\xB0")}
                ${entry("Layer", itm.layer)} ${header("Footprint properties")}
                ${entry("Reference", itm.reference)}
                ${entry("Value", itm.value)}
                ${entry(
        "Type",
        itm.attr.through_hole ? "through hole" : itm.attr.smd ? "smd" : "unspecified"
      )}
                ${entry("Pads", itm.pads.length)}
                ${entry("Library link", itm.library_link)}
                ${entry("Description", itm.descr)}
                ${entry("Keywords", itm.tags)} ${properties}
                ${header("Fabrication attributes")}
                ${entry("Not in schematic", checkbox(itm.attr.board_only))}
                ${entry(
        "Exclude from position files",
        checkbox(itm.attr.exclude_from_pos_files)
      )}
                ${entry(
        "Exclude from BOM",
        checkbox(itm.attr.exclude_from_bom)
      )}
                ${header("Overrides")}
                ${entry(
        "Exempt from courtyard requirement",
        checkbox(itm.attr.allow_missing_courtyard)
      )}
                ${entry("Clearance", itm.clearance ?? 0, "mm")}
                ${entry(
        "Solderpaste margin",
        itm.solder_paste_margin ?? 0,
        "mm"
      )}
                ${entry(
        "Solderpaste margin ratio",
        itm.solder_paste_ratio ?? 0
      )}
                ${entry("Zone connection", itm.zone_connect ?? "inherited")}
            `;
    }
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Properties"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-property-list> ${entries} </kc-ui-property-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
window.customElements.define(
  "kc-board-properties-panel",
  KCBoardPropertiesPanelElement
);

// kicanvas/elements/kc-board/app.ts
var KCBoardAppElement = class extends KCViewerAppElement {
  static {
    __name(this, "KCBoardAppElement");
  }
  on_viewer_select(item, previous) {
    if (item && item == previous) {
      this.change_activity("properties");
    }
  }
  can_load(src) {
    return src.document instanceof KicadPCB;
  }
  make_viewer_element() {
    return html`<kc-board-viewer></kc-board-viewer>`;
  }
  make_activities() {
    return [
      // Layers
      html`<kc-ui-activity slot="activities" name="Layers" icon="layers">
                <kc-board-layers-panel></kc-board-layers-panel>
            </kc-ui-activity>`,
      // Objects
      html`<kc-ui-activity
                slot="activities"
                name="Objects"
                icon="category">
                <kc-board-objects-panel></kc-board-objects-panel>
            </kc-ui-activity>`,
      // Footprints
      html`<kc-ui-activity
                slot="activities"
                name="Footprints"
                icon="memory">
                <kc-board-footprints-panel></kc-board-footprints-panel>
            </kc-ui-activity>`,
      // Nets
      html`<kc-ui-activity slot="activities" name="Nets" icon="hub">
                <kc-board-nets-panel></kc-board-nets-panel>
            </kc-ui-activity>`,
      // Properties
      html`<kc-ui-activity
                slot="activities"
                name="Properties"
                icon="list">
                <kc-board-properties-panel></kc-board-properties-panel>
            </kc-ui-activity>`,
      // Board info
      html`<kc-ui-activity
                slot="activities"
                name="Board info"
                icon="info">
                <kc-board-info-panel></kc-board-info-panel>
            </kc-ui-activity>`
    ];
  }
};
window.customElements.define("kc-board-app", KCBoardAppElement);

// graphics/canvas2d.ts
var Canvas2DRenderer = class extends Renderer {
  /**
   * Create a new Canvas2DRenderer
   */
  constructor(canvas) {
    super(canvas);
    /** Graphics layers */
    this.#layers = [];
    /** State */
    this.state = new RenderStateStack();
  }
  static {
    __name(this, "Canvas2DRenderer");
  }
  #layers;
  /** The layer currently being drawn to. */
  #active_layer;
  /**
   * Create and configure the 2D Canvas context.
   */
  async setup() {
    const ctx2d = this.canvas.getContext("2d", {
      alpha: false,
      desynchronized: true
    });
    if (ctx2d == null) {
      throw new Error("Unable to create Canvas2d context");
    }
    this.ctx2d = ctx2d;
    this.update_canvas_size();
  }
  dispose() {
    this.ctx2d = void 0;
    for (const layer of this.#layers) {
      layer.dispose();
    }
  }
  update_canvas_size() {
    const dpr = window.devicePixelRatio;
    const rect = this.canvas.getBoundingClientRect();
    const pixel_w = Math.round(rect.width * dpr);
    const pixel_h = Math.round(rect.height * dpr);
    if (this.canvas.width != pixel_w || this.canvas.height != pixel_h) {
      this.canvas.width = pixel_w;
      this.canvas.height = pixel_h;
    }
  }
  clear_canvas() {
    this.update_canvas_size();
    this.ctx2d.setTransform();
    this.ctx2d.fillStyle = this.background_color.to_css();
    this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.ctx2d.lineCap = "round";
    this.ctx2d.lineJoin = "round";
  }
  start_layer(name) {
    this.#active_layer = new Canvas2dRenderLayer(this, name);
  }
  end_layer() {
    if (!this.#active_layer) {
      throw new Error("No active layer");
    }
    this.#layers.push(this.#active_layer);
    this.#active_layer = null;
    return this.#layers.at(-1);
  }
  arc(arc_or_center, radius, start_angle, end_angle, width, color) {
    super.prep_arc(
      arc_or_center,
      radius,
      start_angle,
      end_angle,
      width,
      color
    );
  }
  circle(circle_or_center, radius, color) {
    const circle = super.prep_circle(circle_or_center, radius, color);
    if (!circle.color || circle.color.is_transparent_black) {
      return;
    }
    const css_color = circle.color.to_css();
    const path = new Path2D();
    path.arc(
      circle.center.x,
      circle.center.y,
      circle.radius,
      0,
      Math.PI * 2
    );
    this.#active_layer.commands.push(
      new DrawCommand(path, css_color, null, 0)
    );
  }
  line(line_or_points, width, color) {
    const line = super.prep_line(line_or_points, width, color);
    if (!line.color || line.color.is_transparent_black) {
      return;
    }
    const css_color = line.color.to_css();
    const path = new Path2D();
    let started = false;
    for (const point of line.points) {
      if (!started) {
        path.moveTo(point.x, point.y);
        started = true;
      } else {
        path.lineTo(point.x, point.y);
      }
    }
    this.#active_layer.commands.push(
      new DrawCommand(path, null, css_color, line.width)
    );
  }
  polygon(polygon_or_points, color) {
    const polygon = super.prep_polygon(polygon_or_points, color);
    if (!polygon.color || polygon.color.is_transparent_black) {
      return;
    }
    const css_color = polygon.color.to_css();
    const path = new Path2D();
    let started = false;
    for (const point of polygon.points) {
      if (!started) {
        path.moveTo(point.x, point.y);
        started = true;
      } else {
        path.lineTo(point.x, point.y);
      }
    }
    path.closePath();
    this.#active_layer.commands.push(
      new DrawCommand(path, css_color, null, 0)
    );
  }
  get layers() {
    const layers = this.#layers;
    return {
      *[Symbol.iterator]() {
        for (const layer of layers) {
          yield layer;
        }
      }
    };
  }
  remove_layer(layer) {
    const idx = this.#layers.indexOf(layer);
    if (idx == -1) {
      return;
    }
    this.#layers.splice(idx, 1);
  }
};
var DrawCommand = class {
  constructor(path, fill, stroke, stroke_width) {
    this.path = path;
    this.fill = fill;
    this.stroke = stroke;
    this.stroke_width = stroke_width;
    this.path_count = 1;
  }
  static {
    __name(this, "DrawCommand");
  }
  render(ctx) {
    ctx.fillStyle = this.fill ?? "black";
    ctx.strokeStyle = this.stroke ?? "black";
    ctx.lineWidth = this.stroke_width;
    if (this.fill) {
      ctx.fill(this.path);
    }
    if (this.stroke) {
      ctx.stroke(this.path);
    }
  }
};
var Canvas2dRenderLayer = class extends RenderLayer {
  constructor(renderer, name, commands = []) {
    super(renderer, name);
    this.renderer = renderer;
    this.name = name;
    this.commands = commands;
  }
  static {
    __name(this, "Canvas2dRenderLayer");
  }
  dispose() {
    this.clear();
  }
  clear() {
    this.commands = [];
  }
  push_path(path, fill, stroke, stroke_width) {
    const last_command = this.commands.at(-1);
    if (last_command && (last_command.path_count < 20, last_command.fill == fill && last_command.stroke == stroke && last_command.stroke_width == stroke_width)) {
      last_command.path.addPath(path);
      last_command.path_count++;
    } else {
      this.commands.push(
        new DrawCommand(path, fill, stroke, stroke_width)
      );
    }
  }
  render(transform, depth, global_alpha = 1) {
    const ctx = this.renderer.ctx2d;
    if (!ctx) {
      throw new Error("No CanvasRenderingContext2D!");
    }
    ctx.save();
    ctx.globalCompositeOperation = this.composite_operation;
    ctx.globalAlpha = global_alpha;
    const accumulated_transform = Matrix3.from_DOMMatrix(
      ctx.getTransform()
    );
    accumulated_transform.multiply_self(transform);
    ctx.setTransform(accumulated_transform.to_DOMMatrix());
    for (const command of this.commands) {
      command.render(ctx);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.restore();
  }
};

// viewers/schematic/layers.ts
var LayerNames2 = ((LayerNames3) => {
  LayerNames3["interactive"] = ":Interactive";
  LayerNames3["marks"] = ":Marks";
  LayerNames3["symbol_field"] = ":Symbol:Field";
  LayerNames3["label"] = ":Label";
  LayerNames3["junction"] = ":Junction";
  LayerNames3["wire"] = ":Wire";
  LayerNames3["symbol_foreground"] = ":Symbol:Foreground";
  LayerNames3["notes"] = ":Notes";
  LayerNames3["bitmap"] = ":Bitmap";
  LayerNames3["symbol_pin"] = ":Symbol:Pin";
  LayerNames3["symbol_background"] = ":Symbol:Background";
  LayerNames3[LayerNames3["drawing_sheet"] = ":DrawingSheet" /* drawing_sheet */] = "drawing_sheet";
  LayerNames3[LayerNames3["grid"] = ":Grid" /* grid */] = "grid";
  return LayerNames3;
})(LayerNames2 || {});
var LayerSet4 = class extends ViewLayerSet {
  constructor(theme3) {
    super();
    this.theme = theme3;
    for (const name of Object.values(LayerNames2)) {
      this.add(new ViewLayer(this, name));
    }
    this.by_name(":Interactive" /* interactive */).visible = false;
    this.by_name(":Interactive" /* interactive */).interactive = true;
    this.by_name(LayerNames2.drawing_sheet).color = this.theme["worksheet"] ?? Color.white;
  }
  static {
    __name(this, "LayerSet");
  }
  *interactive_layers() {
    yield this.by_name(":Interactive" /* interactive */);
  }
};

// viewers/schematic/painters/base.ts
var BaseSchematicPainter = class extends DocumentPainter {
  static {
    __name(this, "BaseSchematicPainter");
  }
};
var SchematicItemPainter = class extends ItemPainter {
  static {
    __name(this, "SchematicItemPainter");
  }
  get theme() {
    return this.view_painter.theme;
  }
  get is_dimmed() {
    return this.view_painter.current_symbol?.dnp ?? false;
  }
  dim_color(color) {
    color = color.desaturate();
    return color.mix(this.theme.background, 0.5);
  }
  dim_if_needed(color) {
    return this.is_dimmed ? this.dim_color(color) : color;
  }
  determine_stroke(layer, item) {
    const width = item.stroke?.width || this.gfx.state.stroke_width;
    if (width < 0) {
      return { width: 0, color: null };
    }
    const stroke_type = item.stroke?.type ?? "none";
    if (stroke_type == "none") {
      return { width: 0, color: null };
    }
    const default_stroke = layer.name == ":Symbol:Foreground" /* symbol_foreground */ ? this.theme.component_outline : this.theme.note;
    const color = this.dim_if_needed(item.stroke?.color ?? default_stroke);
    return { width, color };
  }
  determine_fill(layer, item) {
    const fill_type = item.fill?.type ?? "none";
    if (fill_type == "none") {
      return null;
    }
    if (fill_type == "background" && layer.name != ":Symbol:Background" /* symbol_background */) {
      return null;
    }
    let color;
    switch (fill_type) {
      case "background":
        color = this.theme.component_body;
        break;
      case "outline":
        color = this.theme.component_outline;
        break;
      case "color":
        color = item.fill.color;
        break;
    }
    return this.dim_if_needed(color);
  }
};

// viewers/schematic/painters/label.ts
var LabelPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [];
  }
  static {
    __name(this, "LabelPainter");
  }
  layers_for(item) {
    return [":Label" /* label */];
  }
  paint(layer, l) {
    if (l.effects.hide) {
      return;
    }
    const schtext = new SchText(l.shown_text);
    schtext.apply_at(l.at);
    schtext.apply_effects(l.effects);
    this.after_apply(l, schtext);
    if (l.at.rotation == 0 || l.at.rotation == 180) {
      schtext.text_angle.degrees = 0;
    } else if (l.at.rotation == 90 || l.at.rotation == 270) {
      schtext.text_angle.degrees = 90;
    }
    const pos = schtext.text_pos.add(
      this.get_schematic_text_offset(l, schtext)
    );
    this.gfx.state.push();
    this.gfx.state.stroke = this.color;
    this.gfx.state.fill = this.color;
    StrokeFont.default().draw(
      this.gfx,
      schtext.shown_text,
      pos,
      schtext.attributes
    );
    const shape_pts = this.create_shape(l, schtext);
    if (shape_pts) {
      this.gfx.line(shape_pts, schtext.attributes.stroke_width / 1e4);
    }
    this.gfx.state.pop();
  }
  create_shape(l, schtext) {
    return [];
  }
  get color() {
    return new Color(1, 0, 1, 1);
  }
  after_apply(l, schtext) {
  }
  get_text_offset(schtext) {
    return Math.round(
      DefaultValues.text_offset_ratio * schtext.text_size.x
    );
  }
  get_box_expansion(schtext) {
    return Math.round(
      DefaultValues.label_size_ratio * schtext.text_size.y
    );
  }
  /**
   * The offset between the schematic item's position and the actual text
   * position
   *
   * This takes into account orientation and any additional distance to make
   * the text readable (such as offsetting it from the top of a wire).
   */
  get_schematic_text_offset(l, schtext) {
    const dist = Math.round(
      this.get_text_offset(schtext) + schtext.get_effective_text_thickness()
    );
    if (schtext.text_angle.is_vertical) {
      return new Vec2(-dist, 0);
    } else {
      return new Vec2(0, -dist);
    }
  }
};
var NetLabelPainter = class extends LabelPainter {
  constructor() {
    super(...arguments);
    this.classes = [NetLabel];
  }
  static {
    __name(this, "NetLabelPainter");
  }
  get color() {
    return this.theme.label_local;
  }
};
var GlobalLabelPainter = class extends LabelPainter {
  constructor() {
    super(...arguments);
    this.classes = [GlobalLabel];
  }
  static {
    __name(this, "GlobalLabelPainter");
  }
  get color() {
    return this.theme.label_global;
  }
  get_schematic_text_offset(l, schtext) {
    const label = l;
    const text_height = schtext.text_size.y;
    let horz = this.get_box_expansion(schtext);
    let vert = text_height * 0.0715;
    if (["input", "bidirectional", "tri_state"].includes(label.shape)) {
      horz += text_height * 0.75;
    }
    horz = Math.round(horz);
    vert = Math.round(vert);
    switch (l.at.rotation) {
      case 0:
        return new Vec2(horz, vert);
      case 90:
        return new Vec2(vert, -horz);
      case 180:
        return new Vec2(-horz, vert);
      case 270:
        return new Vec2(vert, horz);
      default:
        throw new Error(`Unexpected label rotation ${l.at.rotation}`);
    }
  }
  /**
   * Creates the label's outline shape
   * Adapted from SCH_GLOBALLABEL::CreateGraphicShape
   */
  create_shape(l, schtext) {
    const label = l;
    const pos = schtext.text_pos;
    const angle = Angle.from_degrees(l.at.rotation + 180);
    const text_height = schtext.text_size.y;
    const margin = this.get_box_expansion(schtext);
    const half_size = text_height / 2 + margin;
    const symbol_length = schtext.get_text_box().w + 2 * margin;
    const stroke_width = schtext.attributes.stroke_width;
    const x = symbol_length + stroke_width + 3;
    const y = half_size + stroke_width + 3;
    let pts = [
      new Vec2(0, 0),
      new Vec2(0, -y),
      new Vec2(-x, -y),
      new Vec2(-x, 0),
      new Vec2(-x, y),
      new Vec2(0, y),
      new Vec2(0, 0)
    ];
    const offset = new Vec2();
    switch (label.shape) {
      case "input":
        offset.x = -half_size;
        pts[0].x += half_size;
        pts[6].x += half_size;
        break;
      case "output":
        pts[3].x -= half_size;
        break;
      case "bidirectional":
      case "tri_state":
        offset.x = -half_size;
        pts[0].x += half_size;
        pts[6].x += half_size;
        pts[3].x -= half_size;
        break;
      default:
        break;
    }
    pts = pts.map((pt) => {
      return pt.add(offset).rotate(angle).add(pos).multiply(1 / 1e4);
    });
    return pts;
  }
};
var HierarchicalLabelPainter = class extends LabelPainter {
  constructor() {
    super(...arguments);
    this.classes = [HierarchicalLabel];
  }
  static {
    __name(this, "HierarchicalLabelPainter");
  }
  get color() {
    return this.theme.label_hier;
  }
  after_apply(l, schtext) {
    schtext.v_align = "center";
  }
  get_schematic_text_offset(l, schtext) {
    const dist = Math.round(
      this.get_text_offset(schtext) + schtext.text_width
    );
    switch (l.at.rotation) {
      case 0:
        return new Vec2(dist, 0);
      case 90:
        return new Vec2(0, -dist);
      case 180:
        return new Vec2(-dist, 0);
      case 270:
        return new Vec2(0, dist);
      default:
        throw new Error(`Unexpected label rotation ${l.at.rotation}`);
    }
  }
  /**
   * Creates the label's outline shape
   * Adapted from SCH_HIERLABEL::CreateGraphicShape and TemplateShape.
   */
  create_shape(label, schtext) {
    const pos = schtext.text_pos;
    const angle = Angle.from_degrees(label.at.rotation);
    const s = schtext.text_width;
    let pts;
    switch (label.shape) {
      case "output":
        pts = [
          new Vec2(0, s / 2),
          new Vec2(s / 2, s / 2),
          new Vec2(s, 0),
          new Vec2(s / 2, -s / 2),
          new Vec2(0, -s / 2),
          new Vec2(0, s / 2)
        ];
        break;
      case "input":
        pts = [
          new Vec2(s, s / 2),
          new Vec2(s / 2, s / 2),
          new Vec2(0, 0),
          new Vec2(s / 2, -s / 2),
          new Vec2(s, -s / 2),
          new Vec2(s, s / 2)
        ];
        break;
      case "bidirectional":
      case "tri_state":
        pts = [
          new Vec2(s / 2, s / 2),
          new Vec2(s, 0),
          new Vec2(s / 2, -s / 2),
          new Vec2(0, 0),
          new Vec2(s / 2, s / 2)
        ];
        break;
      case "passive":
      default:
        pts = [
          new Vec2(0, s / 2),
          new Vec2(s, s / 2),
          new Vec2(s, -s / 2),
          new Vec2(0, -s / 2),
          new Vec2(0, s / 2)
        ];
        break;
    }
    pts = pts.map((pt) => {
      return pt.rotate(angle).add(pos).multiply(1 / 1e4);
    });
    return pts;
  }
};
var DirectiveLabelPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [DirectiveLabel];
  }
  static {
    __name(this, "DirectiveLabelPainter");
  }
  get default_shape_color() {
    return this.theme.netclass_flag;
  }
  get default_property_color() {
    return this.theme.netclass_flag;
  }
  layers_for(item) {
    return [":Label" /* label */];
  }
  paint(layer, item) {
    this.paint_shape(layer, item);
    for (const prop of item.properties) {
      this.paint_property(layer, prop);
    }
  }
  paint_shape(layer, item) {
    const color = item.effects.font.color.is_transparent_black ? this.default_shape_color : item.effects.font.color;
    const pin_length = item.length;
    const symbol_size = 20 * 0.0254;
    this.gfx.state.push();
    this.gfx.state.matrix.translate_self(
      item.at.position.x,
      item.at.position.y
    );
    this.gfx.state.matrix.rotate_self(Angle.from_degrees(item.at.rotation));
    this.gfx.state.stroke = color;
    const shape = item.shape;
    if (shape === "dot") {
      const shape_size = symbol_size * 0.7;
      this.gfx.line([
        new Vec2(0, 0),
        new Vec2(0, -(pin_length - shape_size))
      ]);
      this.gfx.circle(
        new Circle3(new Vec2(0, -pin_length), shape_size, color)
      );
    } else if (shape === "round") {
      const shape_size = symbol_size;
      const center = new Vec2(0, -pin_length);
      const width = this.gfx.state.stroke_width;
      this.gfx.line([
        new Vec2(0, 0),
        new Vec2(0, -(pin_length - shape_size))
      ]);
      this.gfx.arc(
        new Arc4(
          center,
          shape_size,
          new Angle(0),
          new Angle(Math.PI * 2),
          width,
          color
        )
      );
    } else if (shape === "diamond") {
      const shape_size = symbol_size;
      const origin_pts = [
        new Vec2(0, 0),
        new Vec2(0, pin_length - shape_size),
        new Vec2(-2 * shape_size, pin_length),
        new Vec2(0, pin_length + shape_size),
        new Vec2(2 * shape_size, pin_length),
        new Vec2(0, pin_length - shape_size),
        new Vec2(0, 0)
      ];
      const pts = origin_pts.map((pt) => {
        return new Vec2(pt.x, -pt.y);
      });
      this.gfx.line(pts);
    } else if (shape === "rectangle") {
      const shape_size = symbol_size * 0.8;
      const origin_pts = [
        new Vec2(0, 0),
        new Vec2(0, pin_length - shape_size),
        new Vec2(-2 * shape_size, pin_length - shape_size),
        new Vec2(-2 * shape_size, pin_length + shape_size),
        new Vec2(2 * shape_size, pin_length + shape_size),
        new Vec2(2 * shape_size, pin_length - shape_size),
        new Vec2(0, pin_length - shape_size),
        new Vec2(0, 0)
      ];
      const pts = origin_pts.map((pt) => {
        return new Vec2(pt.x, -pt.y);
      });
      this.gfx.line(pts);
    }
    this.gfx.state.pop();
  }
  paint_property(layer, prop) {
    const color = prop.effects.font.color.is_transparent_black ? this.default_property_color : prop.effects.font.color;
    const schtext = new SchText(prop.shown_text);
    schtext.apply_at(prop.at);
    schtext.apply_effects(prop.effects);
    if (prop.at.rotation == 0 || prop.at.rotation == 180) {
      schtext.text_angle.degrees = 0;
    } else if (prop.at.rotation == 90 || prop.at.rotation == 270) {
      schtext.text_angle.degrees = 90;
    }
    this.gfx.state.push();
    this.gfx.state.stroke = color;
    this.gfx.state.fill = color;
    StrokeFont.default().draw(
      this.gfx,
      schtext.shown_text,
      schtext.text_pos,
      schtext.attributes
    );
    this.gfx.state.pop();
  }
};

// viewers/schematic/painters/pin.ts
var PinPainter = class _PinPainter extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [PinInstance];
  }
  static {
    __name(this, "PinPainter");
  }
  layers_for(item) {
    return [
      ":Symbol:Pin" /* symbol_pin */,
      ":Symbol:Foreground" /* symbol_foreground */,
      ":Interactive" /* interactive */
    ];
  }
  paint(layer, p) {
    if (p.definition.hide) {
      return;
    }
    const pin = {
      pin: p,
      def: p.definition,
      position: p.definition.at.position.copy(),
      orientation: angle_to_orientation(p.definition.at.rotation)
    };
    const current_symbol_transform = this.view_painter.current_symbol_transform;
    const color = this.dim_if_needed(this.theme.pin);
    _PinPainter.apply_symbol_transformations(pin, current_symbol_transform);
    this.gfx.state.push();
    this.gfx.state.matrix = Matrix3.identity();
    this.gfx.state.stroke = color;
    if (layer.name == ":Symbol:Pin" /* symbol_pin */ || layer.name == ":Interactive" /* interactive */) {
      this.draw_pin_shape(this.gfx, pin);
    }
    if (layer.name == ":Symbol:Foreground" /* symbol_foreground */) {
      this.draw_name_and_number(this.gfx, pin);
    }
    this.gfx.state.pop();
  }
  /**
   * Applies symbol transformation (rotation, position, mirror).
   *
   * KiCad doesn't directly set the transformation for symbol items, instead,
   * it indirectly sets them through individual rotations and transforms.
   * See KiCad's sch_painter.cpp::orientSymbol.
   */
  static apply_symbol_transformations(pin, transforms) {
    for (let i = 0; i < transforms.rotations; i++) {
      this.rotate(pin, new Vec2(0, 0), true);
    }
    if (transforms.mirror_x) {
      this.mirror_vertically(pin, new Vec2(0, 0));
    }
    if (transforms.mirror_y) {
      this.mirror_horizontally(pin, new Vec2(0, 0));
    }
    const parent_pos = transforms.position.multiply(new Vec2(1, -1));
    pin.position = pin.position.add(parent_pos).multiply(new Vec2(1, -1));
  }
  /**
   * Rotate the pin
   *
   * Based on LIB_PIN::Rotate, used by apply_symbol_transformations.
   */
  static rotate(pin, center, ccw = false) {
    const angle = Angle.from_degrees(ccw ? -90 : 90);
    pin.position = angle.rotate_point(pin.position, center);
    if (ccw) {
      switch (pin.orientation) {
        case "right":
          pin.orientation = "up";
          break;
        case "up":
          pin.orientation = "left";
          break;
        case "left":
          pin.orientation = "down";
          break;
        case "down":
          pin.orientation = "right";
          break;
      }
    } else {
      switch (pin.orientation) {
        case "right":
          pin.orientation = "down";
          break;
        case "down":
          pin.orientation = "left";
          break;
        case "left":
          pin.orientation = "up";
          break;
        case "up":
          pin.orientation = "right";
          break;
      }
    }
  }
  static mirror_horizontally(pin, center) {
    pin.position.x -= center.x;
    pin.position.x *= -1;
    pin.position.x += center.x;
    if (pin.orientation == "right") {
      pin.orientation = "left";
    } else if (pin.orientation == "left") {
      pin.orientation = "right";
    }
  }
  static mirror_vertically(pin, center) {
    pin.position.y -= center.y;
    pin.position.y *= -1;
    pin.position.y += center.y;
    if (pin.orientation == "up") {
      pin.orientation = "down";
    } else if (pin.orientation == "down") {
      pin.orientation = "up";
    }
  }
  /**
   * Draws the pin's shape- the pin line along with any additional decoration
   * depending on pin type.
   */
  draw_pin_shape(gfx, pin) {
    const { p0, dir } = PinShapeInternals.stem(
      pin.position,
      pin.orientation,
      pin.def.length
    );
    PinShapeInternals.draw(
      gfx,
      pin.def.type,
      pin.def.shape,
      pin.position,
      p0,
      dir
    );
  }
  /**
   * Draw the pin's name and number, if they're visible.
   */
  draw_name_and_number(gfx, pin) {
    const def = pin.def;
    const libsym = pin.pin.parent.lib_symbol;
    const name = pin.pin.alternate ?? def.name.text;
    const number = def.number.text;
    const pin_length = def.length;
    const hide_pin_names = libsym.pin_names.hide || !name || name == "~";
    const hide_pin_numbers = libsym.pin_numbers.hide || !number || number == "~";
    const pin_thickness = DefaultValues.line_width;
    const pin_name_offset = libsym.pin_names.offset;
    const text_margin = 0.6096 * DefaultValues.text_offset_ratio;
    const num_thickness = def.number.effects.font.thickness || pin_thickness;
    const name_thickness = def.number.effects.font.thickness || pin_thickness;
    let name_placement;
    let num_placement;
    if (pin_name_offset > 0) {
      name_placement = hide_pin_names ? void 0 : PinLabelInternals.place_inside(
        pin_name_offset,
        name_thickness,
        pin_length,
        pin.orientation
      );
      num_placement = hide_pin_numbers ? void 0 : PinLabelInternals.place_above(
        text_margin,
        pin_thickness,
        num_thickness,
        pin_length,
        pin.orientation
      );
    } else {
      name_placement = hide_pin_names ? void 0 : PinLabelInternals.place_above(
        text_margin,
        pin_thickness,
        name_thickness,
        pin_length,
        pin.orientation
      );
      num_placement = hide_pin_numbers ? void 0 : PinLabelInternals.place_below(
        text_margin,
        pin_thickness,
        name_thickness,
        pin_length,
        pin.orientation
      );
    }
    if (name_placement) {
      PinLabelInternals.draw(
        gfx,
        name,
        pin.position,
        name_placement,
        def.name.effects,
        gfx.state.stroke
      );
    }
    if (num_placement) {
      PinLabelInternals.draw(
        gfx,
        number,
        pin.position,
        num_placement,
        def.number.effects,
        gfx.state.stroke
      );
    }
  }
};
function angle_to_orientation(angle_deg) {
  switch (angle_deg) {
    case 0:
      return "right";
    case 90:
      return "up";
    case 180:
      return "left";
    case 270:
      return "down";
    default:
      throw new Error(`Unexpected pin angle ${angle_deg}`);
  }
}
__name(angle_to_orientation, "angle_to_orientation");
var PinShapeInternals = {
  stem(position, orientation, length2) {
    const p0 = new Vec2();
    const dir = new Vec2();
    switch (orientation) {
      case "up":
        p0.set(position.x, position.y - length2);
        dir.set(0, 1);
        break;
      case "down":
        p0.set(position.x, position.y + length2);
        dir.set(0, -1);
        break;
      case "left":
        p0.set(position.x - length2, position.y);
        dir.set(1, 0);
        break;
      case "right":
        p0.set(position.x + length2, position.y);
        dir.set(-1, 0);
        break;
    }
    return { p0, dir };
  },
  draw(gfx, electrical_type, shape, position, p0, dir) {
    const radius = DefaultValues.pinsymbol_size;
    const diam = radius * 2;
    const nc_radius = DefaultValues.target_pin_radius;
    if (electrical_type == "no_connect") {
      gfx.line([p0, position]);
      gfx.line([
        position.add(new Vec2(-nc_radius, -nc_radius)),
        position.add(new Vec2(nc_radius, nc_radius))
      ]);
      gfx.line([
        position.add(new Vec2(nc_radius, -nc_radius)),
        position.add(new Vec2(-nc_radius, nc_radius))
      ]);
      return;
    }
    const clock_notch = /* @__PURE__ */ __name(() => {
      if (!dir.y) {
        gfx.line([
          p0.add(new Vec2(0, radius)),
          p0.add(new Vec2(-dir.x * radius, 0)),
          p0.add(new Vec2(0, -radius))
        ]);
      } else {
        gfx.line([
          p0.add(new Vec2(radius, 0)),
          p0.add(new Vec2(0, -dir.y * radius)),
          p0.add(new Vec2(-radius, 0))
        ]);
      }
    }, "clock_notch");
    const low_in_tri = /* @__PURE__ */ __name(() => {
      if (!dir.y) {
        gfx.line([
          p0.add(new Vec2(dir.x, 0).multiply(diam)),
          p0.add(new Vec2(dir.x, -1).multiply(diam)),
          p0
        ]);
      } else {
        gfx.line([
          p0.add(new Vec2(0, dir.y).multiply(diam)),
          p0.add(new Vec2(-1, dir.y).multiply(diam)),
          p0
        ]);
      }
    }, "low_in_tri");
    switch (shape) {
      case "line":
        gfx.line([p0, position]);
        return;
      case "inverted":
        gfx.arc(p0.add(dir.multiply(radius)), radius);
        gfx.line([p0.add(dir.multiply(diam)), position]);
        return;
      case "inverted_clock":
        gfx.arc(p0.add(dir.multiply(radius)), radius);
        gfx.line([p0.add(dir.multiply(diam)), position]);
        clock_notch();
        return;
      case "clock":
        gfx.line([p0, position]);
        clock_notch();
        return;
      case "clock_low":
      case "edge_clock_high":
        gfx.line([p0, position]);
        clock_notch();
        low_in_tri();
        break;
      case "input_low":
        gfx.line([p0, position]);
        low_in_tri();
        break;
      case "output_low":
        gfx.line([p0, position]);
        if (!dir.y) {
          gfx.line([
            p0.sub(new Vec2(0, diam)),
            p0.add(new Vec2(dir.x * diam, 0))
          ]);
        } else {
          gfx.line([
            p0.sub(new Vec2(diam, 0)),
            p0.add(new Vec2(0, dir.y * diam))
          ]);
        }
        break;
      case "non_logic":
        gfx.line([p0, position]);
        gfx.line([
          p0.sub(
            new Vec2(dir.x + dir.y, dir.y - dir.x).multiply(radius)
          ),
          p0.add(
            new Vec2(dir.x + dir.y, dir.y - dir.x).multiply(radius)
          )
        ]);
        gfx.line([
          p0.sub(
            new Vec2(dir.x - dir.y, dir.y + dir.x).multiply(radius)
          ),
          p0.add(
            new Vec2(dir.x - dir.y, dir.y + dir.x).multiply(radius)
          )
        ]);
        break;
    }
  }
};
var PinLabelInternals = {
  /**
   * Handles rotating the label position offset based on the pin's orientation
   */
  orient_label(offset, orientation, h_align, v_align) {
    switch (orientation) {
      case "right":
        break;
      case "left":
        offset.x *= -1;
        if (h_align == "left") {
          h_align = "right";
        }
        break;
      case "up":
        offset = new Vec2(offset.y, -offset.x);
        break;
      case "down":
        offset = new Vec2(offset.y, offset.x);
        if (h_align == "left") {
          h_align = "right";
        }
        break;
    }
    return {
      offset,
      h_align,
      v_align,
      orientation
    };
  },
  /**
   * Places a label inside the symbol body.  Or to put it another way,
   * places it to the left side of a pin that's on the right side of a symbol
   */
  place_inside(label_offset, thickness, pin_length, orientation) {
    const offset = new Vec2(label_offset - thickness / 2 + pin_length, 0);
    return this.orient_label(offset, orientation, "left", "center");
  },
  /**
   * Places a label above the pin
   */
  place_above(text_margin, pin_thickness, text_thickness, pin_length, orientation) {
    const offset = new Vec2(
      pin_length / 2,
      -(text_margin + pin_thickness / 2 + text_thickness / 2)
    );
    return this.orient_label(offset, orientation, "center", "bottom");
  },
  /**
   * Places a label below the pin
   */
  place_below(text_margin, pin_thickness, text_thickness, pin_length, orientation) {
    const offset = new Vec2(
      pin_length / 2,
      text_margin + pin_thickness / 2 + text_thickness / 2
    );
    return this.orient_label(offset, orientation, "center", "top");
  },
  /**
   * Draw a label
   *
   * The placement should be created by calling once of the place_*() methods
   * first.
   *
   */
  draw(gfx, text, position, placement, effects, color) {
    const edatext = new EDAText(text);
    edatext.apply_effects(effects);
    edatext.attributes.h_align = placement.h_align;
    edatext.attributes.v_align = placement.v_align;
    edatext.attributes.color = color;
    edatext.text_pos = position.add(placement.offset).multiply(1e4);
    switch (placement.orientation) {
      case "up":
      case "down":
        edatext.text_angle = Angle.from_degrees(90);
        break;
      case "left":
      case "right":
        edatext.text_angle = Angle.from_degrees(0);
        break;
    }
    StrokeFont.default().draw(
      gfx,
      edatext.shown_text,
      edatext.text_pos,
      edatext.attributes
    );
  }
};

// graphics/null-renderer.ts
var NullRenderLayer = class extends RenderLayer {
  constructor() {
    super(...arguments);
    this.shapes = [];
  }
  static {
    __name(this, "NullRenderLayer");
  }
  dispose() {
    this.clear();
  }
  clear() {
    this.shapes = [];
  }
  render(camera) {
  }
};
var NullRenderer = class extends Renderer {
  static {
    __name(this, "NullRenderer");
  }
  #active_layer;
  constructor() {
    super(null);
  }
  set background_color(color) {
  }
  async setup() {
  }
  async dispose() {
  }
  update_canvas_size() {
  }
  clear_canvas() {
  }
  start_layer(name) {
    this.#active_layer = new NullRenderLayer(this, name);
  }
  end_layer() {
    return this.#active_layer;
  }
  get layers() {
    return [];
  }
  circle(circle_or_center, radius, color) {
    this.#active_layer.shapes.push(
      super.prep_circle(circle_or_center, radius, color)
    );
  }
  arc(arc_or_center, radius, start_angle, end_angle, width, color) {
    this.#active_layer.shapes.push(
      super.prep_arc(
        arc_or_center,
        radius,
        start_angle,
        end_angle,
        width,
        color
      )
    );
  }
  line(line_or_points, width, color) {
    this.#active_layer.shapes.push(
      super.prep_line(line_or_points, width, color)
    );
  }
  polygon(polygon_or_points, color) {
    this.#active_layer.shapes.push(
      super.prep_polygon(polygon_or_points, color)
    );
  }
  remove_layer(layer) {
  }
};

// viewers/schematic/painters/symbol.ts
var LibSymbolPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [LibSymbol];
  }
  static {
    __name(this, "LibSymbolPainter");
  }
  layers_for(item) {
    return [
      ":Symbol:Background" /* symbol_background */,
      ":Symbol:Foreground" /* symbol_foreground */,
      ":Symbol:Field" /* symbol_field */
    ];
  }
  paint(layer, s, body_style = 1) {
    if (![
      ":Symbol:Background" /* symbol_background */,
      ":Symbol:Foreground" /* symbol_foreground */,
      ":Interactive" /* interactive */
    ].includes(layer.name)) {
      return;
    }
    const common_unit = s.units.get(0);
    if (common_unit) {
      this.#paint_unit(layer, common_unit, body_style);
    }
    const si = this.view_painter.current_symbol;
    const symbol_unit = s.units.get(si?.unit || 1);
    if (symbol_unit) {
      this.#paint_unit(layer, symbol_unit, body_style);
    }
  }
  #paint_unit(layer, unit, body_style = 1) {
    for (const sym of unit) {
      if (sym.style > 0 && body_style != sym.style) {
        continue;
      }
      for (const g of sym.drawings) {
        this.view_painter.paint_item(layer, g);
      }
    }
  }
};
var SchematicSymbolPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [SchematicSymbol];
  }
  static {
    __name(this, "SchematicSymbolPainter");
  }
  layers_for(item) {
    const layers = [
      ":Interactive" /* interactive */,
      ":Symbol:Foreground" /* symbol_foreground */,
      ":Symbol:Background" /* symbol_background */,
      ":Symbol:Field" /* symbol_field */,
      ":Symbol:Pin" /* symbol_pin */
    ];
    if (item.dnp) {
      layers.push(":Marks" /* marks */);
    }
    return layers;
  }
  paint(layer, si) {
    if (layer.name == ":Interactive" /* interactive */ && si.lib_symbol.power) {
      return;
    }
    const transform = get_symbol_transform(si);
    this.view_painter.current_symbol = si;
    this.view_painter.current_symbol_transform = transform;
    this.gfx.state.push();
    this.gfx.state.matrix = Matrix3.translation(
      si.at.position.x,
      si.at.position.y
    );
    this.gfx.state.multiply(transform.matrix);
    const body_style = si.convert ?? 1;
    this.view_painter.paint_item(layer, si.lib_symbol, body_style);
    this.gfx.state.pop();
    if ([
      ":Symbol:Pin" /* symbol_pin */,
      ":Symbol:Foreground" /* symbol_foreground */,
      ":Interactive" /* interactive */
    ].includes(layer.name)) {
      for (const pin of si.unit_pins) {
        this.view_painter.paint_item(layer, pin);
      }
    }
    if (layer.name == ":Symbol:Field" /* symbol_field */ || layer.name == ":Interactive" /* interactive */) {
      for (const [_, p] of si.properties) {
        this.view_painter.paint_item(layer, p);
      }
    }
    if (si.dnp && layer.name == ":Marks" /* marks */) {
      const bbox = get_symbol_body_and_pins_bbox(this.theme, si);
      const width = DefaultValues.line_width * 3;
      const color = this.theme.erc_error;
      this.gfx.line([bbox.top_left, bbox.bottom_right], width, color);
      this.gfx.line([bbox.bottom_left, bbox.top_right], width, color);
    }
    this.view_painter.current_symbol = void 0;
    this.view_painter.current_symbol_transform = void 0;
  }
};
function get_symbol_transform(symbol) {
  const zero_deg_matrix = new Matrix3([1, 0, 0, 0, -1, 0, 0, 0, 1]);
  const ninety_deg_matrix = new Matrix3([0, -1, 0, -1, 0, 0, 0, 0, 1]);
  const one_eighty_deg_matrix = new Matrix3([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const two_seventy_deg_matrix = new Matrix3([0, 1, 0, 1, 0, 0, 0, 0, 1]);
  let rotations = 0;
  let matrix = zero_deg_matrix;
  if (symbol.at.rotation == 0) {
  } else if (symbol.at.rotation == 90) {
    rotations = 1;
    matrix = ninety_deg_matrix;
  } else if (symbol.at.rotation == 180) {
    rotations = 2;
    matrix = one_eighty_deg_matrix;
  } else if (symbol.at.rotation == 270) {
    rotations = 3;
    matrix = two_seventy_deg_matrix;
  } else {
    throw new Error(`unexpected rotation ${symbol.at.rotation}`);
  }
  if (symbol.mirror == "y") {
    const x1 = matrix.elements[0] * -1;
    const y1 = matrix.elements[3] * -1;
    const x2 = matrix.elements[1];
    const y2 = matrix.elements[4];
    matrix.elements[0] = x1;
    matrix.elements[1] = x2;
    matrix.elements[3] = y1;
    matrix.elements[4] = y2;
  } else if (symbol.mirror == "x") {
    const x1 = matrix.elements[0];
    const y1 = matrix.elements[3];
    const x2 = matrix.elements[1] * -1;
    const y2 = matrix.elements[4] * -1;
    matrix.elements[0] = x1;
    matrix.elements[1] = x2;
    matrix.elements[3] = y1;
    matrix.elements[4] = y2;
  }
  return {
    matrix,
    position: symbol.at.position,
    rotations,
    mirror_x: symbol.mirror == "x",
    mirror_y: symbol.mirror == "y"
  };
}
__name(get_symbol_transform, "get_symbol_transform");
function get_symbol_body_and_pins_bbox(theme3, si) {
  const gfx = new NullRenderer();
  const layerset = new LayerSet4(theme3);
  const painter = new SchematicPainter(gfx, layerset, theme3);
  const layer_names = [
    ":Symbol:Foreground" /* symbol_foreground */,
    ":Symbol:Background" /* symbol_background */,
    ":Symbol:Pin" /* symbol_pin */
  ];
  const bboxes = [];
  for (const layer_name of layer_names) {
    const layer = layerset.by_name(layer_name);
    layer.items.push(si);
    painter.paint_layer(layer);
    bboxes.push(layer.bbox);
  }
  return BBox.combine(bboxes);
}
__name(get_symbol_body_and_pins_bbox, "get_symbol_body_and_pins_bbox");

// viewers/schematic/painter.ts
var RectanglePainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Rectangle];
  }
  static {
    __name(this, "RectanglePainter");
  }
  layers_for(item) {
    return [":Notes" /* notes */];
  }
  paint(layer, r) {
    const pts = [
      r.start,
      new Vec2(r.end.x, r.start.y),
      r.end,
      new Vec2(r.start.x, r.end.y),
      r.start
    ];
    this.#fill(layer, r, pts);
    this.#stroke(layer, r, pts);
  }
  #stroke(layer, r, pts) {
    const { width, color } = this.determine_stroke(layer, r);
    if (!width || !color) {
      return;
    }
    this.gfx.line(
      new Polyline2(
        pts,
        r.stroke?.width || this.gfx.state.stroke_width,
        color
      )
    );
  }
  #fill(layer, r, pts) {
    const color = this.determine_fill(layer, r);
    if (!color) {
      return;
    }
    this.gfx.polygon(new Polygon2(pts, color));
  }
};
var PolylinePainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Polyline];
  }
  static {
    __name(this, "PolylinePainter");
  }
  layers_for(item) {
    return [":Notes" /* notes */];
  }
  paint(layer, pl) {
    this.#fill(layer, pl);
    this.#stroke(layer, pl);
  }
  #stroke(layer, pl) {
    const { width, color } = this.determine_stroke(layer, pl);
    if (!width || !color) {
      return;
    }
    const draw_line = /* @__PURE__ */ __name((lines) => {
      this.gfx.line(lines, width, color);
    }, "draw_line");
    StrokePainter.line(pl.pts, width, pl.stroke_params, draw_line);
  }
  #fill(layer, pl) {
    const color = this.determine_fill(layer, pl);
    if (!color) {
      return;
    }
    this.gfx.polygon(new Polygon2(pl.pts, color));
  }
};
var RuleAreaPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [RuleArea];
  }
  static {
    __name(this, "RuleAreaPainter");
  }
  layers_for(item) {
    return [":Notes" /* notes */];
  }
  paint(layer, item) {
    const pts = [...item.polyline.pts, item.polyline.pts[0].copy()];
    const fill_color = this.determine_fill(layer, item.polyline);
    if (fill_color) {
      this.gfx.polygon(new Polygon2(pts, fill_color));
    }
    const outline_width = item.polyline.stroke?.width || this.gfx.state.stroke_width;
    const outline_color = item.polyline.stroke?.color || this.theme.rule_area;
    if (outline_width && outline_color) {
      const draw_line = /* @__PURE__ */ __name((lines) => {
        this.gfx.line(lines, outline_width, outline_color);
      }, "draw_line");
      StrokePainter.line(
        pts,
        outline_width,
        item.polyline.stroke_params,
        draw_line
      );
    }
  }
};
var WirePainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Wire];
  }
  static {
    __name(this, "WirePainter");
  }
  layers_for(item) {
    return [":Wire" /* wire */];
  }
  paint(layer, w) {
    this.gfx.line(
      new Polyline2(w.pts, this.gfx.state.stroke_width, this.theme.wire)
    );
  }
};
var BusPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Bus];
  }
  static {
    __name(this, "BusPainter");
  }
  layers_for(item) {
    return [":Wire" /* wire */];
  }
  paint(layer, w) {
    this.gfx.line(
      new Polyline2(
        w.pts,
        DefaultValues.bus_width,
        this.theme.bus
      )
    );
  }
};
var BusEntryPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [BusEntry];
  }
  static {
    __name(this, "BusEntryPainter");
  }
  layers_for(item) {
    return [":Junction" /* junction */];
  }
  paint(layer, be) {
    this.gfx.line(
      new Polyline2(
        [be.at.position, be.at.position.add(be.size)],
        DefaultValues.wire_width,
        this.theme.wire
      )
    );
  }
};
var CirclePainter2 = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Circle2];
  }
  static {
    __name(this, "CirclePainter");
  }
  layers_for(item) {
    return [":Notes" /* notes */];
  }
  paint(layer, c) {
    this.#fill(layer, c);
    this.#stroke(layer, c);
  }
  #stroke(layer, c) {
    const { width, color } = this.determine_stroke(layer, c);
    if (!width || !color) {
      return;
    }
    this.gfx.arc(
      new Arc4(
        c.center,
        c.radius,
        new Angle(0),
        new Angle(Math.PI * 2),
        width,
        color
      )
    );
  }
  #fill(layer, c) {
    const color = this.determine_fill(layer, c);
    if (!color) {
      return;
    }
    this.gfx.circle(new Circle3(c.center, c.radius, color));
  }
};
var ArcPainter2 = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Arc3];
  }
  static {
    __name(this, "ArcPainter");
  }
  layers_for(item) {
    return [":Notes" /* notes */];
  }
  paint(layer, a) {
    const arc = Arc.from_three_points(
      a.start,
      a.mid,
      a.end,
      a.stroke?.width
    );
    this.#fill(layer, a, arc);
    this.#stroke(layer, a, arc);
  }
  #stroke(layer, a, arc) {
    const { width, color } = this.determine_stroke(layer, a);
    if (!width || !color) {
      return;
    }
    this.gfx.arc(
      new Arc4(
        arc.center,
        arc.radius,
        arc.start_angle,
        arc.end_angle,
        width,
        color
      )
    );
  }
  #fill(layer, a, arc) {
    const color = this.determine_fill(layer, a);
    if (!color) {
      return;
    }
    this.gfx.polygon(new Polygon2(arc.to_polygon(), color));
  }
};
var JunctionPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Junction];
  }
  static {
    __name(this, "JunctionPainter");
  }
  layers_for(item) {
    return [":Junction" /* junction */];
  }
  paint(layer, j) {
    const color = this.theme.junction;
    this.gfx.circle(
      new Circle3(j.at.position, (j.diameter || 1) / 2, color)
    );
  }
};
var NoConnectPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [NoConnect];
  }
  static {
    __name(this, "NoConnectPainter");
  }
  layers_for(item) {
    return [":Junction" /* junction */];
  }
  paint(layer, nc) {
    const color = this.theme.no_connect;
    const width = DefaultValues.line_width;
    const size = DefaultValues.noconnect_size / 2;
    this.gfx.state.push();
    this.gfx.state.matrix.translate_self(
      nc.at.position.x,
      nc.at.position.y
    );
    this.gfx.line(
      new Polyline2(
        [new Vec2(-size, -size), new Vec2(size, size)],
        width,
        color
      )
    );
    this.gfx.line(
      new Polyline2(
        [new Vec2(size, -size), new Vec2(-size, size)],
        width,
        color
      )
    );
    this.gfx.state.pop();
  }
};
var TextPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Text3];
  }
  static {
    __name(this, "TextPainter");
  }
  layers_for(item) {
    return [":Notes" /* notes */];
  }
  paint(layer, t) {
    if (t.effects.hide || !t.text) {
      return;
    }
    const schtext = new SchText(t.shown_text);
    schtext.apply_at(t.at);
    schtext.apply_effects(t.effects);
    const font_color = t.effects.font.color;
    if (font_color.is_transparent_black) {
      const text_color = this.theme.note;
      schtext.attributes.color = this.dim_if_needed(text_color);
    } else {
      schtext.attributes.color = this.dim_if_needed(font_color);
    }
    this.gfx.state.push();
    StrokeFont.default().draw(
      this.gfx,
      schtext.shown_text,
      schtext.text_pos,
      schtext.attributes
    );
    this.gfx.state.pop();
  }
};
var PropertyPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [Property2];
  }
  static {
    __name(this, "PropertyPainter");
  }
  layers_for(item) {
    return [":Symbol:Field" /* symbol_field */, ":Interactive" /* interactive */];
  }
  paint(layer, p) {
    if (p.hide || !p.text) {
      return;
    }
    let color = this.theme.fields;
    if (p.parent instanceof SchematicSheet) {
      color = this.theme.sheet_fields;
    }
    const font_color = p.effects.font.color;
    if (font_color.is_transparent_black) {
      switch (p.name) {
        case "Reference":
          color = this.theme.reference;
          break;
        case "Value":
          color = this.theme.value;
          break;
        case "Sheet name":
          color = this.theme.sheet_name;
          break;
        case "Sheet file":
          color = this.theme.sheet_filename;
          break;
      }
      color = this.dim_if_needed(color);
    } else {
      color = this.dim_if_needed(font_color);
    }
    const parent = p.parent;
    const transform = this.view_painter.current_symbol_transform;
    const matrix = transform?.matrix ?? Matrix3.identity();
    let text = p.shown_text;
    if (p.name == "Reference" && parent.unit) {
      text += parent.unit_suffix;
    }
    const schfield = new SchField(text, {
      position: parent.at.position.multiply(1e4),
      transform: matrix,
      is_symbol: parent instanceof SchematicSymbol
    });
    schfield.apply_effects(p.effects);
    schfield.attributes.angle = Angle.from_degrees(p.at.rotation);
    let rel_position = p.at.position.multiply(1e4).sub(schfield.parent.position);
    rel_position = matrix.inverse().transform(rel_position);
    rel_position = rel_position.add(schfield.parent.position);
    schfield.text_pos = rel_position;
    const orient = schfield.draw_rotation;
    const bbox = schfield.bounding_box;
    const pos = bbox.center;
    schfield.attributes.angle = orient;
    schfield.attributes.h_align = "center";
    schfield.attributes.v_align = "center";
    schfield.attributes.stroke_width = schfield.get_effective_text_thickness(
      DefaultValues.line_width * 1e4
    );
    schfield.attributes.color = color;
    const bbox_pts = Matrix3.scaling(1e-4, 1e-4).transform_all([
      bbox.top_left,
      bbox.top_right,
      bbox.bottom_right,
      bbox.bottom_left,
      bbox.top_left
    ]);
    if (layer.name == ":Interactive" /* interactive */) {
      this.gfx.line(new Polyline2(Array.from(bbox_pts), 0.1, Color.white));
    } else {
      this.gfx.state.push();
      StrokeFont.default().draw(
        this.gfx,
        schfield.shown_text,
        pos,
        schfield.attributes
      );
      this.gfx.state.pop();
    }
  }
};
var LibTextPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [LibText];
  }
  static {
    __name(this, "LibTextPainter");
  }
  layers_for(item) {
    return [":Symbol:Foreground" /* symbol_foreground */];
  }
  paint(layer, lt) {
    if (lt.effects.hide || !lt.text) {
      return;
    }
    const current_symbol_transform = this.view_painter.current_symbol_transform;
    const libtext = new LibText2(lt.shown_text);
    libtext.apply_effects(lt.effects);
    libtext.apply_at(lt.at);
    libtext.apply_symbol_transformations(current_symbol_transform);
    libtext.attributes.color = this.dim_if_needed(
      this.theme.component_outline
    );
    const pos = libtext.world_pos;
    libtext.attributes.v_align = "center";
    this.gfx.state.push();
    this.gfx.state.matrix = Matrix3.identity();
    StrokeFont.default().draw(
      this.gfx,
      libtext.shown_text,
      pos,
      libtext.attributes
    );
    this.gfx.state.pop();
  }
  paint_debug(bbox) {
    this.gfx.line(
      Polyline2.from_BBox(
        bbox.scale(1 / 1e4),
        0.127,
        new Color(0, 0, 1, 1)
      )
    );
    this.gfx.circle(
      new Circle3(
        bbox.center.multiply(1 / 1e4),
        0.2,
        new Color(0, 1, 0, 1)
      )
    );
  }
};
var SchematicSheetPainter = class extends SchematicItemPainter {
  constructor() {
    super(...arguments);
    this.classes = [SchematicSheet];
  }
  static {
    __name(this, "SchematicSheetPainter");
  }
  layers_for(item) {
    return [
      ":Interactive" /* interactive */,
      ":Label" /* label */,
      ":Symbol:Foreground" /* symbol_foreground */,
      ":Symbol:Background" /* symbol_background */,
      ":Symbol:Field" /* symbol_field */
    ];
  }
  paint(layer, ss) {
    const outline_color = this.theme.sheet;
    const fill_color = this.theme.sheet_background;
    const bbox = new BBox(
      ss.at.position.x,
      ss.at.position.y,
      ss.size.x,
      ss.size.y
    );
    if (layer.name == ":Interactive" /* interactive */) {
      this.gfx.polygon(Polygon2.from_BBox(bbox.grow(3), fill_color));
    }
    if (layer.name == ":Symbol:Background" /* symbol_background */) {
      this.gfx.polygon(Polygon2.from_BBox(bbox, fill_color));
    }
    if (layer.name == ":Symbol:Foreground" /* symbol_foreground */) {
      this.gfx.line(
        Polyline2.from_BBox(
          bbox,
          this.gfx.state.stroke_width,
          outline_color
        )
      );
    }
    if (layer.name == ":Symbol:Field" /* symbol_field */) {
      for (const property of ss.properties.values()) {
        this.view_painter.paint_item(layer, property);
      }
    }
    if (layer.name == ":Label" /* label */) {
      for (const pin of ss.pins) {
        const label = new HierarchicalLabel();
        label.at = pin.at.copy();
        label.effects = pin.effects;
        label.text = pin.name;
        label.shape = pin.shape;
        switch (label.at.rotation) {
          case 0:
            label.at.rotation = 180;
            break;
          case 180:
            label.at.rotation = 0;
            break;
          case 90:
            label.at.rotation = 270;
            break;
          case 270:
            label.at.rotation = 90;
            break;
        }
        if (pin.shape == "input") {
          label.shape = "output";
        } else if (pin.shape == "output") {
          label.shape = "input";
        }
        this.view_painter.paint_item(layer, label);
      }
    }
  }
};
var SchematicPainter = class extends BaseSchematicPainter {
  static {
    __name(this, "SchematicPainter");
  }
  constructor(gfx, layers, theme3) {
    super(gfx, layers, theme3);
    this.painter_list = [
      new RectanglePainter(this, gfx),
      new PolylinePainter(this, gfx),
      new RuleAreaPainter(this, gfx),
      new WirePainter(this, gfx),
      new BusPainter(this, gfx),
      new BusEntryPainter(this, gfx),
      new CirclePainter2(this, gfx),
      new ArcPainter2(this, gfx),
      new JunctionPainter(this, gfx),
      new NoConnectPainter(this, gfx),
      new TextPainter(this, gfx),
      new LibTextPainter(this, gfx),
      new PinPainter(this, gfx),
      new LibSymbolPainter(this, gfx),
      new PropertyPainter(this, gfx),
      new SchematicSymbolPainter(this, gfx),
      new NetLabelPainter(this, gfx),
      new DirectiveLabelPainter(this, gfx),
      new GlobalLabelPainter(this, gfx),
      new HierarchicalLabelPainter(this, gfx),
      new SchematicSheetPainter(this, gfx)
    ];
  }
};

// viewers/schematic/viewer.ts
var SchematicViewer = class extends DocumentViewer {
  static {
    __name(this, "SchematicViewer");
  }
  get schematic() {
    return this.document;
  }
  create_renderer(canvas) {
    const renderer = new Canvas2DRenderer(canvas);
    renderer.state.fill = this.theme.note;
    renderer.state.stroke = this.theme.note;
    renderer.state.stroke_width = 0.1524;
    return renderer;
  }
  async load(src) {
    if (src instanceof KicadSch) {
      return await super.load(src);
    }
    this.document = null;
    const doc = src.document;
    doc.update_hierarchical_data(src.sheet_path);
    return await super.load(doc);
  }
  create_painter() {
    return new SchematicPainter(this.renderer, this.layers, this.theme);
  }
  create_layer_set() {
    return new LayerSet4(this.theme);
  }
  select(item) {
    if (is_string(item)) {
      item = this.schematic.find_symbol(item) ?? this.schematic.find_sheet(item);
    }
    if (item instanceof SchematicSymbol || item instanceof SchematicSheet) {
      const bboxes = this.layers.query_item_bboxes(item);
      item = first(bboxes) ?? null;
    }
    super.select(item);
  }
};

// kicanvas/elements/kc-schematic/viewer.ts
var KCSchematicViewerElement = class extends KCViewerElement {
  static {
    __name(this, "KCSchematicViewerElement");
  }
  update_theme() {
    this.viewer.theme = this.themeObject.schematic;
  }
  make_viewer() {
    return new SchematicViewer(
      this.canvas,
      !this.disableinteraction,
      this.themeObject.schematic
    );
  }
};
window.customElements.define("kc-schematic-viewer", KCSchematicViewerElement);

// kicanvas/elements/kc-schematic/info-panel.ts
var KCSchematicInfoPanel = class extends KCUIElement {
  static {
    __name(this, "KCSchematicInfoPanel");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
      this.addDisposable(
        this.viewer.addEventListener(KiCanvasLoadEvent.type, (e) => {
          this.update();
        })
      );
    })();
  }
  render() {
    const ds = this.viewer.drawing_sheet;
    const schematic = this.viewer.schematic;
    const header = /* @__PURE__ */ __name((name) => html`<kc-ui-property-list-item
                class="label"
                name="${name}"></kc-ui-property-list-item>`, "header");
    const entry = /* @__PURE__ */ __name((name, desc, suffix = "") => html`<kc-ui-property-list-item name="${name}">
                ${desc} ${suffix}
            </kc-ui-property-list-item>`, "entry");
    const comments = Object.entries(
      schematic.title_block?.comment || {}
    ).map(([k, v]) => entry(`Comment ${k}`, v));
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Info"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-property-list>
                        ${header("Page properties")}
                        ${entry("Size", ds.paper?.size)}
                        ${entry("Width", ds.width, "mm")}
                        ${entry("Height", ds.height, "mm")}
                        ${header("Schematic properties")}
                        ${entry("KiCad version", schematic.version)}
                        ${entry("Generator", schematic.generator)}
                        ${entry("Title", schematic.title_block?.title)}
                        ${entry("Date", schematic.title_block?.date)}
                        ${entry("Revision", schematic.title_block?.rev)}
                        ${entry("Company", schematic.title_block?.company)}
                        ${comments}
                        ${entry("Symbols", schematic.symbols.size)}
                        ${entry(
      "Unique symbols",
      schematic.lib_symbols?.symbols.length ?? 0
    )}
                        ${entry("Wires", schematic.wires.length)}
                        ${entry("Buses", schematic.buses.length)}
                        ${entry("Junctions", schematic.junctions.length)}
                        ${entry("Net labels", schematic.net_labels.length)}
                        ${entry(
      "Global labels",
      schematic.global_labels.length
    )}
                        ${entry(
      "Hierarchical labels",
      schematic.hierarchical_labels.length
    )}
                        ${entry("No connects", schematic.no_connects.length)}
                    </dl>
                </kc-ui-property-list>
            </kc-ui-panel>
        `;
  }
};
window.customElements.define("kc-schematic-info-panel", KCSchematicInfoPanel);

// kicanvas/elements/kc-schematic/properties-panel.ts
var KCSchematicPropertiesPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCSchematicPropertiesPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
      this.setup_events();
    })();
  }
  setup_events() {
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
        this.selected_item = e.detail.item;
        this.update();
      })
    );
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasLoadEvent.type, (e) => {
        this.selected_item = void 0;
        this.update();
      })
    );
  }
  render() {
    const header = /* @__PURE__ */ __name((name) => html`<kc-ui-property-list-item
                class="label"
                name="${name}"></kc-ui-property-list-item>`, "header");
    const entry = /* @__PURE__ */ __name((name, desc, suffix = "") => html`<kc-ui-property-list-item name="${name}">
                ${desc ?? ""} ${suffix}
            </kc-ui-property-list-item>`, "entry");
    const checkbox = /* @__PURE__ */ __name((value) => value ? html`<kc-ui-icon>check</kc-ui-icon>` : html`<kc-ui-icon>close</kc-ui-icon>`, "checkbox");
    let entries;
    const item = this.selected_item;
    if (!item) {
      entries = header("No item selected");
    } else if (item instanceof SchematicSymbol) {
      const lib = item.lib_symbol;
      const properties = Array.from(item.properties.values()).map((v) => {
        return entry(v.name, v.text);
      });
      const pins = sorted_by_numeric_strings(
        item.unit_pins,
        (pin) => pin.number
      ).map((p) => {
        return entry(p.number, p.definition.name.text);
      });
      entries = html`
                ${header("Basic properties")}
                ${entry("X", item.at.position.x.toFixed(4), "mm")}
                ${entry("Y", item.at.position.y.toFixed(4), "mm")}
                ${entry("Orientation", item.at.rotation, "\xB0")}
                ${entry(
        "Mirror",
        item.mirror == "x" ? "Around X axis" : item.mirror == "y" ? "Around Y axis" : "Not mirrored"
      )}
                ${header("Instance properties")}
                ${entry("Library link", item.lib_name ?? item.lib_id)}
                ${item.unit ? entry(
        "Unit",
        String.fromCharCode(
          "A".charCodeAt(0) + item.unit - 1
        )
      ) : ""}
                ${entry("In BOM", checkbox(item.in_bom))}
                ${entry("On board", checkbox(item.in_bom))}
                ${entry("Populate", checkbox(!item.dnp))} ${header("Fields")}
                ${properties} ${header("Symbol properties")}
                ${entry("Name", lib.name)}
                ${entry("Description", lib.description)}
                ${entry("Keywords", lib.keywords)}
                ${entry("Power", checkbox(lib.power))}
                ${entry("Units", lib.unit_count)}
                ${entry(
        "Units are interchangeable",
        checkbox(lib.units_interchangable)
      )}
                ${header("Pins")} ${pins}
            `;
    } else if (item instanceof SchematicSheet) {
      const properties = Array.from(item.properties.values()).map((v) => {
        return entry(v.name, v.text);
      });
      const pins = sorted_by_numeric_strings(
        item.pins,
        (pin) => pin.name
      ).map((p) => {
        return entry(p.name, p.shape);
      });
      entries = html`
                ${header("Basic properties")}
                ${entry("X", item.at.position.x.toFixed(4), "mm")}
                ${entry("Y", item.at.position.y.toFixed(4), "mm")}
                ${header("Fields")} ${properties} ${header("Pins")} ${pins}
            `;
    }
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Properties"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-property-list>${entries}</kc-ui-property-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
window.customElements.define(
  "kc-schematic-properties-panel",
  KCSchematicPropertiesPanelElement
);

// kicanvas/elements/kc-schematic/symbols-panel.ts
var KCSchematicSymbolsPanelElement = class extends KCUIElement {
  static {
    __name(this, "KCSchematicSymbolsPanelElement");
  }
  connectedCallback() {
    (async () => {
      this.viewer = await this.requestLazyContext("viewer");
      await this.viewer.loaded;
      super.connectedCallback();
      this.setup_initial_events();
    })();
  }
  setup_initial_events() {
    let updating_selected = false;
    this.addEventListener("kc-ui-menu:select", (e) => {
      if (updating_selected) {
        return;
      }
      const item = e.detail;
      if (!item.name) {
        return;
      }
      this.viewer.select(item.name);
    });
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasSelectEvent.type, () => {
        updating_selected = true;
        this.menu.selected = this.viewer.selected?.context.uuid ?? null;
        updating_selected = false;
      })
    );
    this.addDisposable(
      this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
        this.update();
      })
    );
  }
  renderedCallback() {
    this.search_input_elm.addEventListener("input", (e) => {
      this.item_filter_elem.filter_text = this.search_input_elm.value ?? null;
    });
  }
  render() {
    const schematic = this.viewer.schematic;
    const symbol_elms = [];
    const power_symbol_elms = [];
    const sheet_elms = [];
    const symbols = sorted_by_numeric_strings(
      Array.from(schematic.symbols.values()),
      (sym) => sym.reference
    );
    for (const sym of symbols) {
      const match_text = `${sym.reference} ${sym.value} ${sym.id} ${sym.lib_symbol.name}`;
      const entry = html`<kc-ui-menu-item
                name="${sym.uuid}"
                data-match-text="${match_text}">
                <span class="narrow"> ${sym.reference} </span>
                <span> ${sym.value} </span>
            </kc-ui-menu-item>`;
      if (sym.lib_symbol.power) {
        power_symbol_elms.push(entry);
      } else {
        symbol_elms.push(entry);
      }
    }
    const sheets = sorted_by_numeric_strings(
      schematic.sheets,
      (sheet) => sheet.sheetname ?? sheet.sheetfile ?? ""
    );
    for (const sheet of sheets) {
      const match_text = `${sheet.sheetname} ${sheet.sheetfile}`;
      sheet_elms.push(
        html`<kc-ui-menu-item
                    name="${sheet.uuid}"
                    data-match-text="${match_text}">
                    <span class="narrow"> ${sheet.sheetname}</span>
                    <span>${sheet.sheetfile}</span>
                </kc-ui-menu-item>`
      );
    }
    return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Symbols"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <kc-ui-text-filter-input></kc-ui-text-filter-input>
                    <kc-ui-filtered-list>
                        <kc-ui-menu class="outline">
                            ${symbol_elms}
                            ${power_symbol_elms.length ? html`<kc-ui-menu-label
                                      >Power symbols</kc-ui-menu-label
                                  >` : null}
                            ${power_symbol_elms}
                            ${sheet_elms.length ? html`<kc-ui-menu-label
                                      >Sheets</kc-ui-menu-label
                                  >` : null}
                            ${sheet_elms}
                        </kc-ui-menu>
                    </kc-ui-filtered-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
  }
};
__decorateClass([
  query("kc-ui-menu")
], KCSchematicSymbolsPanelElement.prototype, "menu", 2);
__decorateClass([
  query("kc-ui-text-filter-input", true)
], KCSchematicSymbolsPanelElement.prototype, "search_input_elm", 2);
__decorateClass([
  query("kc-ui-filtered-list", true)
], KCSchematicSymbolsPanelElement.prototype, "item_filter_elem", 2);
window.customElements.define(
  "kc-schematic-symbols-panel",
  KCSchematicSymbolsPanelElement
);

// kicanvas/elements/kc-schematic/app.ts
var KCSchematicAppElement = class extends KCViewerAppElement {
  static {
    __name(this, "KCSchematicAppElement");
  }
  on_viewer_select(item, previous) {
    if (!item || item != previous) {
      return;
    }
    if (item instanceof SchematicSheet) {
      this.project.set_active_page(
        `${item.sheetfile}:${item.path}/${item.uuid}`
      );
      return;
    }
    this.change_activity("properties");
  }
  can_load(src) {
    return src.document instanceof KicadSch;
  }
  make_viewer_element() {
    return html`<kc-schematic-viewer></kc-schematic-viewer>`;
  }
  make_activities() {
    return [
      // Symbols
      html`<kc-ui-activity
                slot="activities"
                name="Symbols"
                icon="interests">
                <kc-schematic-symbols-panel></kc-schematic-symbols-panel>
            </kc-ui-activity>`,
      // Schematic item properties
      html`<kc-ui-activity
                slot="activities"
                name="Properties"
                icon="list">
                <kc-schematic-properties-panel></kc-schematic-properties-panel>
            </kc-ui-activity>`,
      // Schematic info
      html`<kc-ui-activity slot="activities" name="Info" icon="info">
                <kc-schematic-info-panel></kc-schematic-info-panel>
            </kc-ui-activity>`
    ];
  }
};
window.customElements.define("kc-schematic-app", KCSchematicAppElement);

// kc-ui/kc-ui.css
var kc_ui_default = ":host{font-size:var(--font-size, 16px);--transition-time-very-short: .1s;--transition-time-short: .2s;--transition-time-medium: .5s;--bg: #131218;--fg: #f8f8f0;--tooltip-bg: #8864cb;--tooltip-fg: #f8f8f0;--tooltip-border: 1px solid #131218;--scrollbar-bg: #131218;--scrollbar-fg: #ae81ff66;--scrollbar-active-fg: #ae81ff;--scrollbar-hover-bg: #ae81ffbb;--activity-bar-bg: #282634;--activity-bar-fg: #f8f8f0;--activity-bar-active-bg: #131218;--activity-bar-active-fg: #f8f8f0;--resizer-bg: #ae81ff;--resizer-active-bg: #ae81ffbb;--panel-bg: #131218;--panel-fg: #f8f8f0;--panel-border: 2px solid #282634;--panel-title-bg: #8077a8;--panel-title-fg: #f8f8f0;--panel-title-border: 1px solid #634e89;--panel-title-button-bg: transparent;--panel-title-button-fg: #dcc8ff;--panel-title-button-hover-bg: #ae81ff;--panel-title-button-hover-fg: inherit;--panel-title-button-disabled-bg: inherit;--panel-title-button-disabled-fg: #888;--panel-subtitle-bg: #634e89;--panel-subtitle-fg: var(--panel-fg);--dropdown-bg: #464258;--dropdown-fg: #f8f8f0;--button-bg: #81eeff;--button-fg: #131218;--button-hover-bg: #a3f3ff;--button-hover-fg: #131218;--button-focus-outline: 1px solid #ae81ff;--button-selected-bg: #ae81ff;--button-selected-fg: #131218;--button-disabled-bg: #131218;--button-disabled-fg: #888;--button-success-bg: #64cb96;--button-success-fg: #131218;--button-success-hover-bg: #81ffbe;--button-success-hover-fg: #131218;--button-danger-bg: #cb6488;--button-danger-fg: #131218;--button-danger-hover-bg: #ff81ad;--button-danger-hover-fg: #131218;--button-outline-bg: #282634;--button-outline-fg: #f8f8f0;--button-outline-hover-bg: #282634;--button-outline-hover-fg: #81eeff;--button-outline-disabled-bg: #131218;--button-outline-disabled-fg: #888;--button-toolbar-bg: #282634;--button-toolbar-fg: #f8f8f0;--button-toolbar-hover-bg: #282634;--button-toolbar-hover-fg: #81eeff;--button-toolbar-disabled-bg: #131218;--button-toolbar-disabled-fg: #888;--button-menu-bg: transparent;--button-menu-fg: #f8f8f0;--button-menu-hover-bg: transparent;--button-menu-hover-fg: #81eeff;--button-menu-disabled-bg: transparent;--button-menu-disabled-fg: #888;--input-bg: #131218;--input-fg: #f8f8f0;--input-border: 1px solid #8077a8;--input-accent: #ae81ff;--input-hover-shadow: 1px 1px 10px 5px rgba(0, 0, 0, .2);--input-focus-outline: 1px solid #ae81ff;--input-placeholder: #8077a8;--input-disabled-bg: #131218;--input-disabled-fg: #888;--input-range-bg: #8077a8;--input-range-fg: #f8f8f0;--input-range-hover-bg: #ae81ff;--input-range-disabled-bg: #131218;--input-range-hover-shadow: 1px 1px 10px 5px rgba(0, 0, 0, .2);--input-range-handle-shadow: 1px 1px 5px 5px rgba(180, 180, 180, .2);--list-item-bg: var(--panel-bg);--list-item-fg: var(--panel-fg);--list-item-active-bg: #634e89;--list-item-active-fg: var(--list-item-fg);--list-item-hover-bg: #64cb96;--list-item-hover-fg: var(--list-item-bg);--list-item-disabled-bg: var(--list-item-bg);--list-item-disabled-fg: #888;--grid-outline: #433e56}:host{--bg: var(--color-ink);--fg: var(--color-bone);--tooltip-bg: var(--color-deep);--tooltip-fg: var(--color-bone);--tooltip-border: 1px solid var(--color-mid);--scrollbar-bg: var(--color-ground);--scrollbar-fg: var(--color-mid);--scrollbar-hover-fg: var(--color-grey-3);--scrollbar-active-fg: var(--color-grey-3);--activity-bar-bg: var(--color-ground);--activity-bar-fg: var(--color-grey-2);--activity-bar-active-bg: var(--color-deep);--activity-bar-active-fg: var(--color-paper);--resizer-bg: var(--color-mid);--resizer-active-bg: var(--color-grey-3);--panel-bg: var(--color-ground);--panel-fg: var(--color-bone);--panel-border: 1px solid var(--color-mid);--panel-title-bg: var(--color-deep);--panel-title-fg: var(--color-paper);--panel-title-border: 1px solid var(--color-mid);--panel-title-button-fg: var(--color-grey-2);--panel-title-button-hover-bg: var(--color-mid);--panel-title-button-disabled-fg: var(--color-grey-3);--panel-subtitle-bg: var(--color-deep);--panel-subtitle-fg: var(--color-grey-1);--dropdown-bg: var(--color-deep);--dropdown-fg: var(--color-bone);--dropdown-hover-bg: var(--color-mid);--dropdown-hover-fg: var(--color-paper);--dropdown-active-bg: var(--color-ink);--dropdown-active-fg: var(--color-paper);--button-bg: var(--color-bone);--button-fg: var(--color-onwhite);--button-hover-bg: var(--color-paper);--button-hover-fg: var(--color-onwhite);--button-focus-outline: 1px solid var(--color-bone);--button-selected-bg: var(--color-bone);--button-selected-fg: var(--color-onwhite);--button-disabled-bg: var(--color-ground);--button-disabled-fg: var(--color-grey-3);--button-success-bg: var(--color-ok);--button-success-fg: var(--color-ink);--button-success-hover-bg: var(--color-ok);--button-success-hover-fg: var(--color-ink);--button-danger-bg: var(--color-red-soft);--button-danger-fg: var(--color-ink);--button-danger-hover-bg: var(--color-red-soft);--button-danger-hover-fg: var(--color-ink);--button-outline-bg: var(--color-ground);--button-outline-fg: var(--color-bone);--button-outline-hover-bg: var(--color-deep);--button-outline-hover-fg: var(--color-paper);--button-outline-disabled-bg: var(--color-ground);--button-outline-disabled-fg: var(--color-grey-3);--button-toolbar-bg: var(--color-ground);--button-toolbar-fg: var(--color-grey-1);--button-toolbar-hover-bg: var(--color-deep);--button-toolbar-hover-fg: var(--color-paper);--button-toolbar-disabled-bg: var(--color-ground);--button-toolbar-disabled-fg: var(--color-grey-3);--button-toolbar-alt-bg: var(--color-deep);--button-toolbar-alt-hover-bg: var(--color-mid);--button-toolbar-alt-hover-fg: var(--color-paper);--button-toolbar-alt-disabled-bg: var(--color-ground);--button-menu-fg: var(--color-bone);--button-menu-hover-fg: var(--color-paper);--button-menu-disabled-fg: var(--color-grey-3);--input-bg: var(--color-ink);--input-fg: var(--color-bone);--input-border: 1px solid var(--color-mid);--input-accent: var(--color-bone);--input-hover-shadow: none;--input-focus-outline: 1px solid var(--color-bone);--input-placeholder: var(--color-grey-3);--input-disabled-bg: var(--color-ground);--input-disabled-fg: var(--color-grey-3);--input-range-bg: var(--color-mid);--input-range-fg: var(--color-bone);--input-range-hover-bg: var(--color-grey-3);--input-range-disabled-bg: var(--color-ground);--input-range-hover-shadow: none;--input-range-handle-shadow: none;--list-item-hover-bg: var(--color-deep);--list-item-hover-fg: var(--color-paper);--list-item-active-bg: var(--color-mid);--list-item-active-fg: var(--color-paper);--list-item-disabled-fg: var(--color-grey-3);--focus-overlay-bg: var(--color-ground);--focus-overlay-opacity: .85;--focus-overlay-fg: var(--color-bone);--grid-outline: var(--color-mid)}*,:before,:after{border-radius:0!important}::-webkit-scrollbar{position:absolute;width:6px;height:6px;margin-left:-6px;background:var(--scrollbar-bg)}::-webkit-scrollbar-thumb{position:absolute;background:var(--scrollbar-fg)}::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-hover-fg)}::-webkit-scrollbar-thumb:active{background:var(--scrollbar-active-fg)}kc-ui-app{width:100%;height:100%;flex-grow:1;display:flex;flex-direction:row;overflow:hidden}label{display:block;width:100%;margin-top:.75em}input,select,textarea{all:unset;box-sizing:border-box;display:block;width:100%;max-width:100%;margin-top:.5em;font-family:inherit;border-radius:.25em;text-align:center;padding:.25em;background:var(--input-bg);color:var(--input-fg);transition:color var(--transition-time-medium) ease,box-shadow var(--transition-time-medium) ease,outline var(--transition-time-medium) ease,background var(--transition-time-medium) ease,border var(--transition-time-medium) ease}input:hover,select:hover,textarea:hover{z-index:10;box-shadow:var(--input-hover-shadow)}input:focus,select:focus,textarea:focus{z-index:10;box-shadow:none;outline:var(--input-focus-outline)}input:disabled,select:disabled,textarea:disabled{background:var(--input-disabled-bg);color:var(--input-disabled-fg)}input:disabled:hover,select:disabled:hover,textarea:disabled:hover{z-index:10;cursor:unset}input[type=color]::-webkit-color-swatch{border:1px solid transparent;border-radius:.25em}textarea{text-align:left;padding:.5em}\n";

// kicanvas/elements/kicanvas-shell.css
var kicanvas_shell_default = "*,*:before,*:after{box-sizing:border-box}:host{box-sizing:border-box;margin:0;display:flex;position:relative;width:100%;height:100%;color:var(--fg)}:host([loaded]) section.overlay,:host([loading]) section.overlay{display:none}:host main{display:contents}section.overlay{position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--gradient-purple-blue-dark)}section.overlay h1{display:flex;margin:0 auto;align-items:center;justify-content:center;font-size:5em;font-weight:300;text-shadow:0 0 5px var(--gradient-purple-red)}section.overlay h1 img{width:1.5em}section.overlay p{text-align:center;font-size:1.5em;max-width:50%}section.overlay strong{background:var(--gradient-purple-red-highlight);-webkit-background-clip:text;-moz-background-clip:text;background-clip:text;color:transparent}section.overlay a{color:#81eeff}section.overlay a:hover{color:#a3f3ff}section.overlay input{font-size:1.5em;color:var(--fg);background:var(--gradient-purple-red);max-width:50%}section.overlay input::placeholder{color:var(--fg)}section.overlay .link_button{color:#81eeff;background:transparent;font-size:1em;font-weight:400;text-decoration:underline;outline:none;border:none;box-sizing:border-box;transition:color var(--transition-time-medium) ease}section.overlay .link_button:focus{border:var(--button-focus-outline)}section.overlay .link_button:hover{color:var(--fg)}section.overlay p.note{color:var(--input-placeholder);font-size:1em}section.overlay p.github img{width:2em}kc-board-viewer,kc-schematic-viewer{width:100%;height:100%;flex:1}.split-horizontal{display:flex;flex-direction:column;height:100%;max-height:100%;overflow:hidden}.split-vertical{display:flex;flex-direction:row;width:100%;max-width:100%;height:100%;overflow:hidden}kc-board-app,kc-schematic-app{width:100%;height:100%;flex:1}\n";

// kicanvas/elements/kicanvas-shell.ts
KCUIIconElement.sprites_url = sprites_url;
var KiCanvasShellElement = class extends KCUIElement {
  constructor() {
    super();
    this.project = new Project();
    this.provideContext("project", this.project);
  }
  static {
    __name(this, "KiCanvasShellElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      // TODO: Find a better way to handle these two styles.
      new CSS(kc_ui_default),
      new CSS(kicanvas_shell_default)
    ];
  }
  #schematic_app;
  #board_app;
  initialContentCallback() {
    const url_params = new URLSearchParams(document.location.search);
    const urls = [
      ...url_params.getAll("github"),
      ...url_params.getAll("repo")
    ];
    const url = urls[0];
    later(async () => {
      if (this.src) {
        const vfs = new FetchFileSystem([this.src]);
        await this.setup_project(vfs);
        return;
      }
      if (url) {
        const vfs = await this.load_repo(url);
        if (!vfs) {
          return;
        }
        await this.setup_project(vfs);
        return;
      }
      new DropTarget(this, async (fs) => {
        await this.setup_project(fs);
      });
    });
    this.link_input.addEventListener("input", async (e) => {
      const link = this.link_input.value;
      const vfs = await this.load_repo(link);
      if (!vfs) {
        console.error(`Invalid URL: ${link}`);
        return;
      }
      await this.setup_project(vfs);
      const location2 = new URL(window.location.href);
      location2.searchParams.set("repo", link);
      window.history.pushState(null, "", location2);
    });
    this.open_file_button.addEventListener("click", async (e) => {
      FilePicker.pick(async (vfs) => {
        await this.setup_project(vfs);
      });
    });
  }
  async load_repo(url) {
    return await GitHubFileSystem.fromURLs(url) ?? await CodebergFileSystem.fromURLs(url);
  }
  async setup_project(vfs) {
    this.loaded = false;
    this.loading = true;
    try {
      await vfs.setup();
      await this.project.load(vfs);
      this.project.set_active_page(this.project.first_page);
      this.loaded = true;
    } catch (e) {
      console.error(e);
    } finally {
      this.loading = false;
    }
  }
  render() {
    this.#schematic_app = html`
            <kc-schematic-app controls="full"></kc-schematic-app>
        `;
    this.#board_app = html`
            <kc-board-app controls="full"></kc-board-app>
        `;
    return html`
            <kc-ui-app>
                <section class="overlay">
                    <h1>
                        <img src="images/kicanvas.png" />
                        KiCanvas
                    </h1>
                    <p>
                        KiCanvas is an
                        <strong>interactive</strong>
                        ,
                        <strong>browser-based</strong>
                        viewer for KiCad schematics and boards. You can learn
                        more from the
                        <a href="https://kicanvas.org/home" target="_blank"
                            >docs</a
                        >. It's in
                        <strong>alpha</strong>
                        so please
                        <a
                            href="https://github.com/theacodes/kicanvas/issues/new/choose"
                            target="_blank">
                            report any bugs</a
                        >!
                    </p>
                    <input
                        name="link"
                        type="text"
                        placeholder="Paste a GitHub/Codeberg link..."
                        autofocus />
                    <p>
                        or drag & drop your KiCad files, or<button
                            name="open_local"
                            class="link_button">
                            open from local
                        </button>
                    </p>
                    <p class="note">
                        KiCanvas is
                        <a
                            href="https://github.com/theacodes/kicanvas"
                            target="_blank"
                            >free & open source</a
                        >
                        and supported by
                        <a
                            href="https://github.com/theacodes/kicanvas#special-thanks"
                            >community donations</a
                        >
                        with significant support from
                        <a href="https://partsbox.com/" target="_blank"
                            >PartsBox</a
                        >,
                        <a href="https://blues.io/" target="_blank">Blues</a>,
                        <a href="https://blog.mithis.net/" target="_blank"
                            >Mithro</a
                        >,
                        <a href="https://github.com/jeremysf">Jeremy Gordon</a>,
                        &
                        <a href="https://github.com/jamesneal" target="_blank"
                            >James Neal</a
                        >. KiCanvas runs entirely within your browser, so your
                        files don't ever leave your machine.
                    </p>
                    <p class="github">
                        <a
                            href="https://github.com/theacodes/kicanvas"
                            target="_blank"
                            title="Visit on GitHub">
                            <img src="images/github-mark-white.svg" />
                        </a>
                    </p>
                </section>
                <main>${this.#schematic_app} ${this.#board_app}</main>
            </kc-ui-app>
        `;
  }
};
__decorateClass([
  attribute({ type: Boolean })
], KiCanvasShellElement.prototype, "loading", 2);
__decorateClass([
  attribute({ type: Boolean })
], KiCanvasShellElement.prototype, "loaded", 2);
__decorateClass([
  attribute({ type: String })
], KiCanvasShellElement.prototype, "src", 2);
__decorateClass([
  query(`input[name="link"]`, true)
], KiCanvasShellElement.prototype, "link_input", 2);
__decorateClass([
  query(`button[name="open_local"]`, true)
], KiCanvasShellElement.prototype, "open_file_button", 2);
window.customElements.define("kc-kicanvas-shell", KiCanvasShellElement);

// kicanvas/elements/kicanvas-embed.ts
var log5 = new Logger("kicanvas:embedtag");
var KiCanvasEmbedElement = class extends KCUIElement {
  constructor() {
    super();
    this.#project = new Project();
    this.custom_resolver = null;
    this.provideContext("project", this.#project);
  }
  static {
    __name(this, "KiCanvasEmbedElement");
  }
  static {
    this.styles = [
      ...KCUIElement.styles,
      new CSS(kc_ui_default),
      css`
            :host {
                margin: 0;
                display: flex;
                position: relative;
                width: 100%;
                max-height: 100%;
                aspect-ratio: 1.414;
                background-color: aqua;
                color: var(--fg);
                font-family:
                    "Nunito", ui-rounded, "Hiragino Maru Gothic ProN",
                    Quicksand, Comfortaa, Manjari, "Arial Rounded MT Bold",
                    Calibri, source-sans-pro, sans-serif;
                contain: layout paint;
            }

            main {
                display: contents;
            }

            kc-board-app,
            kc-schematic-app {
                width: 100%;
                height: 100%;
                flex: 1;
            }
        `
    ];
  }
  #project;
  #schematic_app;
  #board_app;
  initialContentCallback() {
    this.#setup_events();
    later(() => {
      this.#load_src();
    });
  }
  async #setup_events() {
  }
  async #load_src() {
    const url_src = [];
    const inline_file = [];
    if (this.src) {
      url_src.push(this.src);
    }
    let inline_count = 0;
    for (const src_elm of this.querySelectorAll(
      "kicanvas-source"
    )) {
      if (src_elm.src) {
        url_src.push(src_elm.src);
      } else if (src_elm.is_inline_source()) {
        const default_name = `inline_${inline_count}`;
        inline_count += 1;
        const file = src_elm.load_inline_source(default_name);
        if (file) {
          log5.info(
            `Determined inline source ${file.name}, ${file.size} bytes`
          );
          inline_file.push(file);
        }
      }
    }
    const url_vfs = url_src.length === 0 ? null : new FetchFileSystem(url_src, this.custom_resolver);
    const inline_vfs = inline_file.length === 0 ? null : new LocalFileSystem(inline_file);
    if (url_vfs === null && inline_vfs === null) {
      log5.warn("No valid sources specified");
      return;
    }
    const vfs = new MergedFileSystem([url_vfs, inline_vfs]);
    await this.#setup_project(vfs);
  }
  async #setup_project(vfs) {
    this.loaded = false;
    this.loading = true;
    try {
      await vfs.setup();
      await this.#project.load(vfs);
      this.loaded = true;
      await this.update();
      this.#project.set_active_page(this.#project.root_schematic_page);
    } finally {
      this.loading = false;
    }
  }
  render() {
    if (!this.loaded) {
      return html``;
    }
    if (this.#project.has_schematics && !this.#schematic_app) {
      this.#schematic_app = html`<kc-schematic-app
                sidebarcollapsed
                controls="${this.controls}"
                controlslist="${this.controlslist}">
            </kc-schematic-app>`;
    }
    if (this.#project.has_boards && !this.#board_app) {
      this.#board_app = html`<kc-board-app
                sidebarcollapsed
                controls="${this.controls}"
                controlslist="${this.controlslist}">
            </kc-board-app>`;
    }
    const focus_overlay = (this.controls ?? "none") == "none" || this.controlslist?.includes("nooverlay") ? null : html`<kc-ui-focus-overlay></kc-ui-focus-overlay>`;
    return html`<main>
            ${this.#schematic_app} ${this.#board_app} ${focus_overlay}
        </main>`;
  }
};
__decorateClass([
  attribute({ type: String })
], KiCanvasEmbedElement.prototype, "src", 2);
__decorateClass([
  attribute({ type: Boolean })
], KiCanvasEmbedElement.prototype, "loading", 2);
__decorateClass([
  attribute({ type: Boolean })
], KiCanvasEmbedElement.prototype, "loaded", 2);
__decorateClass([
  attribute({ type: String })
], KiCanvasEmbedElement.prototype, "controls", 2);
__decorateClass([
  attribute({ type: String })
], KiCanvasEmbedElement.prototype, "controlslist", 2);
__decorateClass([
  attribute({ type: String })
], KiCanvasEmbedElement.prototype, "theme", 2);
__decorateClass([
  attribute({ type: String })
], KiCanvasEmbedElement.prototype, "zoom", 2);
window.customElements.define("kicanvas-embed", KiCanvasEmbedElement);
var _KiCanvasSourceElement = class _KiCanvasSourceElement extends CustomElement {
  static {
    __name(this, "KiCanvasSourceElement");
  }
  constructor() {
    super();
  }
  connectedCallback() {
    this.ariaHidden = "true";
    this.hidden = true;
    this.style.display = "none";
    super.connectedCallback();
  }
  is_inline_source() {
    return this.src === null && this.childNodes.length > 0;
  }
  load_inline_source(default_name = null) {
    let content = "";
    for (const child of this.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        content += child.nodeValue ?? "";
      } else {
        log5.warn(
          `kicanvas-source children ${child.nodeType} are invaild.`
        );
      }
    }
    content = content.trimStart();
    let file_name;
    if (this.name) {
      file_name = this.name;
    } else {
      const typ = this.type ?? _KiCanvasSourceElement.determine_file_type(content);
      if (typ === void 0) {
        log5.warn(
          `Unknown file type, content: ${content.slice(0, 64)}...`
        );
        return void 0;
      }
      const ext = _KiCanvasSourceElement.get_file_ext(typ);
      file_name = (default_name ?? "noname") + ext;
    }
    if (content.length === 0) {
      log5.warn(`kicanvas-source content ${file_name} is empty.`);
      return void 0;
    }
    const file_blob = new Blob([content], { type: "text/plain" });
    const file = new File([file_blob], file_name);
    return file;
  }
  static determine_file_type(content) {
    if (content.startsWith("(kicad_sch")) {
      return "schematic" /* Schematic */;
    } else if (content.startsWith("(kicad_pcb")) {
      return "board" /* Board */;
    } else if (content.startsWith("(kicad_wks")) {
      return "worksheet" /* Worksheet */;
    } else if (content.startsWith("{")) {
      return "project" /* Project */;
    }
    return void 0;
  }
  static get_file_ext(typ) {
    switch (typ) {
      case "schematic" /* Schematic */:
        return ".kicad_sch";
      case "board" /* Board */:
        return ".kicad_pcb";
      case "worksheet" /* Worksheet */:
        return ".kicad_wks";
      case "project" /* Project */:
        return ".kicad_prj";
    }
  }
};
__decorateClass([
  attribute({ type: String })
], _KiCanvasSourceElement.prototype, "src", 2);
__decorateClass([
  attribute({ type: String })
], _KiCanvasSourceElement.prototype, "type", 2);
__decorateClass([
  attribute({ type: String })
], _KiCanvasSourceElement.prototype, "name", 2);
var KiCanvasSourceElement = _KiCanvasSourceElement;
window.customElements.define("kicanvas-source", KiCanvasSourceElement);
