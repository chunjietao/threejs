/**
 * English: Joint↔bone mapping store for retargeting SwingPose3D pb onto the Xbot Mixamo skeleton.
 * 中文：关节↔骨骼映射表，为后续用 swing_pose3d.pb 驱动 Xbot（Mixamo）骨骼动画做准备；支持从已存 JSON 恢复。
 */

/**
 * 高尔夫 Pose 关节名 → Mixamo 骨骼名的默认对应关系。
 * 本仓库 Xbot.glb 骨骼名为 mixamorigHips（无冒号）；球杆类暂无对应。
 * @type {Record<string, string | null>}
 */
export const DEFAULT_JOINT_TO_BONE = {
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
  golf_shaft_tip: null,
  club_head_toe: null,
  golf_club_shaft_handle_tip: null,
};

/**
 * @param {object} options
 * @param {string[]} options.joints - pb 中的关节名
 * @param {string[]} options.boneNames - 模型骨骼名
 * @param {Record<string, string | null>} [options.defaults]
 * @param {Record<string, string | null> | null} [options.savedMap] - 已保存的 JSON 映射，优先于 defaults
 */
export function createJointBoneMap({
  joints,
  boneNames,
  defaults = DEFAULT_JOINT_TO_BONE,
  savedMap = null,
}) {
  const boneSet = new Set(boneNames);

  /** @type {Map<string, string | null>} joint → bone | null */
  const jointToBone = new Map();

  for (const joint of joints) {
    jointToBone.set(joint, resolveBone(joint, defaults, savedMap, boneSet));
  }

  /** @type {Set<(snapshot: ReturnType<typeof snapshot>) => void>} */
  const listeners = new Set();

  function notify() {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  function snapshot() {
    /** @type {Record<string, string | null>} */
    const map = {};
    for (const [joint, bone] of jointToBone) map[joint] = bone;

    const paired = [...jointToBone.entries()]
      .filter(([, bone]) => bone)
      .map(([joint, bone]) => ({ joint, bone }));

    const unmappedJoints = [...jointToBone.entries()]
      .filter(([, bone]) => !bone)
      .map(([joint]) => joint);

    const mappedBones = new Set(
      [...jointToBone.values()].filter((bone) => bone),
    );

    return {
      map,
      paired,
      unmappedJoints,
      mappedBoneCount: mappedBones.size,
      jointCount: joints.length,
      boneCount: boneNames.length,
    };
  }

  /**
   * @param {string} joint
   * @param {string | null} bone
   */
  function setMapping(joint, bone) {
    if (!jointToBone.has(joint)) return false;
    if (bone !== null) {
      const normalized = normalizeBoneName(bone, boneSet);
      if (!normalized) return false;
      jointToBone.set(joint, normalized);
    } else {
      jointToBone.set(joint, null);
    }
    notify();
    return true;
  }

  /**
   * 批量套用一份 map（来自 JSON / localStorage）。
   * 只更新当前 joints 中存在的键；骨骼不在模型里则置 null。
   * @param {Record<string, string | null>} map
   * @param {object} [options]
   * @param {boolean} [options.replaceMissingWithNull] - 未出现在 map 里的关节是否清空
   */
  function applyMap(map, options = {}) {
    const { replaceMissingWithNull = false } = options;
    for (const joint of joints) {
      if (Object.prototype.hasOwnProperty.call(map, joint)) {
        const bone = map[joint];
        jointToBone.set(
          joint,
          bone ? normalizeBoneName(bone, boneSet) : null,
        );
      } else if (replaceMissingWithNull) {
        jointToBone.set(joint, null);
      }
    }
    notify();
  }

  /** @param {string} joint */
  function getBoneForJoint(joint) {
    return jointToBone.has(joint) ? jointToBone.get(joint) : undefined;
  }

  /** @param {string} bone */
  function getJointForBone(bone) {
    for (const [joint, mapped] of jointToBone) {
      if (mapped === bone) return joint;
    }
    return null;
  }

  /** 恢复默认映射（仅保留模型里实际存在的骨骼） */
  function resetToDefaults() {
    for (const joint of joints) {
      jointToBone.set(
        joint,
        normalizeBoneName(defaults[joint] ?? null, boneSet),
      );
    }
    notify();
  }

  /** 清空全部映射 */
  function clearAll() {
    for (const joint of joints) jointToBone.set(joint, null);
    notify();
  }

  /**
   * @param {(snapshot: ReturnType<typeof snapshot>) => void} listener
   * @returns {() => void} unsubscribe
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    joints,
    boneNames,
    getBoneForJoint,
    getJointForBone,
    setMapping,
    applyMap,
    resetToDefaults,
    clearAll,
    subscribe,
    getSnapshot: snapshot,
  };
}

/**
 * 兼容 mixamorig:Head 与 mixamorigHead 两种命名。
 * @param {string | null} bone
 * @param {Set<string>} boneSet
 * @returns {string | null}
 */
function normalizeBoneName(bone, boneSet) {
  if (!bone) return null;
  if (boneSet.has(bone)) return bone;
  const noColon = bone.replace(':', '');
  if (noColon !== bone && boneSet.has(noColon)) return noColon;
  const withColon = bone.replace(/^(mixamorig)(?![:])/, '$1:');
  if (withColon !== bone && boneSet.has(withColon)) return withColon;
  return null;
}

/**
 * @param {string} joint
 * @param {Record<string, string | null>} defaults
 * @param {Record<string, string | null> | null} savedMap
 * @param {Set<string>} boneSet
 */
function resolveBone(joint, defaults, savedMap, boneSet) {
  if (savedMap && Object.prototype.hasOwnProperty.call(savedMap, joint)) {
    const saved = savedMap[joint];
    if (saved === null || saved === '') return null;
    const normalized = normalizeBoneName(saved, boneSet);
    if (normalized) return normalized;
    // 已保存但骨骼名不存在：回退默认
  }
  const preferred = defaults[joint] ?? null;
  return normalizeBoneName(preferred, boneSet);
}
