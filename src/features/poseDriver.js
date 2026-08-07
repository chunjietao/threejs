/**
 * English: Drives Mixamo bones from SwingPose3D joints — direction aiming plus IK-angle roll fixes.
 * 中文：用 pb 关节 3D 位置驱动 Xbot Mixamo 姿势 —— 骨骼朝向对准方向，再用 IK 解算角度补上滚转。
 *
 * 【为什么只用「方向」而不是「目标点」】
 * pb 关节和模型骨骼的位置永远不可能完全重合（体型、骨长都不同）。
 * 若用「骨骼当前世界位置 → pb 目标点」求朝向，误差会沿骨链累积，姿势会扭曲。
 * 正确做法：只取 pb 两个关节之间的**单位方向**，让骨骼朝这个方向即可，
 * 骨长完全由模型自己决定，人体比例就不会被拉坏。
 *
 * 【为什么只对准方向还不够 —— 要用 ikSolver 的角度补两处滚转】
 * 「对准方向」求的是最小旋转，它只定死骨轴指向（2 自由度），
 * 绕骨轴自身的滚转（第 3 自由度）是任意的。由此产生两个可见缺陷：
 *
 * 1) 躯干不会转身。脊柱三节都朝「髋中点→肩中点」，彼此共线且零扭转，
 *    于是上半身始终跟着骨盆走；上杆顶点肩膀该转开 40° 以上时，
 *    只能靠锁骨把肩点硬拽过去，肩背蒙皮被拉变形。
 *    → 用 ikSolver 的 x_factor（肩髋分离角）把扭转分配到三节脊柱上。
 *
 * 2) 肘 / 膝的弯曲平面会乱翻。上臂滚转任意，意味着前臂相对上臂的弯曲
 *    可能发生在「侧向折」的平面里，关节处蒙皮就会拧麻花。
 *    → 用 ikSolver 给出的弯曲平面法线，把近端骨（上臂 / 大腿）绕自身骨轴
 *      转到「弯曲轴与 bind 时解剖朝向一致」的滚转上。
 */
import * as THREE from 'three';
import {
    applyMirror,
    detectMirroredHandedness,
    getJointRaw,
} from '../data/mirrorPose3D.js';
import { sanitizePose3D } from '../data/sanitizePose3D.js';
import { applyGolfGrip } from './golfGrip.js';
import { solvePoseAngles } from './ikSolver.js';

/**
 * 四肢铰链骨链：近端骨对准 root→joint，远端骨对准 joint→tip，
 * 中间插入一次滚转对齐，让弯曲发生在解剖学正确的平面里。
 *
 * bendForward 表示远端相对近端往人体「前方」折（肘）还是「后方」折（膝），
 * bind 姿势下的弯曲轴据此确定 —— 这只依赖解剖事实，不依赖 Mixamo 轴向约定。
 */
const LIMB_CHAINS = [
  {
    proximalBone: 'mixamorigLeftArm',
    distalBone: 'mixamorigLeftForeArm',
    root: 'left_shoulder',
    joint: 'left_elbow',
    tip: 'left_wrist',
    flexionId: 'left_elbow_flexion',
    bendForward: true,
  },
  {
    proximalBone: 'mixamorigRightArm',
    distalBone: 'mixamorigRightForeArm',
    root: 'right_shoulder',
    joint: 'right_elbow',
    tip: 'right_wrist',
    flexionId: 'right_elbow_flexion',
    bendForward: true,
  },
  {
    proximalBone: 'mixamorigLeftUpLeg',
    distalBone: 'mixamorigLeftLeg',
    root: 'left_hip',
    joint: 'left_knee',
    tip: 'left_ankle',
    flexionId: 'left_knee_flexion',
    bendForward: false,
  },
  {
    proximalBone: 'mixamorigRightUpLeg',
    distalBone: 'mixamorigRightLeg',
    root: 'right_hip',
    joint: 'right_knee',
    tip: 'right_ankle',
    flexionId: 'right_knee_flexion',
    bendForward: false,
  },
];

/** 脊柱链：整段一起朝「髋中点 → 肩中点」 */
const SPINE_CHAIN = ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'];

/**
 * 肩髋分离角在脊柱各节上的分配比例（自下而上，和为 1）。
 * 腰椎能转的角度远小于胸椎，所以越靠上分得越多。
 */
const SPINE_TWIST_WEIGHTS = [0.2, 0.35, 0.45];

/**
 * 弯曲角小于这个值时，弯曲平面法线由两条近乎共线的骨段叉乘得到，方向极不稳定，
 * 此时不做滚转对齐；在 [MIN, MAX] 之间线性淡入，避免伸直/弯曲切换时滚转跳变。
 */
const ROLL_FADE_MIN_DEG = 10;
const ROLL_FADE_MAX_DEG = 25;

/** 落地判定用的脚部骨骼（取最低点贴地） */
const GROUND_BONES = [
  'mixamorigLeftToe_End',
  'mixamorigRightToe_End',
  'mixamorigLeftFoot',
  'mixamorigRightFoot',
];

/**
 * pb 语义关节 → Mixamo 中该关节所在的骨骼起点。
 * 耳、鼻在 Xbot 中没有独立骨骼，统一退化到 Head 起点；这仍能稳定定义颈部方向。
 */
const MODEL_JOINT_BONES = Object.freeze({
  nose: 'mixamorigHead',
  left_ear: 'mixamorigHead',
  right_ear: 'mixamorigHead',
  left_shoulder: 'mixamorigLeftArm',
  right_shoulder: 'mixamorigRightArm',
  left_elbow: 'mixamorigLeftForeArm',
  right_elbow: 'mixamorigRightForeArm',
  left_wrist: 'mixamorigLeftHand',
  right_wrist: 'mixamorigRightHand',
  left_hip: 'mixamorigLeftUpLeg',
  right_hip: 'mixamorigRightUpLeg',
  left_knee: 'mixamorigLeftLeg',
  right_knee: 'mixamorigRightLeg',
  left_ankle: 'mixamorigLeftFoot',
  right_ankle: 'mixamorigRightFoot',
});

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

/**
 * 取 v 垂直于 axis 的分量并归一化。
 * @param {THREE.Vector3} v
 * @param {THREE.Vector3} axis - 单位向量
 * @returns {THREE.Vector3 | null} 分量太小时返回 null
 */
function projectOnPlane(v, axis) {
  const out = v.clone().addScaledVector(axis, -v.dot(axis));
  if (out.lengthSq() < 1e-10) return null;
  return out.normalize();
}

/**
 * 绕 axis 从 from 转到 to 的有符号角。
 * @param {THREE.Vector3} from - 单位向量，垂直 axis
 * @param {THREE.Vector3} to - 单位向量，垂直 axis
 * @param {THREE.Vector3} axis - 单位向量
 * @returns {number} 度
 */
function signedAngleDeg(from, to, axis) {
  _tmp.crossVectors(from, to);
  return Math.atan2(_tmp.dot(axis), from.dot(to)) * RAD2DEG;
}

/**
 * 在 [min, max] 区间把权重从 0 线性淡入到 1。
 * @param {number | null | undefined} value
 * @param {number} min
 * @param {number} max
 * @returns {number} 0~1
 */
function fadeWeight(value, min, max) {
  if (value == null || !Number.isFinite(value)) return 0;
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

/**
 * 采样 bind 姿势下各铰链关节的弯曲轴（存成近端骨的局部向量）。
 *
 * bind 是 T-pose，肘膝都伸直，无法直接从几何量出弯曲轴，
 * 但解剖学给了定向：肘朝人体前方折、膝朝后方折。
 * 于是弯曲轴 = 近端骨轴 × 折向，只用到「人体前方」这一个约定，
 * 而它已经由 rest.bodyBasis 从模型自身量出来了。
 *
 * @param {Map<string, THREE.Bone>} boneByName
 * @param {Map<string, THREE.Vector3>} restAxis
 * @param {ReturnType<typeof sampleRestFrame>} rest
 * @returns {Map<string, THREE.Vector3>}
 */
function sampleHingeAxes(boneByName, restAxis, rest) {
  /** @type {Map<string, THREE.Vector3>} */
  const axes = new Map();

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rest.bodyBasis);
  if (forward.lengthSq() < 1e-12) return axes;
  forward.normalize();

  for (const chain of LIMB_CHAINS) {
    const bone = boneByName.get(chain.proximalBone);
    const localAxis = restAxis.get(chain.proximalBone);
    if (!bone || !localAxis) continue;

    const worldQuat = new THREE.Quaternion();
    bone.getWorldQuaternion(worldQuat);
    const boneDir = localAxis.clone().applyQuaternion(worldQuat).normalize();

    const bendDir = chain.bendForward ? forward : forward.clone().negate();
    const hinge = new THREE.Vector3().crossVectors(boneDir, bendDir);
    if (hinge.lengthSq() < 1e-10) continue;
    hinge.normalize();

    // 存成局部量：运行时按骨骼当前朝向变换回世界即可
    axes.set(
      chain.proximalBone,
      hinge.applyQuaternion(worldQuat.clone().invert()).normalize(),
    );
  }

  return axes;
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
  const hingeAxisLocal = sampleHingeAxes(boneByName, restAxis, rest);

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
  /** @type {Record<string, number | null>} 本帧 IK 解算出的关节角度（度） */
  let currentAngles = {};

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
   * 在已有朝向的基础上，绕世界轴追加一个滚转。
   *
   * 世界空间的追加旋转 q 作用在骨骼上时，局部量应写成
   * parentWorld⁻¹ · q · parentWorld · local；把 q 的轴先换算到父空间，
   * 就等价于在父空间左乘一个绕该轴的旋转。
   *
   * @param {string} boneName
   * @param {THREE.Vector3} worldAxis - 滚转轴（世界空间，不必归一）
   * @param {number} deg
   */
  function rollAround(boneName, worldAxis, deg) {
    const bone = boneByName.get(boneName);
    if (!bone || !bone.parent) return;
    if (!Number.isFinite(deg) || Math.abs(deg) < 1e-3) return;
    if (worldAxis.lengthSq() < 1e-12) return;

    bone.parent.getWorldQuaternion(_quat).invert();
    _axis.copy(worldAxis).normalize().applyQuaternion(_quat).normalize();
    _quatB.setFromAxisAngle(_axis, deg * DEG2RAD);
    bone.quaternion.premultiply(_quatB);
    bone.updateMatrixWorld(true);
  }

  /**
   * 用 IK 解出的弯曲平面，修正近端骨（上臂 / 大腿）绕自身骨轴的滚转。
   *
   * 「对准方向」只定死骨轴指向，滚转是任意的；而铰链关节的弯曲轴
   * 在近端骨的局部空间里必须是固定的那一根（bind 时已采样好）。
   * 于是把该轴按当前骨骼朝向变换到世界，再绕骨轴转到与 pb 的弯曲平面法线重合。
   *
   * @param {(typeof LIMB_CHAINS)[number]} chain
   * @param {THREE.Vector3 | null} root
   * @param {THREE.Vector3 | null} vertex
   * @param {THREE.Vector3 | null} tip
   */
  function alignHingeRoll(chain, root, vertex, tip) {
    if (!root || !vertex || !tip) return;
    const restHinge = hingeAxisLocal.get(chain.proximalBone);
    const bone = boneByName.get(chain.proximalBone);
    if (!restHinge || !bone) return;

    // 弯曲太小时叉乘方向不可靠，按屈曲角淡入淡出
    const flexion = currentAngles[chain.flexionId];
    const weight = fadeWeight(flexion, ROLL_FADE_MIN_DEG, ROLL_FADE_MAX_DEG);
    if (weight <= 0) return;

    const boneAxis = vertex.clone().sub(root);
    if (boneAxis.lengthSq() < 1e-12) return;
    boneAxis.normalize();

    // pb 的弯曲平面法线 = 近端骨段 × 远端骨段
    const target = new THREE.Vector3()
      .crossVectors(boneAxis, tip.clone().sub(vertex))
      .normalize();

    // 当前模型的弯曲轴（bind 局部轴 → 世界）
    bone.getWorldQuaternion(_quat);
    const current = restHinge.clone().applyQuaternion(_quat);

    const a = projectOnPlane(current, boneAxis);
    const b = projectOnPlane(target, boneAxis);
    if (!a || !b) return;

    rollAround(chain.proximalBone, boneAxis, signedAngleDeg(a, b, boneAxis) * weight);
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

    // 先解算本帧关节角度：脊柱扭转与四肢滚转都要用它
    currentAngles = solvePoseAngles((name) => posed.get(name) ?? null).angles;

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

    // ---- 躯干：整段脊柱朝「髋中点 → 肩中点」，并按 x_factor 分配扭转 ----
    // 骨盆朝向已由髋线定死，脊柱若不扭转，肩线就只能永远跟着骨盆走。
    if (hipMid && shoulderMid) {
      const spineDir = shoulderMid.clone().sub(hipMid);
      const twist = currentAngles.x_factor ?? 0;
      for (let s = 0; s < SPINE_CHAIN.length; s++) {
        const name = SPINE_CHAIN[s];
        aimAlong(name, spineDir);
        rollAround(name, spineDir, twist * (SPINE_TWIST_WEIGHTS[s] ?? 0));
      }
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

    // ---- 四肢：近端骨对准 → 滚转对齐弯曲平面 → 远端骨对准 ----
    // 滚转必须夹在两次对准之间：远端骨继承近端骨的旋转，先滚转才不会把它带歪。
    for (const chain of LIMB_CHAINS) {
      const root = joint(chain.root);
      const vertex = joint(chain.joint);
      const tip = joint(chain.tip);
      aimBetween(chain.proximalBone, root, vertex);
      alignHingeRoll(chain, root, vertex, tip);
      aimBetween(chain.distalBone, vertex, tip);
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

  /**
   * 读取 GLB 模型上与 pb 语义关节对应的真实世界坐标。
   * 与 getJointPosition 不同，这里返回的是当前蒙皮骨架的位置，
   * 用于把角度圆弧准确画在 GLB 的肩、肘、腕、髋、膝、踝上。
   *
   * @param {string} name
   * @returns {THREE.Vector3 | null}
   */
  function getModelJointPosition(name) {
    const boneName = MODEL_JOINT_BONES[name];
    if (!boneName) return null;
    const bone = boneByName.get(boneName);
    if (!bone) return null;
    return bone.getWorldPosition(new THREE.Vector3());
  }

  /**
   * 生成画在 GLB 上的角度几何。
   *
   * 顶点和参考方向来自模型骨骼的真实世界坐标；Xbot 没有的球杆握把点
   * 则回退到已对齐的 pb 坐标。弧度值强制使用驱动模型时的 currentAngles，
   * 再在当前几何平面内重建目标边，保证 GLB 与火柴人显示的是同一份角度，
   * 而不是因为模型骨长不同重新量出另一套数值。
   *
   * @returns {ReturnType<typeof solvePoseAngles>}
   */
  function getModelAngleGeometry() {
    const solved = solvePoseAngles(
      (name) => getModelJointPosition(name) ?? getJointPosition(name),
    );

    for (const arc of solved.arcs) {
      const desired = currentAngles[arc.id];
      if (desired == null || !Number.isFinite(desired)) continue;

      // 保留模型当前弯曲平面的朝向，只把弧张角校正为 IK 的最终数值。
      _axis.crossVectors(arc.refDir, arc.targetDir);
      if (_axis.lengthSq() > 1e-10) {
        _axis.normalize();
        arc.targetDir
          .copy(arc.refDir)
          .applyAxisAngle(_axis, Math.abs(desired) * DEG2RAD)
          .normalize();
      }
      arc.deg = Math.abs(desired);
    }

    return solved;
  }

  return {
    frameCount: frames.length,
    addressIndex: addressIdx,
    /** 数据清洗结果：被剔除的帧与误检关节 */
    sanitizeReport: report,
    applyFrame,
    getJointPosition,
    getModelJointPosition,
    getModelAngleGeometry,
    /** 本帧 IK 解算出的关节角度（度），驱动骨骼时用的就是这一份 */
    getCurrentAngles: () => currentAngles,
    resetToBind,
    /** 映射变更后仍按同一套语义骨链驱动；预留钩子 */
    onMappingChanged() {},
  };
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
