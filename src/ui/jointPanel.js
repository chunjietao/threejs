/**
 * English: Joint list panel with searchable joint→bone mapping picker and highlight sync.
 * 中文：关节列表面板；映射通过可搜索弹框选择骨骼，并支持高亮与 JSON 持久化。
 */
import {
    downloadMappingJson,
    pickMappingJsonFile,
} from '../features/jointBoneMapStorage.js';
import { createSearchableSelect } from './searchableSelect.js';

/**
 * @param {HTMLElement} container
 * @param {string[]} joints
 * @param {object} [options]
 * @param {ReturnType<import('../features/jointBoneMap.js').createJointBoneMap>} [options.mapping]
 * @param {(jointName: string) => void} [options.onSelect]
 */
export function createJointPanel(container, joints, options = {}) {
  const { mapping, onSelect } = options;

  const panel = document.createElement('section');
  panel.className = 'joint-panel';
  panel.setAttribute('aria-label', '关节列表');

  const head = document.createElement('div');
  head.className = 'joint-panel__head';

  const title = document.createElement('h2');
  title.className = 'joint-panel__title';
  title.textContent = `关节列表（${joints.length}）`;
  head.appendChild(title);

  if (mapping) {
    const actions = document.createElement('div');
    actions.className = 'joint-panel__actions';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'joint-panel__btn';
    exportBtn.textContent = '导出';
    exportBtn.title = '下载映射 JSON';
    exportBtn.addEventListener('click', () => {
      downloadMappingJson(mapping.getSnapshot().map);
    });

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'joint-panel__btn';
    importBtn.textContent = '导入';
    importBtn.title = '从 JSON 文件导入映射';
    importBtn.addEventListener('click', async () => {
      const map = await pickMappingJsonFile();
      if (!map) return;
      mapping.applyMap(map);
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'joint-panel__btn';
    resetBtn.textContent = '默认';
    resetBtn.title = '恢复默认映射';
    resetBtn.addEventListener('click', () => mapping.resetToDefaults());

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'joint-panel__btn';
    clearBtn.textContent = '清空';
    clearBtn.title = '清空全部映射';
    clearBtn.addEventListener('click', () => mapping.clearAll());

    actions.append(exportBtn, importBtn, resetBtn, clearBtn);
    head.appendChild(actions);
  }

  panel.appendChild(head);

  const status = document.createElement('p');
  status.className = 'joint-panel__status';
  if (mapping) panel.appendChild(status);

  /** @type {Map<string, HTMLLIElement>} */
  const itemByName = new Map();
  /** @type {Map<string, ReturnType<typeof createSearchableSelect>>} */
  const pickerByJoint = new Map();

  if (joints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'joint-panel__empty';
    empty.textContent = '未找到关节';
    panel.appendChild(empty);
    container.appendChild(panel);
    return {
      element: panel,
      setActive: () => {},
      setLinked: () => {},
      clearHighlight: () => {},
    };
  }

  const boneItems = (mapping?.boneNames ?? []).map((boneName) => ({
    value: boneName,
    label: boneName.replace(/^mixamorig:/, ''),
  }));

  const list = document.createElement('ol');
  list.className = 'joint-panel__list';

  for (const jointName of joints) {
    const item = document.createElement('li');
    item.className = 'joint-panel__item';
    item.dataset.joint = jointName;

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'joint-panel__name';
    name.textContent = jointName;
    name.addEventListener('click', () => onSelect?.(jointName));

    item.appendChild(name);

    if (mapping) {
      const picker = createSearchableSelect({
        ariaLabel: `${jointName} 对应骨骼`,
        items: boneItems,
        emptyLabel: '未映射',
        value: mapping.getBoneForJoint(jointName) ?? '',
        onChange(value) {
          mapping.setMapping(jointName, value || null);
          onSelect?.(jointName);
        },
      });

      item.appendChild(picker.element);
      pickerByJoint.set(jointName, picker);
    }

    list.appendChild(item);
    itemByName.set(jointName, item);
  }

  panel.appendChild(list);
  container.appendChild(panel);

  /** @param {string | null} jointName */
  function setActive(jointName) {
    for (const [name, item] of itemByName) {
      item.classList.toggle('is-active', name === jointName);
    }
    if (jointName) {
      itemByName.get(jointName)?.scrollIntoView({ block: 'nearest' });
    }
  }

  /** @param {Iterable<string>} jointNames */
  function setLinked(jointNames) {
    const linked = new Set(jointNames);
    for (const [name, item] of itemByName) {
      item.classList.toggle('is-linked', linked.has(name));
    }
  }

  function clearHighlight() {
    for (const item of itemByName.values()) {
      item.classList.remove('is-active', 'is-linked');
    }
  }

  function syncMapping(snapshot = mapping?.getSnapshot()) {
    if (!mapping || !snapshot) return;
    for (const [joint, picker] of pickerByJoint) {
      picker.value = snapshot.map[joint] ?? '';
    }
    status.textContent = `已映射 ${snapshot.paired.length}/${snapshot.jointCount}`;
  }

  if (mapping) {
    mapping.subscribe(syncMapping);
    syncMapping();
  }

  return { element: panel, setActive, setLinked, clearHighlight, syncMapping };
}
