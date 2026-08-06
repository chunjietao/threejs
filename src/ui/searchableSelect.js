/**
 * English: Searchable bone picker popup used by the joint→bone mapping UI.
 * 中文：可搜索的骨骼选择弹框，供关节映射下拉使用（支持关键字过滤）。
 */

/**
 * @typedef {{
 *   value: string,
 *   label: string,
 * }} SearchableOption
 */

/**
 * @param {object} options
 * @param {string} options.ariaLabel
 * @param {SearchableOption[]} options.items
 * @param {string} [options.value]
 * @param {string} [options.emptyLabel]
 * @param {(value: string) => void} [options.onChange]
 */
export function createSearchableSelect({
  ariaLabel,
  items,
  value = '',
  emptyLabel = '未映射',
  onChange,
}) {
  const root = document.createElement('div');
  root.className = 'search-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'search-select__trigger';
  trigger.setAttribute('aria-label', ariaLabel);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const popover = document.createElement('div');
  popover.className = 'search-select__popover';
  popover.hidden = true;

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'search-select__search';
  search.placeholder = '搜索骨骼…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', '搜索骨骼');

  const list = document.createElement('ul');
  list.className = 'search-select__list';
  list.setAttribute('role', 'listbox');

  const empty = document.createElement('div');
  empty.className = 'search-select__empty';
  empty.textContent = '无匹配结果';
  empty.hidden = true;

  popover.append(search, list, empty);
  root.appendChild(trigger);
  // 挂到 body，避免被父级 overflow 裁切
  document.body.appendChild(popover);

  /** @type {string} */
  let currentValue = value;
  /** @type {HTMLButtonElement[]} */
  let optionButtons = [];

  function labelOf(val) {
    if (!val) return emptyLabel;
    const hit = items.find((item) => item.value === val);
    return hit?.label ?? val.replace(/^mixamorig:/, '');
  }

  function syncTrigger() {
    trigger.textContent = labelOf(currentValue);
    trigger.classList.toggle('is-empty', !currentValue);
  }

  function placePopover() {
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const preferBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(280, preferBelow ? spaceBelow : spaceAbove);

    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(8, left)}px`;
    popover.style.maxHeight = `${Math.max(140, maxHeight)}px`;

    if (preferBelow) {
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.bottom = 'auto';
    } else {
      popover.style.top = 'auto';
      popover.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    }
  }

  /**
   * @param {string} [query]
   */
  function renderOptions(query = '') {
    const q = query.trim().toLowerCase();
    list.replaceChildren();
    optionButtons = [];

    /** @type {SearchableOption[]} */
    const options = [{ value: '', label: emptyLabel }, ...items];
    const filtered = q
      ? options.filter((item) => {
          const short = item.label.toLowerCase();
          const full = item.value.toLowerCase();
          return short.includes(q) || full.includes(q);
        })
      : options;

    empty.hidden = filtered.length > 0;

    for (const item of filtered) {
      const li = document.createElement('li');
      li.className = 'search-select__option-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-select__option';
      btn.setAttribute('role', 'option');
      btn.dataset.value = item.value;
      btn.textContent = item.label || emptyLabel;
      btn.classList.toggle('is-selected', item.value === currentValue);
      btn.setAttribute(
        'aria-selected',
        item.value === currentValue ? 'true' : 'false',
      );

      btn.addEventListener('click', () => {
        currentValue = item.value;
        syncTrigger();
        close();
        onChange?.(currentValue);
      });

      li.appendChild(btn);
      list.appendChild(li);
      optionButtons.push(btn);
    }

    const selected = optionButtons.find((btn) =>
      btn.classList.contains('is-selected'),
    );
    selected?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (!popover.hidden) return;
    // 先关闭其他已打开的搜索弹框
    document.querySelectorAll('.search-select.is-open').forEach((el) => {
      if (el === root) return;
      el.classList.remove('is-open');
      const btn = el.querySelector('.search-select__trigger');
      btn?.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.search-select__popover:not([hidden])').forEach((el) => {
      if (el !== popover) el.hidden = true;
    });

    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    search.value = '';
    placePopover();
    renderOptions('');
    requestAnimationFrame(() => {
      search.focus();
      search.select();
    });
  }

  function close() {
    if (popover.hidden) return;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-open');
  }

  function toggle() {
    if (popover.hidden) open();
    else close();
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  });

  search.addEventListener('input', () => {
    renderOptions(search.value);
  });

  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      optionButtons[0]?.click();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node)) return;
    if (root.contains(event.target) || popover.contains(event.target)) return;
    close();
  });

  window.addEventListener('resize', () => {
    if (!popover.hidden) placePopover();
  });

  syncTrigger();

  return {
    element: root,
    get value() {
      return currentValue;
    },
    set value(next) {
      currentValue = next ?? '';
      syncTrigger();
      if (!popover.hidden) renderOptions(search.value);
    },
    open,
    close,
  };
}
