/**
 * English: Renders an object as a collapsible JSON tree panel on the page.
 * 中文：把任意对象渲染成可折叠的 JSON 树面板，用于查看 protobuf 解码结果。
 */

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {string} [options.title]
 * @param {unknown} options.data
 * @param {number} [options.defaultExpandDepth] - 默认展开深度（0=仅根）
 */
export function createJsonTreePanel(container, options) {
  const {
    title = 'JSON',
    data,
    defaultExpandDepth = 1,
  } = options;

  const panel = document.createElement('section');
  panel.className = 'json-panel';
  panel.setAttribute('aria-label', title);

  const head = document.createElement('div');
  head.className = 'json-panel__head';

  const heading = document.createElement('h2');
  heading.className = 'json-panel__title';
  heading.textContent = title;

  const actions = document.createElement('div');
  actions.className = 'json-panel__actions';

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'json-panel__btn';
  expandBtn.textContent = '全部展开';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'json-panel__btn';
  collapseBtn.textContent = '全部折叠';

  actions.append(expandBtn, collapseBtn);
  head.append(heading, actions);

  const body = document.createElement('div');
  body.className = 'json-panel__body';
  body.appendChild(renderNode(data, '', 0, defaultExpandDepth));

  expandBtn.addEventListener('click', () => setAllOpen(body, true));
  collapseBtn.addEventListener('click', () => setAllOpen(body, false));

  panel.append(head, body);
  container.appendChild(panel);

  return { element: panel };
}

/**
 * @param {HTMLElement} root
 * @param {boolean} open
 */
function setAllOpen(root, open) {
  for (const details of root.querySelectorAll('details')) {
    details.open = open;
  }
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {number} depth
 * @param {number} expandDepth
 * @returns {HTMLElement}
 */
function renderNode(value, key, depth, expandDepth) {
  if (isPlainObject(value) || Array.isArray(value)) {
    return renderCollection(value, key, depth, expandDepth);
  }
  return renderLeaf(key, value);
}

/**
 * @param {object | unknown[]} value
 * @param {string} key
 * @param {number} depth
 * @param {number} expandDepth
 */
function renderCollection(value, key, depth, expandDepth) {
  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);

  const details = document.createElement('details');
  details.className = 'json-tree__node';
  details.open = depth < expandDepth;

  const summary = document.createElement('summary');
  summary.className = 'json-tree__summary';

  const label = document.createElement('span');
  label.className = 'json-tree__key';
  label.textContent = key === '' ? (isArray ? '[]' : '{}') : key;

  const meta = document.createElement('span');
  meta.className = 'json-tree__meta';
  meta.textContent = isArray
    ? `Array(${entries.length})`
    : `Object{${entries.length}}`;

  summary.append(label, meta);
  details.appendChild(summary);

  const children = document.createElement('div');
  children.className = 'json-tree__children';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'json-tree__empty';
    empty.textContent = isArray ? '[]' : '{}';
    children.appendChild(empty);
  } else {
    for (const [childKey, childValue] of entries) {
      children.appendChild(
        renderNode(childValue, childKey, depth + 1, expandDepth),
      );
    }
  }

  details.appendChild(children);
  return details;
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function renderLeaf(key, value) {
  const row = document.createElement('div');
  row.className = 'json-tree__leaf';

  if (key !== '') {
    const label = document.createElement('span');
    label.className = 'json-tree__key';
    label.textContent = key;
    row.appendChild(label);
  }

  const val = document.createElement('span');
  val.className = `json-tree__value json-tree__value--${valueType(value)}`;
  val.textContent = formatPrimitive(value);
  row.appendChild(val);

  return row;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function valueType(value) {
  if (value === null) return 'null';
  return typeof value;
}

/** @param {unknown} value */
function formatPrimitive(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}
