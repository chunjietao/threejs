/**
 * English: Top bar to pick a SwingPose3D .pb file (local file or bundled sample).
 * 中文：顶部 pb 文件选择条 —— 可选择本地 .pb 文件，或加载项目自带示例；
 *       启动时不加载任何数据，选择后才解码并驱动模型，可随时重新选择。
 */

/**
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {(file: File) => void} [options.onPickFile] - 选中本地文件
 * @param {() => void} [options.onPickSample] - 点击「加载示例」
 * @param {string} [options.sampleLabel]
 */
export function createFilePanel(container, options = {}) {
  const { onPickFile, onPickSample, sampleLabel = '加载示例' } = options;

  const panel = document.createElement('section');
  panel.className = 'file-panel';
  panel.setAttribute('aria-label', 'pb 文件选择');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pb,.bin,application/octet-stream';
  input.className = 'file-panel__input';
  input.setAttribute('aria-label', '选择 pb 文件');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    // 复位 value，保证再次选择同一个文件也能触发 change
    input.value = '';
    if (file) onPickFile?.(file);
  });

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'file-panel__btn file-panel__btn--primary';
  pickBtn.textContent = '选择 pb 文件';
  pickBtn.title = '选择本地 SwingPose3D .pb 文件';
  pickBtn.addEventListener('click', () => input.click());

  const sampleBtn = document.createElement('button');
  sampleBtn.type = 'button';
  sampleBtn.className = 'file-panel__btn';
  sampleBtn.textContent = sampleLabel;
  sampleBtn.title = '加载项目自带的 swing_pose3d.pb';
  sampleBtn.addEventListener('click', () => onPickSample?.());

  const status = document.createElement('span');
  status.className = 'file-panel__status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = '未选择文件';

  panel.append(input, pickBtn, sampleBtn, status);
  container.appendChild(panel);

  /**
   * @param {string} text
   * @param {'idle' | 'loading' | 'ok' | 'error'} [kind]
   */
  function setStatus(text, kind = 'idle') {
    status.textContent = text;
    status.classList.toggle('is-loading', kind === 'loading');
    status.classList.toggle('is-ok', kind === 'ok');
    status.classList.toggle('is-error', kind === 'error');
  }

  /** @param {boolean} busy */
  function setBusy(busy) {
    pickBtn.disabled = busy;
    sampleBtn.disabled = busy;
  }

  return { element: panel, setStatus, setBusy };
}
