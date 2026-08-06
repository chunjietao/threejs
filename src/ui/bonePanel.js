/**
 * English: Builds a side panel that lists every bone found on the loaded character.
 * 中文：创建侧栏面板，列出已加载人物模型中的全部骨骼（Bone）名称。
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
 */
export function createBonePanel(container, bones) {
  const panel = document.createElement('section');
  panel.className = 'bone-panel';
  panel.setAttribute('aria-label', '骨骼列表');

  const title = document.createElement('h2');
  title.className = 'bone-panel__title';
  title.textContent = `骨骼列表（${bones.length}）`;
  panel.appendChild(title);

  if (bones.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'bone-panel__empty';
    empty.textContent = '未找到骨骼';
    panel.appendChild(empty);
    container.appendChild(panel);
    return { element: panel };
  }

  const list = document.createElement('ol');
  list.className = 'bone-panel__list';

  for (const bone of bones) {
    const item = document.createElement('li');
    item.className = 'bone-panel__item';

    const name = document.createElement('span');
    name.className = 'bone-panel__name';
    name.textContent = bone.name || '(unnamed)';

    const type = document.createElement('span');
    type.className = 'bone-panel__type';
    type.textContent = bone.type;

    item.append(name, type);
    list.appendChild(item);
  }

  panel.appendChild(list);
  container.appendChild(panel);

  return { element: panel };
}
