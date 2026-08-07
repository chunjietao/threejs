/**
 * English: Detects and removes the left-handed (mirrored) coordinate system of SwingPose3D.
 * 中文：判定并消除 SwingPose3D 的左手系（镜像）问题，供姿势驱动与角度解算共用。
 *
 * 【为什么单独成文件】
 * 镜像判定属于「数据进入渲染 / 解算之前的规整」，
 * poseDriver（驱动骨骼）与 ikSolver（解算角度）都要用，
 * 放在任一方都会让两者互相 import 形成循环依赖。
 */
import * as THREE from 'three';

/**
 * 读取一帧里某个关节的原始坐标，兼容 joints 是数组或对象两种形态。
 * @param {object} frame
 * @param {string} name
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function getJointRaw(frame, name) {
  const joints = frame?.joints;
  if (!joints) return null;
  if (Array.isArray(joints)) {
    return joints.find((j) => j.name === name)?.position ?? null;
  }
  return joints[name]?.position ?? null;
}

/**
 * 判断 pb 用的是不是与 Three.js 相反的左手坐标系。
 *
 * 判据来自人体自身：右手坐标系下「前 = 左 × 上」恒成立。
 * 取 左 = 右髋→左髋、上 = 髋中点→肩中点，算出的前方若与解剖学前方
 * （耳中点→鼻尖）反向，说明整份数据是镜像的。
 *
 * 镜像是反射变换，无法用四元数表示，只靠绕 Y 的偏航永远修不好 ——
 * 髋部左右能对上，但身体前后会整个翻过来，手就跑到背后去了。
 *
 * @param {object[]} frames
 * @returns {boolean}
 */
export function detectMirroredHandedness(frames) {
  let mirrored = 0;
  let normal = 0;

  for (const frame of frames ?? []) {
    /** @param {string} name */
    const at = (name) => {
      const p = getJointRaw(frame, name);
      return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
    };
    /** @param {string} a @param {string} b */
    const mid = (a, b) => {
      const pa = at(a);
      const pb = at(b);
      return pa && pb ? pa.add(pb).multiplyScalar(0.5) : null;
    };

    const hipL = at('left_hip');
    const hipR = at('right_hip');
    const hipMid = mid('left_hip', 'right_hip');
    const shoulderMid = mid('left_shoulder', 'right_shoulder');
    const earMid = mid('left_ear', 'right_ear');
    const nose = at('nose');
    if (!hipL || !hipR || !hipMid || !shoulderMid || !earMid || !nose) continue;

    const left = hipL.sub(hipR);
    const up = shoulderMid.sub(hipMid);
    if (left.lengthSq() < 1e-12 || up.lengthSq() < 1e-12) continue;

    const forward = new THREE.Vector3().crossVectors(
      left.normalize(),
      up.normalize(),
    );
    const anatomicalForward = nose.sub(earMid);
    if (forward.lengthSq() < 1e-12 || anatomicalForward.lengthSq() < 1e-12) {
      continue;
    }

    if (forward.dot(anatomicalForward) < 0) mirrored += 1;
    else normal += 1;
  }

  return mirrored > normal;
}

/**
 * 左手系时翻转一个水平轴。选 X 还是 Z 只差一个 180° 偏航，
 * 而偏航随后会被对齐步骤一并吸收，所以取哪个都等价。
 *
 * @param {THREE.Vector3} v
 * @param {boolean} mirrored
 * @returns {THREE.Vector3} 就地修改并返回
 */
export function applyMirror(v, mirrored) {
  if (mirrored) v.z = -v.z;
  return v;
}
