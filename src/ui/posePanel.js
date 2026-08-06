/**
 * English: Bottom pose playback bar — play/pause, scrubber, frame label (n/N).
 * 中文：底部姿势播放条 —— 播放/暂停、滑条定格、帧号文案（n/N）。
 */

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import('../features/posePlayback.js').createPosePlayback>} playback
 */
export function createPosePanel(container, playback) {
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

  panel.append(playBtn, slider, label);
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
