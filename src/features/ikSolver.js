/**
 * English: Analytic inverse kinematics for SwingPose3D — turns joint 3D positions into joint angles.
 * 中文：SwingPose3D 的解析式逆向运动学 —— 把关节 3D 位置反解成各关节角度，并给出画角度弧所需的几何。
 *
 * 【逆向运动学在这里做什么】
 * pb 里只有关节点坐标，没有任何旋转量。IK 的任务就是：已知子关节（末端）位置，
 * 反求父关节转过了多少度。人体骨链拓扑已知且很短（肩→肘→腕、髋→膝→踝），
 * 可以直接闭式求解，不需要 CCD / FABRIK 之类的迭代 —— 迭代解只在
 * 「目标点与骨长不自洽、需要逼近」时才有必要，而这里骨长本来就来自数据自身。
 *
 * 【为什么每个关节只给 1~2 个角】
 * 两个点只能确定一条骨段的方向（2 自由度），绕骨段自身轴的自转（twist）
 * 在数学上不可观测。所以铰链关节（肘 / 膝 / 腕）给 1 个屈曲角，
 * 球窝关节（肩 / 髋）给 2 个摆动角（抬起 + 方位），一律不臆造 twist。
 *
 * 【参考系全部取自人体自身】
 * 角度必须与相机摆位、整体缩放无关，因此参考轴一律用被测者自己的关节构造：
 * 躯干轴 = 髋中点→肩中点，骨盆左向 = 右髋→左髋，腿轴 = 踝中点→髋中点。
 * 这样任意刚体变换与均匀缩放都不会改变解算结果 ——
 * 既可以直接吃原始 pb，也可以吃 poseDriver 对齐到模型空间后的坐标。
 */
import * as THREE from 'three';
import {
  applyMirror,
  detectMirroredHandedness,
} from '../data/mirrorPose3D.js';
import { sanitizePose3D } from '../data/sanitizePose3D.js';

const RAD2DEG = 180 / Math.PI;

/** 球杆握把点：pb 没有手部关节，腕角只能借握把方向求 */
const CLUB_HANDLE = 'golf_club_shaft_handle_tip';

/**
 * 全部输出角度的定义。
 * - hinge：铰链屈曲角，0° = 完全伸直，越大越弯
 * - swing.elevation：相对躯干「向下」方向的抬起角，0° = 自然下垂，90° = 平举
 * - swing.azimuth：抬起后在水平面内的方位，0° = 正前方，+90° = 正外侧，负 = 越过身体中线
 * - torso：躯干姿态量，带符号者以「前 / 左」为正
 */
export const ANGLE_DEFS = Object.freeze([
  { id: 'left_elbow_flexion', label: '左肘', group: 'left', kind: 'hinge' },
  { id: 'right_elbow_flexion', label: '右肘', group: 'right', kind: 'hinge' },
  { id: 'left_knee_flexion', label: '左膝', group: 'left', kind: 'hinge' },
  { id: 'right_knee_flexion', label: '右膝', group: 'right', kind: 'hinge' },
  { id: 'left_wrist_flexion', label: '左腕', group: 'left', kind: 'hinge' },
  { id: 'right_wrist_flexion', label: '右腕', group: 'right', kind: 'hinge' },
  { id: 'left_shoulder_elevation', label: '左肩抬起', group: 'left', kind: 'swing' },
  { id: 'left_shoulder_azimuth', label: '左肩方位', group: 'left', kind: 'swing' },
  { id: 'right_shoulder_elevation', label: '右肩抬起', group: 'right', kind: 'swing' },
  { id: 'right_shoulder_azimuth', label: '右肩方位', group: 'right', kind: 'swing' },
  { id: 'left_hip_flexion', label: '左髋屈曲', group: 'left', kind: 'swing' },
  { id: 'left_hip_azimuth', label: '左髋方位', group: 'left', kind: 'swing' },
  { id: 'right_hip_flexion', label: '右髋屈曲', group: 'right', kind: 'swing' },
  { id: 'right_hip_azimuth', label: '右髋方位', group: 'right', kind: 'swing' },
  { id: 'spine_tilt', label: '脊柱倾角', group: 'torso', kind: 'torso' },
  { id: 'spine_tilt_forward', label: '脊柱前倾', group: 'torso', kind: 'torso' },
  { id: 'spine_tilt_lateral', label: '脊柱侧倾', group: 'torso', kind: 'torso' },
  { id: 'neck_tilt', label: '颈部', group: 'torso', kind: 'torso' },
  { id: 'x_factor', label: '肩髋分离', group: 'torso', kind: 'torso' },
]);

/**
 * @typedef {object} AngleArc
 * @property {string} id - 对应 ANGLE_DEFS 里的角度 id
 * @property {string} label - 弧线旁的短标签
 * @property {'left' | 'right' | 'torso'} group - 配色分组
 * @property {THREE.Vector3} vertex - 角的顶点（关节位置）
 * @property {THREE.Vector3} refDir - 参考边方向（单位向量，角度从这里量起）
 * @property {THREE.Vector3} targetDir - 目标边方向（单位向量）
 * @property {number} deg - 两边夹角（度）
 */

/**
 * 单帧解算：由关节位置反求关节角度。
 *
 * 结果对刚体变换与均匀缩放不变，所以 getPoint 给哪个坐标空间的点都可以；
 * arcs 里的顶点与方向也直接落在同一空间，可直接拿去画。
 *
 * @param {(name: string) => { x: number, y: number, z: number } | null | undefined} getPoint
 * @returns {{ angles: Record<string, number | null>, arcs: AngleArc[] }}
 */
export function solvePoseAngles(getPoint) {
  /** @type {Record<string, number | null>} */
  const angles = {};
  for (const def of ANGLE_DEFS) angles[def.id] = null;
  /** @type {AngleArc[]} */
  const arcs = [];

  /** @param {string} name */
  const at = (name) => toVector(getPoint(name));
  /** @param {string} a @param {string} b */
  const mid = (a, b) => {
    const pa = at(a);
    const pb = at(b);
    return pa && pb ? pa.add(pb).multiplyScalar(0.5) : null;
  };

  const hipL = at('left_hip');
  const hipR = at('right_hip');
  const shoulderL = at('left_shoulder');
  const shoulderR = at('right_shoulder');
  const hipMid = mid('left_hip', 'right_hip');
  const shoulderMid = mid('left_shoulder', 'right_shoulder');
  const ankleMid = mid('left_ankle', 'right_ankle');
  const headTop = mid('left_ear', 'right_ear') ?? at('nose');

  const pelvisSide = hipL && hipR ? hipL.clone().sub(hipR) : null;
  const torsoUp =
    hipMid && shoulderMid ? unit(shoulderMid.clone().sub(hipMid)) : null;
  const legUp = hipMid && ankleMid ? unit(hipMid.clone().sub(ankleMid)) : null;

  // 躯干基：四肢摆动角的参考系；骨盆基：脊柱倾角的参考系
  const torso = makeBasis(torsoUp, pelvisSide);
  const pelvis = makeBasis(legUp, pelvisSide);

  // ---- 铰链关节：屈曲角 = 近端骨段方向 与 远端骨段方向 的夹角 ----
  // 参考边取「近端骨段的延长线」，所以伸直时角为 0，弧张开多少就是弯了多少。
  solveHinge('left_elbow_flexion', '左肘', 'left', 'left_shoulder', 'left_elbow', 'left_wrist');
  solveHinge('right_elbow_flexion', '右肘', 'right', 'right_shoulder', 'right_elbow', 'right_wrist');
  solveHinge('left_knee_flexion', '左膝', 'left', 'left_hip', 'left_knee', 'left_ankle');
  solveHinge('right_knee_flexion', '右膝', 'right', 'right_hip', 'right_knee', 'right_ankle');
  solveHinge('left_wrist_flexion', '左腕', 'left', 'left_elbow', 'left_wrist', CLUB_HANDLE);
  solveHinge('right_wrist_flexion', '右腕', 'right', 'right_elbow', 'right_wrist', CLUB_HANDLE);

  // ---- 球窝关节：抬起角 + 方位角（twist 不可观测，不输出）----
  solveSwing('left_shoulder', 'left_elbow', 'left', torso, '左肩', 'left_shoulder_elevation', 'left_shoulder_azimuth');
  solveSwing('right_shoulder', 'right_elbow', 'right', torso, '右肩', 'right_shoulder_elevation', 'right_shoulder_azimuth');
  solveSwing('left_hip', 'left_knee', 'left', torso, '左髋', 'left_hip_flexion', 'left_hip_azimuth');
  solveSwing('right_hip', 'right_knee', 'right', torso, '右髋', 'right_hip_flexion', 'right_hip_azimuth');

  // ---- 脊柱：躯干轴相对腿轴的倾斜，再按骨盆基拆成前倾 / 侧倾 ----
  if (hipMid && torsoUp && legUp && pelvis) {
    const tilt = angleDeg(legUp, torsoUp);
    angles.spine_tilt = tilt;
    const along = torsoUp.dot(legUp);
    angles.spine_tilt_forward =
      Math.atan2(torsoUp.dot(pelvis.forward), along) * RAD2DEG;
    angles.spine_tilt_lateral =
      Math.atan2(torsoUp.dot(pelvis.left), along) * RAD2DEG;
    arcs.push({
      id: 'spine_tilt',
      label: '脊柱',
      group: 'torso',
      vertex: hipMid.clone(),
      refDir: legUp.clone(),
      targetDir: torsoUp.clone(),
      deg: tilt,
    });
  }

  // ---- 颈：头顶方向相对躯干轴的偏离 ----
  if (shoulderMid && headTop && torsoUp) {
    const dir = unit(headTop.clone().sub(shoulderMid));
    if (dir) {
      const tilt = angleDeg(torsoUp, dir);
      angles.neck_tilt = tilt;
      arcs.push({
        id: 'neck_tilt',
        label: '颈',
        group: 'torso',
        vertex: shoulderMid.clone(),
        refDir: torsoUp.clone(),
        targetDir: dir,
        deg: tilt,
      });
    }
  }

  // ---- 肩髋分离（X-factor）：肩线与髋线绕躯干轴的有符号夹角，向左转为正 ----
  if (torso && hipL && hipR && shoulderL && shoulderR) {
    const hipLine = perpendicular(hipL.clone().sub(hipR), torso.up);
    const shoulderLine = perpendicular(
      shoulderL.clone().sub(shoulderR),
      torso.up,
    );
    if (hipLine && shoulderLine) {
      angles.x_factor = signedAngleDeg(hipLine, shoulderLine, torso.up);
    }
  }

  return { angles, arcs };

  /**
   * @param {string} id
   * @param {string} label
   * @param {'left' | 'right'} group
   * @param {string} proximal
   * @param {string} vertexName
   * @param {string} distal
   */
  function solveHinge(id, label, group, proximal, vertexName, distal) {
    const a = at(proximal);
    const b = at(vertexName);
    const c = at(distal);
    if (!a || !b || !c) return;

    const refDir = unit(b.clone().sub(a));
    const targetDir = unit(c.clone().sub(b));
    if (!refDir || !targetDir) return;

    const deg = angleDeg(refDir, targetDir);
    angles[id] = deg;
    arcs.push({ id, label, group, vertex: b, refDir, targetDir, deg });
  }

  /**
   * @param {string} vertexName
   * @param {string} childName
   * @param {'left' | 'right'} side
   * @param {ReturnType<typeof makeBasis>} basis
   * @param {string} label
   * @param {string} elevationId
   * @param {string} azimuthId
   */
  function solveSwing(vertexName, childName, side, basis, label, elevationId, azimuthId) {
    if (!basis) return;
    const origin = at(vertexName);
    const child = at(childName);
    if (!origin || !child) return;

    const dir = unit(child.clone().sub(origin));
    if (!dir) return;

    const down = basis.up.clone().negate();
    const elevation = angleDeg(down, dir);
    angles[elevationId] = elevation;

    // 方位：去掉沿躯干轴的分量后，在「外侧 / 前方」平面内取极角
    const planar = perpendicular(dir.clone(), basis.up);
    if (planar) {
      const outward =
        side === 'left' ? basis.left : basis.left.clone().negate();
      angles[azimuthId] =
        Math.atan2(planar.dot(outward), planar.dot(basis.forward)) * RAD2DEG;
    }

    arcs.push({
      id: elevationId,
      label,
      group: side,
      vertex: origin,
      refDir: down,
      targetDir: dir,
      deg: elevation,
    });
  }
}

/**
 * 输入 pb 数据，输出整段序列的关节角度。
 *
 * 内部沿用与 poseDriver 相同的前处理：先清洗（剔坏帧 / 误检点 → 插值 → 平滑），
 * 再按同一套判据消除镜像 —— 否则方位角、肩髋分离这类有符号量会整体反号。
 *
 * @param {object} options
 * @param {object} options.data - SwingPose3D（withJointsAsList 后）
 */
export function createIKSolver({ data }) {
  const frames = data?.frames ?? [];
  const mirrored = detectMirroredHandedness(frames);
  const { joints: cleanFrames, report } = sanitizePose3D(frames);

  const perFrame = cleanFrames.map((frameJoints) => {
    /** @type {Map<string, THREE.Vector3>} */
    const points = new Map();
    for (const [name, p] of frameJoints) {
      points.set(name, applyMirror(p.clone(), mirrored));
    }
    return solvePoseAngles((name) => points.get(name) ?? null).angles;
  });

  /** @param {number} index */
  function getFrameAngles(index) {
    if (perFrame.length === 0) return null;
    const i = Math.max(0, Math.min(perFrame.length - 1, index | 0));
    return perFrame[i];
  }

  return {
    frameCount: perFrame.length,
    /** pb 是否为左手系（已在解算前修正） */
    mirrored,
    /** 数据清洗结果：被剔除的帧与误检关节 */
    sanitizeReport: report,
    definitions: ANGLE_DEFS,
    getFrameAngles,
    getAllAngles: () => perFrame,
    /** 导出成可直接落盘的结构，帧号沿用 pb 的 frame_idx */
    toJSON() {
      return {
        definitions: ANGLE_DEFS,
        frames: perFrame.map((angles, i) => ({
          frame_idx: frames[i]?.frame_idx ?? i,
          timestamp_sec: frames[i]?.timestamp_sec ?? null,
          angles,
        })),
      };
    },
  };
}

/**
 * @param {{ x: number, y: number, z: number } | null | undefined} p
 * @returns {THREE.Vector3 | null}
 */
function toVector(p) {
  if (!p) return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
    return null;
  }
  return new THREE.Vector3(p.x, p.y, p.z);
}

/**
 * @param {THREE.Vector3 | null} v
 * @returns {THREE.Vector3 | null} 就地归一化；长度过小时返回 null
 */
function unit(v) {
  if (!v || v.lengthSq() < 1e-12) return null;
  return v.normalize();
}

/**
 * 取 v 垂直于 axis 的分量并归一化。
 * @param {THREE.Vector3} v
 * @param {THREE.Vector3} axis - 单位向量
 * @returns {THREE.Vector3 | null}
 */
function perpendicular(v, axis) {
  const out = v.clone().addScaledVector(axis, -v.dot(axis));
  return unit(out);
}

/**
 * 由「上方向 + 左方向」构造人体正交基（右手系：left × up = forward）。
 * @param {THREE.Vector3 | null} up
 * @param {THREE.Vector3 | null} sideRaw - 右侧→左侧
 * @returns {{ up: THREE.Vector3, left: THREE.Vector3, forward: THREE.Vector3 } | null}
 */
function makeBasis(up, sideRaw) {
  if (!up || !sideRaw) return null;
  const y = up.clone();
  const left = perpendicular(sideRaw.clone(), y);
  if (!left) return null;
  const forward = new THREE.Vector3().crossVectors(left, y).normalize();
  return { up: y, left, forward };
}

/**
 * @param {THREE.Vector3} a - 单位向量
 * @param {THREE.Vector3} b - 单位向量
 * @returns {number} 夹角（度，0~180）
 */
function angleDeg(a, b) {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * RAD2DEG;
}

/**
 * 绕 axis 从 from 转到 to 的有符号角。
 * @param {THREE.Vector3} from - 单位向量，垂直 axis
 * @param {THREE.Vector3} to - 单位向量，垂直 axis
 * @param {THREE.Vector3} axis - 单位向量
 * @returns {number} 度，逆时针（右手定则）为正
 */
function signedAngleDeg(from, to, axis) {
  const cross = new THREE.Vector3().crossVectors(from, to);
  return Math.atan2(cross.dot(axis), from.dot(to)) * RAD2DEG;
}
