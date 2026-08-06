/**
 * English: Builds a side panel that lists every bone found on the loaded character.
 * 中文：创建侧栏面板，列出已加载人物模型中的全部骨骼；左侧显示原始骨骼，右侧显示已映射关节。
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
 */
export function createBonePanel(container, bones, options = {}) {
  const { onSelect } = options;

  const panel = document.createElement('section');
  panel.className = 'bone-panel';
  panel.setAttribute('aria-label', '骨骼列表');

  const title = document.createElement('h2');
  title.className = 'bone-panel__title';
  title.textContent = `骨骼列表（${bones.length}）`;
  panel.appendChild(title);

  /** @type {Map<string, HTMLLIElement>} */
  const itemByName = new Map();
  /** @type {Map<string, HTMLSpanElement>} */
  const jointLabelByBone = new Map();

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
      clearHighlight: () => {},
    };
  }

  const list = document.createElement('ol');
  list.className = 'bone-panel__list';

  for (const bone of bones) {
    const boneName = bone.name || '(unnamed)';
    const item = document.createElement('li');
    item.className = 'bone-panel__item';
    item.dataset.bone = boneName;
    item.tabIndex = 0;

    const jointLabel = document.createElement('span');
    jointLabel.className = 'bone-panel__joint';
    jointLabel.textContent = '—';

    const name = document.createElement('span');
    name.className = 'bone-panel__name';
    name.textContent = boneName.replace(/^mixamorig:/, '');
    name.title = boneName;

    item.append(name, jointLabel);
    item.addEventListener('click', () => onSelect?.(boneName));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect?.(boneName);
      }
    });

    list.appendChild(item);
    itemByName.set(boneName, item);
    jointLabelByBone.set(boneName, jointLabel);
  }

  panel.appendChild(list);
  container.appendChild(panel);

  /** @param {string | null} boneName */
  function setActive(boneName) {
    for (const [name, item] of itemByName) {
      item.classList.toggle('is-active', name === boneName);
    }
    if (boneName) itemByName.get(boneName)?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {Iterable<string>} boneNames */
  function setLinked(boneNames) {
    const linked = new Set(boneNames);
    for (const [name, item] of itemByName) {
      item.classList.toggle('is-linked', linked.has(name));
    }
  }

  /**
   * 按骨骼刷新左侧映射关节名（一块骨骼可对应多个关节）。
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
      } else {
        label.textContent = joints.join(', ');
        label.title = joints.join(', ');
        label.classList.add('is-mapped');
      }
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
    clearHighlight,
  };
}
