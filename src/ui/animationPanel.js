/**
 * English: Builds the animation panel — base action buttons, additive weight sliders, speed and pause.
 * 中文：创建动画控制面板 —— 基础动作按钮、叠加姿态权重滑条、速度与暂停控制。
 */

/** 中文标签，找不到时直接显示原名 */
const LABELS = {
  None: '静止',
  idle: '待机 idle',
  walk: '走路 walk',
  run: '奔跑 run',
  sneak_pose: '潜行 sneak',
  sad_pose: '沮丧 sad',
  agree: '点头 agree',
  headShake: '摇头 shake',
};

const labelOf = (name) => LABELS[name] ?? name;

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import('../features/animationController.js').createAnimationController>} controller
 */
export function createAnimationPanel(container, controller) {
  const panel = document.createElement('section');
  panel.className = 'anim-panel';
  panel.setAttribute('aria-label', '动画控制');

  // ---------- 基础动作 ----------
  panel.appendChild(makeTitle('基础动作（同时只有一个）'));

  const baseRow = document.createElement('div');
  baseRow.className = 'anim-panel__clips';
  baseRow.setAttribute('role', 'group');

  /** @type {Map<string, HTMLButtonElement>} */
  const baseButtons = new Map();

  for (const name of ['None', ...controller.baseNames]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anim-panel__clip';
    button.textContent = labelOf(name);
    button.addEventListener('click', () => {
      controller.switchBaseAction(name);
      syncActive();
    });
    baseButtons.set(name, button);
    baseRow.appendChild(button);
  }
  panel.appendChild(baseRow);

  // ---------- 叠加姿态 ----------
  if (controller.additiveNames.length > 0) {
    panel.appendChild(makeTitle('叠加姿态（可与基础动作混合）'));

    const additiveBox = document.createElement('div');
    additiveBox.className = 'anim-panel__additives';

    for (const name of controller.additiveNames) {
      additiveBox.appendChild(makeSlider(labelOf(name), 0, 1, 0.01, 0, (value) => {
        controller.setAdditiveWeight(name, value);
      }));
    }
    panel.appendChild(additiveBox);
  }

  // ---------- 播放控制 ----------
  panel.appendChild(makeTitle('播放控制'));

  const controlsBox = document.createElement('div');
  controlsBox.className = 'anim-panel__controls';

  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.className = 'anim-panel__action';
  pauseButton.textContent = '暂停';
  pauseButton.addEventListener('click', () => {
    pauseButton.textContent = controller.togglePause() ? '继续' : '暂停';
  });
  controlsBox.appendChild(pauseButton);

  controlsBox.appendChild(
    makeSlider('速度', 0, 1.5, 0.01, 1, (value) => controller.setSpeed(value), 'x'),
  );

  panel.appendChild(controlsBox);
  container.appendChild(panel);

  function syncActive() {
    const current = controller.getCurrentBaseName();
    for (const [name, button] of baseButtons) {
      button.classList.toggle('is-active', name === current);
    }
  }

  syncActive();

  return { element: panel, syncActive };
}

function makeTitle(text) {
  const title = document.createElement('h2');
  title.className = 'anim-panel__title';
  title.textContent = text;
  return title;
}

/**
 * 生成「标签 + 数值 + 滑条」一组控件。
 */
function makeSlider(label, min, max, step, value, onChange, suffix = '') {
  const wrapper = document.createElement('label');
  wrapper.className = 'anim-panel__slider';

  const head = document.createElement('span');
  head.className = 'anim-panel__slider-head';

  const name = document.createElement('span');
  name.textContent = label;

  const readout = document.createElement('span');
  readout.className = 'anim-panel__slider-value';
  readout.textContent = `${value.toFixed(2)}${suffix}`;

  head.append(name, readout);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    readout.textContent = `${next.toFixed(2)}${suffix}`;
    onChange(next);
  });

  wrapper.append(head, input);
  return wrapper;
}
