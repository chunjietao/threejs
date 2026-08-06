/**
 * English: Drives Mixamo bones from SwingPose3D joint positions via direction-only aiming.
 * 中文：用 pb 关节 3D 位置推方向（父关节→子关节），只改骨骼朝向来驱动 Xbot Mixamo 姿势。
 *
 * 【为什么只用「方向」而不是「目标点」】
 * pb 关节和模型骨骼的位置永远不可能完全重合（体型、骨长都不同）。
 * 若用「骨骼当前世界位置 → pb 目标点」求朝向，误差会沿骨链累积，姿势会扭曲。
 * 正确做法：只取 pb 两个关节之间的**单位方向**，让骨骼朝这个方向即可，
 * 骨长完全由模型自己决定，人体比例就不会被拉坏。
 */
import * as THREE from 'three';
import { sanitizePose3D } from '../data/sanitizePose3D.js';
import { applyGolfGrip } from './golfGrip.js';

/** 骨链朝向：bone 的骨轴对准 (from 关节 → to 关节) 的方向 */
const LIMB_AIMS = [
  { bone: 'mixamorigLeftArm', from: 'left_shoulder', to: 'left_elbow' },
  { bone: 'mixamorigLeftForeArm', from: 'left_elbow', to: 'left_wrist' },
  { bone: 'mixamorigRightArm', from: 'right_shoulder', to: 'right_elbow' },
  { bone: 'mixamorigRightForeArm', from: 'right_elbow', to: 'right_wrist' },
  { bone: 'mixamorigLeftUpLeg', from: 'left_hip', to: 'left_knee' },
  { bone: 'mixamorigLeftLeg', from: 'left_knee', to: 'left_ankle' },
  { bone: 'mixamorigRightUpLeg', from: 'right_hip', to: 'right_knee' },
  { bone: 'mixamorigRightLeg', from: 'right_knee', to: 'right_ankle' },
];

/** 脊柱链：整段一起朝「髋中点 → 肩中点」 */
const SPINE_CHAIN = ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'];

/** 落地判定用的脚部骨骼（取最低点贴地） */
const GROUND_BONES = [
  'mixamorigLeftToe_End',
  'mixamorigRightToe_End',
  'mixamorigLeftFoot',
  'mixamorigRightFoot',
];

const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

/**
 * @param {object} frame
 * @param {string} name
 * @returns {{ x: number, y: number, z: number } | null}
 */
function getJointRaw(frame, name) {
  const joints = frame?.joints;
  if (!joints) return null;
  if (Array.isArray(joints)) {
    return joints.find((j) => j.name === name)?.position ?? null;
  }
  return joints[name]?.position ?? null;
}

/**
 * 由「上方向 + 侧方向」构造正交基（Y=up，X=side 正交化后，Z=X×Y）。
 * @param {THREE.Vector3} up
 * @param {THREE.Vector3} side
 * @param {THREE.Quaternion} out
 * @returns {boolean} 是否构造成功
 */
function basisFrom(up, side, out) {
  if (up.lengthSq() < 1e-12 || side.lengthSq() < 1e-12) return false;
  const y = up.clone().normalize();
  const x = side.clone();
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-12) return false;
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  out.setFromRotationMatrix(_mat.makeBasis(x, y, z));
  return true;
}

/**
 * @param {object} options
 * @param {THREE.Object3D} options.model
 * @param {THREE.Bone[]} options.bones
 * @param {object} options.data - SwingPose3D（withJointsAsList 后）
 * @param {{ getBoneForJoint: (j: string) => string | null | undefined }} [options.mapping]
 */
export function createPoseDriver({ model, bones, data, mapping: _mapping = null }) {
  /** @type {Map<string, THREE.Bone>} */
  const boneByName = new Map();
  for (const bone of bones) {
    if (bone.name) boneByName.set(bone.name, bone);
  }

  // ----- 静止姿势（bind）：局部变换 + 骨轴方向 -----
  // 调用方必须保证此刻模型处于 bind pose。
  /** @type {Map<string, { position: THREE.Vector3, quaternion: THREE.Quaternion }>} */
  const restLocal = new Map();
  /** @type {Map<string, THREE.Vector3>} 骨轴：本骨指向子骨的方向（本骨局部空间） */
  const restAxis = new Map();
  for (const bone of bones) {
    restLocal.set(bone.name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
    });
    const child = bone.children.find((c) => c.isBone);
    restAxis.set(
      bone.name,
      child && child.position.lengthSq() > 1e-10
        ? child.position.clone().normalize()
        : new THREE.Vector3(0, 1, 0),
    );
  }

  model.updateMatrixWorld(true);
  const rest = sampleRestFrame(boneByName);

  const frames = data.frames ?? [];
  const addressIdx = resolveAddressIndex(data);
  const mirrored = detectMirroredHandedness(frames);
  const alignment = computeAlignment(rest, frames[addressIdx], mirrored);

  // 先清洗（剔坏帧 / 误检点 → 插值 → 平滑），再一次性变换到模型空间
  const { joints: cleanFrames, report } = sanitizePose3D(frames);
  /** @type {Map<string, THREE.Vector3>[]} */
  const posedFrames = cleanFrames.map((frameJoints) => {
    /** @type {Map<string, THREE.Vector3>} */
    const out = new Map();
    for (const [name, p] of frameJoints) {
      out.set(
        name,
        applyMirror(p.clone(), mirrored)
          .multiplyScalar(alignment.scale)
          .applyQuaternion(alignment.rotation)
          .add(alignment.translation),
      );
    }
    return out;
  });

  /** @type {Map<string, THREE.Vector3>} 当前帧关节（模型空间，贴地前） */
  let posed = new Map();
  /** 本帧 lockToGround 把角色整体下移的量（世界 Y）；球杆等非骨骼点也要减掉 */
  let groundDropY = 0;

  function resetToBind() {
    for (const [name, pose] of restLocal) {
      const bone = boneByName.get(name);
      if (!bone) continue;
      bone.position.copy(pose.position);
      bone.quaternion.copy(pose.quaternion);
    }
  }

  /** @param {string} name */
  const joint = (name) => posed.get(name) ?? null;

  /**
   * @param {string} a
   * @param {string} b
   * @returns {THREE.Vector3 | null}
   */
  function mid(a, b) {
    const pa = joint(a);
    const pb = joint(b);
    if (!pa || !pb) return null;
    return pa.clone().add(pb).multiplyScalar(0.5);
  }

  /**
   * 让骨骼的骨轴朝向指定世界方向；保留静止姿势里的扭转（roll），避免网格拧麻花。
   * @param {string} boneName
   * @param {THREE.Vector3} worldDir
   */
  function aimAlong(boneName, worldDir) {
    const bone = boneByName.get(boneName);
    if (!bone || !bone.parent) return;
    if (worldDir.lengthSq() < 1e-12) return;

    const restEntry = restLocal.get(boneName);
    const axis = restAxis.get(boneName);
    if (!restEntry || !axis) return;

    // 目标方向 → 父骨局部空间
    bone.parent.getWorldQuaternion(_quat).invert();
    _dir.copy(worldDir).normalize().applyQuaternion(_quat);

    // 静止时骨轴在父空间里的方向
    _axis.copy(axis).applyQuaternion(restEntry.quaternion);

    // 只补一个最小旋转，静止旋转原样保留
    _quatB.setFromUnitVectors(_axis, _dir);
    bone.quaternion.copy(_quatB).multiply(restEntry.quaternion);
    bone.updateMatrixWorld(true);
  }

  /**
   * @param {string} boneName
   * @param {THREE.Vector3 | null} from
   * @param {THREE.Vector3 | null} to
   */
  function aimBetween(boneName, from, to) {
    if (!from || !to) return;
    aimAlong(boneName, _tmp.subVectors(to, from));
  }

  /**
   * 应用指定数组下标的帧。
   * @param {number} frameIndex
   */
  function applyFrame(frameIndex) {
    if (frames.length === 0) return;
    const i = Math.max(0, Math.min(frames.length - 1, frameIndex | 0));

    resetToBind();
    model.updateMatrixWorld(true);
    posed = posedFrames[i];

    const hipMid = mid('left_hip', 'right_hip');
    const shoulderMid = mid('left_shoulder', 'right_shoulder');
    const leftHip = joint('left_hip');
    const rightHip = joint('right_hip');
    const hips = boneByName.get('mixamorigHips');

    // ---- 根骨：位置 + 朝向 ----
    if (hips && hipMid) {
      const parent = hips.parent ?? model;
      hips.position.copy(parent.worldToLocal(hipMid.clone()));

      // 目标基 vs 静止基，取差量旋转，避免硬编码 Mixamo 轴向约定
      const targetBasis = new THREE.Quaternion();
      if (
        leftHip &&
        rightHip &&
        shoulderMid &&
        basisFrom(
          shoulderMid.clone().sub(hipMid),
          leftHip.clone().sub(rightHip),
          targetBasis,
        )
      ) {
        const worldQuat = rest.bodyBasis
          .clone()
          .invert()
          .premultiply(targetBasis)
          .multiply(rest.hipsQuaternion);
        parent.getWorldQuaternion(_quat).invert();
        hips.quaternion.copy(_quat).multiply(worldQuat);
      }
      hips.updateMatrixWorld(true);
    }

    // ---- 躯干：整段脊柱朝「髋中点 → 肩中点」 ----
    if (hipMid && shoulderMid) {
      const spineDir = shoulderMid.clone().sub(hipMid);
      for (const name of SPINE_CHAIN) aimAlong(name, spineDir);
    }

    // ---- 锁骨：脊柱顶端 → 各自肩关节 ----
    aimBetween('mixamorigLeftShoulder', shoulderMid, joint('left_shoulder'));
    aimBetween('mixamorigRightShoulder', shoulderMid, joint('right_shoulder'));

    // ---- 颈 / 头：肩中点 → 双耳中点（无耳时退回鼻尖）----
    const headTop = mid('left_ear', 'right_ear') ?? joint('nose');
    if (shoulderMid && headTop) {
      aimBetween('mixamorigNeck', shoulderMid, headTop);
      aimBetween('mixamorigHead', shoulderMid, headTop);
    }

    // ---- 四肢：近端 → 远端 ----
    for (const aim of LIMB_AIMS) {
      aimBetween(aim.bone, joint(aim.from), joint(aim.to));
    }

    // pb 没有手指关节：用预设重叠握杆姿势，替代 bind 的张开手掌。
    applyGolfGrip(boneByName);

    model.updateMatrixWorld(true);
    lockToGround(hips);
  }

  /**
   * 把角色整体上下平移，让最低的脚落在地面上。
   * pb 的髋高是相机空间估计值，直接用会让人悬空或陷进地里。
   * @param {THREE.Bone | undefined} hips
   */
  function lockToGround(hips) {
    groundDropY = 0;
    if (!hips) return;
    let lowest = Infinity;
    for (const name of GROUND_BONES) {
      const bone = boneByName.get(name);
      if (!bone) continue;
      bone.getWorldPosition(_tmp);
      lowest = Math.min(lowest, _tmp.y);
    }
    if (!Number.isFinite(lowest)) return;

    const drop = lowest - rest.groundY;
    if (Math.abs(drop) < 1e-6) return;

    groundDropY = drop;
    const parent = hips.parent ?? model;
    hips.getWorldPosition(_tmp);
    _tmp.y -= drop;
    hips.position.copy(parent.worldToLocal(_tmp));
    hips.updateMatrixWorld(true);
  }

  /**
   * 读取当前帧已对齐到模型空间、并补偿贴地偏移后的关节位置。
   * @param {string} name
   * @returns {THREE.Vector3 | null}
   */
  function getJointPosition(name) {
    const p = posed.get(name);
    if (!p) return null;
    if (groundDropY === 0) return p.clone();
    return p.clone().setY(p.y - groundDropY);
  }

  return {
    frameCount: frames.length,
    addressIndex: addressIdx,
    /** 数据清洗结果：被剔除的帧与误检关节 */
    sanitizeReport: report,
    applyFrame,
    getJointPosition,
    resetToBind,
    /** 映射变更后仍按同一套语义骨链驱动；预留钩子 */
    onMappingChanged() {},
  };
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
function detectMirroredHandedness(frames) {
  let mirrored = 0;
  let normal = 0;

  for (const frame of frames) {
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

    const forward = new THREE.Vector3().crossVectors(left.normalize(), up.normalize());
    const anatomicalForward = nose.sub(earMid);
    if (forward.lengthSq() < 1e-12 || anatomicalForward.lengthSq() < 1e-12) continue;

    if (forward.dot(anatomicalForward) < 0) mirrored += 1;
    else normal += 1;
  }

  return mirrored > normal;
}

/**
 * 左手系时翻转一个水平轴。选 X 还是 Z 只差一个 180° 偏航，
 * 而偏航随后会被 computeAlignment 一并对齐，所以取哪个都等价。
 *
 * @param {THREE.Vector3} v
 * @param {boolean} mirrored
 * @returns {THREE.Vector3} 就地修改并返回
 */
function applyMirror(v, mirrored) {
  if (mirrored) v.z = -v.z;
  return v;
}

/**
 * @param {object} data
 * @returns {number} 数组下标（address_frame_idx 存的是 frame_idx，不是下标）
 */
function resolveAddressIndex(data) {
  const frames = data.frames ?? [];
  const key = data.address_frame_idx;
  if (key == null) return 0;
  const found = frames.findIndex((f) => f.frame_idx === key);
  return found >= 0 ? found : 0;
}

/**
 * 采样模型静止姿势的关键世界量，作为对齐与朝向的基准。
 * @param {Map<string, THREE.Bone>} boneByName
 */
function sampleRestFrame(boneByName) {
  /** @param {string} name */
  const world = (name) => {
    const bone = boneByName.get(name);
    if (!bone) return null;
    const v = new THREE.Vector3();
    bone.getWorldPosition(v);
    return v;
  };

  const hipL = world('mixamorigLeftUpLeg');
  const hipR = world('mixamorigRightUpLeg');
  const shoulderL = world('mixamorigLeftArm');
  const shoulderR = world('mixamorigRightArm');
  const footL = world('mixamorigLeftFoot');
  const footR = world('mixamorigRightFoot');
  const hips = boneByName.get('mixamorigHips');

  const hipMid =
    hipL && hipR ? hipL.clone().add(hipR).multiplyScalar(0.5) : world('mixamorigHips');
  const shoulderMid =
    shoulderL && shoulderR
      ? shoulderL.clone().add(shoulderR).multiplyScalar(0.5)
      : null;
  const footMid =
    footL && footR ? footL.clone().add(footR).multiplyScalar(0.5) : null;

  const hipsQuaternion = new THREE.Quaternion();
  if (hips) hips.getWorldQuaternion(hipsQuaternion);

  const bodyBasis = new THREE.Quaternion();
  if (hipMid && shoulderMid && hipL && hipR) {
    basisFrom(
      shoulderMid.clone().sub(hipMid),
      hipL.clone().sub(hipR),
      bodyBasis,
    );
  }

  let groundY = Infinity;
  for (const name of GROUND_BONES) {
    const p = world(name);
    if (p) groundY = Math.min(groundY, p.y);
  }
  if (!Number.isFinite(groundY)) groundY = 0;

  return {
    hipL,
    hipR,
    hipMid,
    shoulderMid,
    footMid,
    hipsQuaternion,
    bodyBasis,
    groundY,
    height:
      shoulderMid && footMid ? shoulderMid.distanceTo(footMid) : 0,
    hipWidth: hipL && hipR ? hipL.distanceTo(hipR) : 0,
  };
}

/**
 * address 帧 pb 关节 ↔ 模型 bind 骨：镜像、尺度、绕 Y、平移。
 * 偏航必须在镜像之后再算，否则翻转会把已对齐的朝向再次带偏。
 *
 * @param {ReturnType<typeof sampleRestFrame>} rest
 * @param {object | undefined} addressFrame
 * @param {boolean} mirrored
 */
function computeAlignment(rest, addressFrame, mirrored) {
  const identity = {
    scale: 1,
    rotation: new THREE.Quaternion(),
    translation: new THREE.Vector3(),
  };
  if (!addressFrame || !rest.hipMid) return identity;

  /** @param {string} name */
  const pb = (name) => {
    const p = getJointRaw(addressFrame, name);
    return p ? applyMirror(new THREE.Vector3(p.x, p.y, p.z), mirrored) : null;
  };

  const hipL = pb('left_hip');
  const hipR = pb('right_hip');
  if (!hipL || !hipR) return identity;

  const hipMid = hipL.clone().add(hipR).multiplyScalar(0.5);
  const shoulderL = pb('left_shoulder');
  const shoulderR = pb('right_shoulder');
  const ankleL = pb('left_ankle');
  const ankleR = pb('right_ankle');

  let pbHeight = 0;
  if (shoulderL && shoulderR && ankleL && ankleR) {
    const sh = shoulderL.clone().add(shoulderR).multiplyScalar(0.5);
    const an = ankleL.clone().add(ankleR).multiplyScalar(0.5);
    pbHeight = sh.distanceTo(an);
  }
  const pbHipWidth = hipL.distanceTo(hipR);

  let scale = 1;
  if (pbHeight > 1e-6 && rest.height > 1e-6) {
    scale = rest.height / pbHeight;
  } else if (pbHipWidth > 1e-6 && rest.hipWidth > 1e-6) {
    scale = rest.hipWidth / pbHipWidth;
  }

  // 绕 Y：把「右髋→左髋」在水平面上的朝向对齐到模型
  const rotation = new THREE.Quaternion();
  const pbSide = hipL.clone().sub(hipR).setY(0);
  const restSide =
    rest.hipL && rest.hipR ? rest.hipL.clone().sub(rest.hipR).setY(0) : null;
  if (restSide && pbSide.lengthSq() > 1e-10 && restSide.lengthSq() > 1e-10) {
    const yaw =
      Math.atan2(restSide.x, restSide.z) - Math.atan2(pbSide.x, pbSide.z);
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  }

  const translation = rest.hipMid
    .clone()
    .sub(hipMid.clone().multiplyScalar(scale).applyQuaternion(rotation));

  return { scale, rotation, translation };
}
