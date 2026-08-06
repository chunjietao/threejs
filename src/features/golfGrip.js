/**
 * English: Applies a static overlapping golf-club grip to Mixamo finger bones.
 * 中文：把 Mixamo 手指骨骼固定成重叠握杆姿势（pb 无手指数据，只能靠预设）。
 *
 * 【轴向约定】Xbot / Mixamo 手指沿局部 X 生长，弯曲绕局部 Z：
 *   左手掌心向下时绕 -Z 卷向掌心，右手对称绕 +Z。
 * 拇指用一组对位欧拉角压向中指 / 食指之间，模拟握在杆身上。
 * 握姿按右手高尔夫球手的重叠握法（左手在上、右手在下）预设。
 */
import * as THREE from 'three';

/** @typedef {{ x?: number, y?: number, z?: number }} EulerDeg */

/**
 * 单侧手指弯曲角度（度）。键为手指名，值为 [近节, 中节, 远节]。
 * 角度是「卷向掌心」的正值，左右手的符号在 apply 时再翻转。
 */
const FINGER_CURL = {
  Index: [55, 65, 35],
  Middle: [65, 78, 42],
  Ring: [68, 82, 46],
  Pinky: [72, 85, 50],
};

/**
 * 拇指对位：Thumb1 用完整欧拉，Thumb2 / Thumb3 只绕 Z 弯曲。
 * 数值来自对「指尖靠近中指中段」的粗搜，再手工收紧成握杆观感。
 * Left / Right 分开存，因为 Mixamo 左右手局部轴是镜像的。
 */
const THUMB_POSE = {
  Left: {
    Thumb1: { x: 28, y: 40, z: 55 },
    Thumb2: { z: -32 },
    Thumb3: { z: -22 },
  },
  Right: {
    Thumb1: { x: 28, y: -40, z: -55 },
    Thumb2: { z: 32 },
    Thumb3: { z: 22 },
  },
};

/**
 * @param {EulerDeg} deg
 * @returns {THREE.Euler}
 */
function eulerFromDeg(deg) {
  return new THREE.Euler(
    THREE.MathUtils.degToRad(deg.x ?? 0),
    THREE.MathUtils.degToRad(deg.y ?? 0),
    THREE.MathUtils.degToRad(deg.z ?? 0),
    'XYZ',
  );
}

/**
 * 把手指骨骼写成握杆姿势。应在 resetToBind 与手臂瞄准之后调用，
 * 这样不会被 bind 覆盖，也不会被腕骨 lookAt 冲掉。
 *
 * @param {Map<string, THREE.Bone>} boneByName
 */
export function applyGolfGrip(boneByName) {
  for (const side of /** @type {const} */ (['Left', 'Right'])) {
    const curlSign = side === 'Left' ? -1 : 1;

    for (const [finger, curls] of Object.entries(FINGER_CURL)) {
      curls.forEach((deg, index) => {
        const bone = boneByName.get(`mixamorig${side}Hand${finger}${index + 1}`);
        if (!bone) return;
        bone.rotation.set(0, 0, THREE.MathUtils.degToRad(deg * curlSign));
      });
      // 指尖端骨（*4）保持伸直，只当末端锚点用
      const tip = boneByName.get(`mixamorig${side}Hand${finger}4`);
      if (tip) tip.rotation.set(0, 0, 0);
    }

    const thumb = THUMB_POSE[side];
    for (const [segment, deg] of Object.entries(thumb)) {
      const bone = boneByName.get(`mixamorig${side}Hand${segment}`);
      if (!bone) continue;
      bone.rotation.copy(eulerFromDeg(deg));
    }
  }
}
