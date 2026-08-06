/**
 * English: Bottom pose playback bar — play/pause, scrubber, frame label, stickman X offset.
 * 中文：底部姿势播放条 —— 播放/暂停、滑条定格、帧号文案，以及火柴人相对 GLB 的 X 轴距离。
 */

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import('../features/posePlayback.js').createPosePlayback>} playback
 * @param {object} [options]
 * @param {number} [options.offsetX]
 * @param {(x: number) => void} [options.onOffsetXChange]
 */
export function createPosePanel(container, playback, options = {}) {
  const panel = document.createElement('section');
  panel.className = 'pose-panel';
  panel.setAttribute('aria-label', '姿势播放');

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'pose-panel__play';
  playBtn.setAttribute('aria-label', '播放');
  playBtn.addEventListener('click', () => {
    playback.toggle();
  });

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'pose-panel__slider';
  slider.min = '0';
  slider.max = String(Math.max(0, playback.getFrameCount() - 1));
  slider.step = '1';
  slider.value = String(playback.getFrameIndex());
  slider.setAttribute('aria-label', '帧进度');

  slider.addEventListener('input', () => {
    playback.pause();
    playback.setFrame(Number(slider.value));
  });

  const label = document.createElement('span');
  label.className = 'pose-panel__label';
  label.setAttribute('aria-live', 'polite');

  const distWrap = document.createElement('label');
  distWrap.className = 'pose-panel__distance';
  distWrap.title = '火柴人相对 GLB 的 X 轴距离（米）';

  const distText = document.createElement('span');
  distText.className = 'pose-panel__distance-label';
  distText.textContent = '距离';

  const distInput = document.createElement('input');
  distInput.type = 'number';
  distInput.className = 'pose-panel__distance-input';
  distInput.step = '0.1';
  distInput.min = '-5';
  distInput.max = '5';
  distInput.value = String(
    typeof options.offsetX === 'number' && Number.isFinite(options.offsetX)
      ? options.offsetX
      : 1.5,
  );
  distInput.setAttribute('aria-label', '火柴人 X 轴距离');
  distInput.addEventListener('input', () => {
    const x = Number(distInput.value);
    if (!Number.isFinite(x)) return;
    options.onOffsetXChange?.(x);
  });
  distInput.addEventListener('change', () => {
    const x = Number(distInput.value);
    if (!Number.isFinite(x)) {
      distInput.value = '1.5';
      options.onOffsetXChange?.(1.5);
    }
  });

  distWrap.append(distText, distInput);
  panel.append(playBtn, slider, label, distWrap);
  container.appendChild(panel);

  function sync(snap = playback.getSnapshot()) {
    const playing = snap.playing;
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    playBtn.classList.toggle('is-playing', playing);

    if (document.activeElement !== slider) {
      slider.value = String(snap.frameIndex);
    }
    label.textContent =
      snap.frameCount === 0
        ? '0/0'
        : `${snap.displayFrame}/${snap.frameCount}`;
  }

  playback.subscribe(sync);
  sync();

  return {
    element: panel,
    sync,
  };
}
