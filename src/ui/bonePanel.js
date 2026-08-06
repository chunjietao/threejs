/**
 * English: Builds a side panel that lists every bone found on the loaded character.
 * 中文：创建侧栏面板，列出骨骼；支持搜索过滤、眼睛控制 3D 高亮，以及一键清除全部高亮。
 */

/**
 * 从模型场景图中收集所有 Bone。
 * @param {import('three').Object3D} model
 * @returns {import('three').Bone[]}
 */
export function collectBones(model) {
  /** @type {import('three').Bone[]} */
  const bones = [];
  model.traverse((object) => {
    if (object.isBone) bones.push(object);
  });
  return bones;
}

/**
 * @param {HTMLElement} container
 * @param {import('three').Bone[]} bones
 * @param {object} [options]
 * @param {(boneName: string) => void} [options.onSelect]
 * @param {(boneName: string, visible: boolean) => void} [options.onToggleVisible]
 * @param {(boneName: string) => boolean} [options.isVisible]
 * @param {() => void} [options.onClearHighlights]
 */
export function createBonePanel(container, bones, options = {}) {
  const { onSelect, onToggleVisible, isVisible, onClearHighlights } = options;

  const panel = document.createElement('section');
  panel.className = 'bone-panel';
  panel.setAttribute('aria-label', '骨骼列表');

  const head = document.createElement('div');
  head.className = 'bone-panel__head';

  const title = document.createElement('h2');
  title.className = 'bone-panel__title';
  title.textContent = `骨骼列表（${bones.length}）`;

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'bone-panel__btn';
  clearBtn.textContent = '清除高亮';
  clearBtn.title = '关闭模型上全部骨骼高亮';
  clearBtn.addEventListener('click', () => {
    onClearHighlights?.();
  });

  head.append(title, clearBtn);
  panel.appendChild(head);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'bone-panel__search';
  search.placeholder = '搜索骨骼 / 关节…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', '搜索骨骼');
  panel.appendChild(search);

  /** @type {Map<string, HTMLLIElement>} */
  const itemByName = new Map();
  /** @type {Map<string, HTMLSpanElement>} */
  const jointLabelByBone = new Map();
  /** @type {Map<string, HTMLButtonElement>} */
  const eyeByBone = new Map();
  /** @type {Map<string, string>} bone → 当前映射关节文案（用于搜索） */
  const jointTextByBone = new Map();

  const emptyFilter = document.createElement('p');
  emptyFilter.className = 'bone-panel__empty';
  emptyFilter.textContent = '无匹配骨骼';
  emptyFilter.hidden = true;

  if (bones.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'bone-panel__empty';
    empty.textContent = '未找到骨骼';
    panel.appendChild(empty);
    container.appendChild(panel);
    return {
      element: panel,
      setActive: () => {},
      setLinked: () => {},
      setMappedJoints: () => {},
      setEyeVisible: () => {},
      clearHighlight: () => {},
      clearAllEyes: () => {},
    };
  }

  const list = document.createElement('ol');
  list.className = 'bone-panel__list';

  for (const bone of bones) {
    const boneName = bone.name || '(unnamed)';
    const shortName = boneName.replace(/^mixamorig:/, '');
    const item = document.createElement('li');
    item.className = 'bone-panel__item';
    item.dataset.bone = boneName;
    item.dataset.search = `${boneName} ${shortName}`.toLowerCase();

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'bone-panel__eye';
    eye.title = '显示/隐藏模型上的骨骼高亮';
    eye.setAttribute('aria-label', `切换 ${boneName} 高亮`);
    eye.appendChild(createEyeIcon());
    syncEyeButton(eye, isVisible?.(boneName) ?? false);
    eye.addEventListener('click', (event) => {
      event.stopPropagation();
      const currentlyOn =
        isVisible?.(boneName) ?? eye.classList.contains('is-on');
      const next = !currentlyOn;
      syncEyeButton(eye, next);
      onToggleVisible?.(boneName, next);
    });

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'bone-panel__name';
    name.textContent = shortName;
    name.title = boneName;
    name.addEventListener('click', () => onSelect?.(boneName));

    const jointLabel = document.createElement('span');
    jointLabel.className = 'bone-panel__joint';
    jointLabel.textContent = '—';

    item.append(eye, name, jointLabel);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect?.(boneName);
      }
    });
    item.tabIndex = 0;

    list.appendChild(item);
    itemByName.set(boneName, item);
    jointLabelByBone.set(boneName, jointLabel);
    eyeByBone.set(boneName, eye);
    jointTextByBone.set(boneName, '');
  }

  panel.append(emptyFilter, list);
  container.appendChild(panel);

  function applyFilter() {
    const q = search.value.trim().toLowerCase();
    let visibleCount = 0;

    for (const [boneName, item] of itemByName) {
      const jointText = jointTextByBone.get(boneName) ?? '';
      const haystack = `${item.dataset.search ?? ''} ${jointText}`.toLowerCase();
      const match = !q || haystack.includes(q);
      item.hidden = !match;
      if (match) visibleCount += 1;
    }

    emptyFilter.hidden = visibleCount > 0;
    list.hidden = visibleCount === 0;
    title.textContent = q
      ? `骨骼列表（${visibleCount}/${bones.length}）`
      : `骨骼列表（${bones.length}）`;
  }

  search.addEventListener('input', applyFilter);

  /** @param {string | null} boneName */
  function setActive(boneName) {
    for (const [name, item] of itemByName) {
      item.classList.toggle('is-active', name === boneName);
    }
    if (boneName) {
      const item = itemByName.get(boneName);
      if (item && !item.hidden) {
        item.scrollIntoView({ block: 'nearest' });
      }
      const eye = eyeByBone.get(boneName);
      if (eye && (isVisible?.(boneName) ?? true)) {
        syncEyeButton(eye, true);
      }
    }
  }

  /** @param {Iterable<string>} boneNames */
  function setLinked(boneNames) {
    const linked = new Set(boneNames);
    for (const [name, item] of itemByName) {
      item.classList.toggle('is-linked', linked.has(name));
    }
  }

  /**
   * @param {Array<{ joint: string, bone: string }>} paired
   */
  function setMappedJoints(paired) {
    /** @type {Map<string, string[]>} */
    const jointsByBone = new Map();
    for (const { joint, bone } of paired) {
      if (!bone) continue;
      const listForBone = jointsByBone.get(bone) ?? [];
      listForBone.push(joint);
      jointsByBone.set(bone, listForBone);
    }

    for (const [boneName, label] of jointLabelByBone) {
      const joints = jointsByBone.get(boneName) ?? [];
      if (joints.length === 0) {
        label.textContent = '—';
        label.title = '';
        label.classList.remove('is-mapped');
        jointTextByBone.set(boneName, '');
      } else {
        const text = joints.join(', ');
        label.textContent = text;
        label.title = text;
        label.classList.add('is-mapped');
        jointTextByBone.set(boneName, text);
      }
    }

    applyFilter();
  }

  /** @param {string} boneName @param {boolean} visible */
  function setEyeVisible(boneName, visible) {
    const eye = eyeByBone.get(boneName);
    if (eye) syncEyeButton(eye, visible);
  }

  /** 关掉列表选中态，以及所有眼睛按钮 */
  function clearAllEyes() {
    for (const item of itemByName.values()) {
      item.classList.remove('is-active');
    }
    for (const eye of eyeByBone.values()) {
      syncEyeButton(eye, false);
    }
  }

  function clearHighlight() {
    for (const item of itemByName.values()) {
      item.classList.remove('is-active', 'is-linked');
    }
  }

  return {
    element: panel,
    setActive,
    setLinked,
    setMappedJoints,
    setEyeVisible,
    clearHighlight,
    clearAllEyes,
  };
}

/**
 * @param {HTMLButtonElement} eye
 * @param {boolean} on
 */
function syncEyeButton(eye, on) {
  eye.classList.toggle('is-on', on);
  eye.classList.toggle('is-off', !on);
  eye.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/**
 * 创建通用 SVG 眼睛图标；关闭状态由 CSS 显示斜线。
 * @returns {SVGSVGElement}
 */
function createEyeIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('bone-panel__eye-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const eye = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  eye.setAttribute(
    'd',
    'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z',
  );

  const pupil = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pupil.setAttribute('cx', '12');
  pupil.setAttribute('cy', '12');
  pupil.setAttribute('r', '2.5');

  const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  slash.classList.add('bone-panel__eye-slash');
  slash.setAttribute('d', 'M4 4 20 20');

  svg.append(eye, pupil, slash);
  return svg;
}
