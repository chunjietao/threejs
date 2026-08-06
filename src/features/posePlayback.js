/**
 * English: Frame playback state for SwingPose3D — play/pause loop, scrub, time advance.
 * 中文：SwingPose3D 帧播放状态 —— 循环播放/暂停、滑条定格、按时间戳推进。
 */

const FALLBACK_DT = 1 / 30;

/**
 * @param {object} options
 * @param {object} options.data - SwingPose3D（含 frames）
 * @param {{ applyFrame: (i: number) => void, frameCount: number, addressIndex?: number }} options.driver
 */
export function createPosePlayback({ data, driver }) {
  const frames = data.frames ?? [];
  const frameCount = frames.length;
  let frameIndex = Math.max(
    0,
    Math.min(frameCount - 1, driver.addressIndex ?? 0),
  );
  let playing = false;
  /** 当前帧内已累积时间（相对本帧 timestamp） */
  let elapsedInFrame = 0;

  /** @type {Set<(snap: ReturnType<typeof snapshot>) => void>} */
  const listeners = new Set();

  function snapshot() {
    return {
      frameIndex,
      frameCount,
      playing,
      displayFrame: frameCount === 0 ? 0 : frameIndex + 1,
    };
  }

  function notify() {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  function applyCurrent() {
    if (frameCount === 0) return;
    driver.applyFrame(frameIndex);
  }

  /**
   * 两帧之间的时长（秒）。
   * @param {number} i
   */
  function durationAt(i) {
    if (frameCount < 2) return FALLBACK_DT;
    const cur = frames[i];
    const next = frames[(i + 1) % frameCount];
    const t0 = cur?.timestamp_sec;
    const t1 = next?.timestamp_sec;
    if (
      typeof t0 === 'number' &&
      typeof t1 === 'number' &&
      i < frameCount - 1 &&
      t1 > t0
    ) {
      return t1 - t0;
    }
    return FALLBACK_DT;
  }

  /** @param {number} i */
  function setFrame(i) {
    if (frameCount === 0) return;
    frameIndex = Math.max(0, Math.min(frameCount - 1, i | 0));
    elapsedInFrame = 0;
    applyCurrent();
    notify();
  }

  function play() {
    if (frameCount === 0) return;
    playing = true;
    notify();
  }

  function pause() {
    playing = false;
    elapsedInFrame = 0;
    notify();
  }

  function toggle() {
    if (playing) pause();
    else play();
    return playing;
  }

  /**
   * @param {number} delta
   */
  function update(delta) {
    if (!playing || frameCount === 0) return;

    elapsedInFrame += delta;
    let guard = frameCount + 2;
    while (elapsedInFrame >= durationAt(frameIndex) && guard-- > 0) {
      elapsedInFrame -= durationAt(frameIndex);
      frameIndex = (frameIndex + 1) % frameCount;
    }
    applyCurrent();
    notify();
  }

  /**
   * @param {(snap: ReturnType<typeof snapshot>) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // 初始定格在 address 帧
  applyCurrent();

  return {
    getFrameIndex: () => frameIndex,
    getFrameCount: () => frameCount,
    isPlaying: () => playing,
    setFrame,
    play,
    pause,
    toggle,
    update,
    subscribe,
    getSnapshot: snapshot,
  };
}
