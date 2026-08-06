/**
 * English: Manages base actions (idle/walk/run) with cross-fade and additive pose actions by weight.
 * 中文：管理基础动作（idle/walk/run）的交叉淡入淡出，以及叠加姿态动作的权重混合。
 *
 * 【为什么之前 sneak_pose / sad_pose 会抽搐？】
 * 这些片段是「叠加动画 additive」，它们只记录相对于参考帧的偏移量，
 * 直接当普通动画播放会和骨骼基准姿态冲突，看起来就像抽搐。
 * 正确做法（参考 three.js 官方示例 webgl_animation_skinning_additive_blending）：
 *   1) THREE.AnimationUtils.makeClipAdditive(clip) 转成叠加片段
 *   2) 名字以 _pose 结尾的取一小段静态子片段 subclip
 *   3) 全部 play()，通过 setEffectiveWeight 控制强度，而不是切换播放
 */
import * as THREE from 'three';

/** 基础动作：同一时刻只有一个生效，通过交叉淡入淡出切换 */
const BASE_NAMES = ['idle', 'walk', 'run'];

/** 叠加动作：叠加在基础动作之上，用 0~1 权重控制强度 */
const ADDITIVE_NAMES = ['sneak_pose', 'sad_pose', 'agree', 'headShake'];

/**
 * 设置权重时必须重置 timeScale，因为 crossFadeTo 会修改它。
 * @param {THREE.AnimationAction} action
 * @param {number} weight
 */
function setWeight(action, weight) {
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(weight);
}

/**
 * @param {THREE.AnimationMixer} mixer
 * @param {THREE.AnimationClip[]} clips
 */
export function createAnimationController(mixer, clips) {
  /** @type {Record<string, { action: THREE.AnimationAction, weight: number }>} */
  const baseActions = {};
  /** @type {Record<string, { action: THREE.AnimationAction, weight: number }>} */
  const additiveActions = {};

  for (const originalClip of clips) {
    const name = originalClip.name;

    // ---------- 基础动作 ----------
    if (BASE_NAMES.includes(name)) {
      const weight = name === 'idle' ? 1 : 0; // 默认只显示 idle
      const action = mixer.clipAction(originalClip);
      setWeight(action, weight);
      action.play(); // 全部一直播放，靠权重决定谁可见
      baseActions[name] = { action, weight };
      continue;
    }

    // ---------- 叠加动作 ----------
    if (ADDITIVE_NAMES.includes(name)) {
      let clip = originalClip;

      // 第 1 步：转成叠加片段（减去参考帧，得到「相对偏移」）
      THREE.AnimationUtils.makeClipAdditive(clip);

      // 第 2 步：静态姿态类只截取第 2~3 秒的一小段，避免整段循环带来的抖动
      if (clip.name.endsWith('_pose')) {
        clip = THREE.AnimationUtils.subclip(clip, clip.name, 2, 3, 30);
      }

      // 第 3 步：一直播放，初始权重 0（不可见），由滑条控制强度
      const action = mixer.clipAction(clip);
      setWeight(action, 0);
      action.play();
      additiveActions[name] = { action, weight: 0 };
    }
  }

  /** 当前基础动作名，'None' 表示不播放任何基础动作 */
  let currentBaseName = baseActions.idle ? 'idle' : Object.keys(baseActions)[0];
  let speed = 1;
  let paused = false;

  /** 真正执行交叉淡入淡出 */
  function executeCrossFade(startAction, endAction, duration) {
    if (endAction) {
      setWeight(endAction, 1);
      endAction.time = 0;

      if (startAction) {
        // warp = true：过渡期间自动匹配两个动作的播放速度，走↔跑切换更自然
        startAction.crossFadeTo(endAction, duration, true);
      } else {
        endAction.fadeIn(duration);
      }
    } else if (startAction) {
      startAction.fadeOut(duration);
    }
  }

  /** 等当前动作播完一个循环再执行切换，保证脚步对齐，不会突然跳帧 */
  function synchronizeCrossFade(startAction, endAction, duration) {
    mixer.addEventListener('loop', onLoopFinished);

    function onLoopFinished(event) {
      if (event.action !== startAction) return;
      mixer.removeEventListener('loop', onLoopFinished);
      executeCrossFade(startAction, endAction, duration);
    }
  }

  /**
   * 切换基础动作。
   * @param {string} name - 'idle' | 'walk' | 'run' | 'None'
   * @param {number} [duration=0.35] 过渡时长（秒）
   */
  function switchBaseAction(name, duration = 0.35) {
    const startAction = baseActions[currentBaseName]?.action ?? null;
    const endAction = baseActions[name]?.action ?? null;

    if (startAction === endAction) return;

    // 从 idle 出发可以立刻切；其它动作等当前循环走完再切
    if (currentBaseName === 'idle' || !startAction || !endAction) {
      executeCrossFade(startAction, endAction, duration);
    } else {
      synchronizeCrossFade(startAction, endAction, duration);
    }

    currentBaseName = endAction ? name : 'None';
  }

  /**
   * 设置叠加动作强度。
   * @param {string} name
   * @param {number} weight - 0 完全关闭，1 完全生效
   */
  function setAdditiveWeight(name, weight) {
    const entry = additiveActions[name];
    if (!entry) return;
    setWeight(entry.action, weight);
    entry.weight = weight;
  }

  /**
   * 全局播放速度（对所有动作生效）。
   * @param {number} value
   */
  function setSpeed(value) {
    speed = value;
    if (!paused) mixer.timeScale = speed;
  }

  /** 用 mixer.timeScale 归零实现暂停，比逐个 action.paused 更稳妥 */
  function togglePause() {
    paused = !paused;
    mixer.timeScale = paused ? 0 : speed;
    return paused;
  }

  function update(delta) {
    mixer.update(delta);
  }

  return {
    baseNames: Object.keys(baseActions),
    additiveNames: Object.keys(additiveActions),
    getCurrentBaseName: () => currentBaseName,
    isPaused: () => paused,
    switchBaseAction,
    setAdditiveWeight,
    setSpeed,
    togglePause,
    update,
  };
}
