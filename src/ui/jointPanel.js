/**
 * English: Builds a side panel that lists all joint names found in SwingPose3D pb data.
 * 中文：创建侧栏面板，列出 swing_pose3d.pb 中出现的全部关节（joint）名称。
 */

/**
 * @param {HTMLElement} container
 * @param {string[]} joints
 */
export function createJointPanel(container, joints) {
  const panel = document.createElement('section');
  panel.className = 'joint-panel';
  panel.setAttribute('aria-label', '关节列表');

  const title = document.createElement('h2');
  title.className = 'joint-panel__title';
  title.textContent = `关节列表（${joints.length}）`;
  panel.appendChild(title);

  if (joints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'joint-panel__empty';
    empty.textContent = '未找到关节';
    panel.appendChild(empty);
    container.appendChild(panel);
    return { element: panel };
  }

  const list = document.createElement('ol');
  list.className = 'joint-panel__list';

  for (const name of joints) {
    const item = document.createElement('li');
    item.className = 'joint-panel__item';
    item.textContent = name;
    list.appendChild(item);
  }

  panel.appendChild(list);
  container.appendChild(panel);

  return { element: panel };
}
