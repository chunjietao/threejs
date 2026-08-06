/**
 * English: Cleans SwingPose3D joint tracks — drops degenerate frames and mis-tracked joints,
 * fills gaps by interpolation, then lightly smooths the result.
 * 中文：清洗 SwingPose3D 关节轨迹 —— 剔除退化帧与误检关节，插值补洞，再做轻度平滑。
 *
 * 【为什么需要清洗】
 * pb 是从两路相机三角化出来的，末尾若干帧质量会掉：
 *   - 整帧退化：所有关节塌缩到同一个点（三角化失败）
 *   - 单点误检：例如右肩被识别到手肘位置，导致上臂方向完全错误
 * 这些坏数据一旦直接驱动骨骼，人物就会扭成不合常理的姿势。
 * 判据只用 pb 自身：人体骨段长度在整段序列里应当基本恒定。
 */
import * as THREE from 'three';

/** 用于长度一致性检查的骨段（球杆关节不参与） */
const SEGMENTS = [
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
  ['left_shoulder', 'right_shoulder'],
  ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_ear', 'right_ear'],
  ['nose', 'left_ear'],
  ['nose', 'right_ear'],
];

/**
 * 骨段长度容差：超出中位数的这个倍数区间即判为异常。
 * 阈值刻意放宽 —— 这份数据在快速挥杆段普遍存在中度收缩（骨段只剩 40~70%），
 * 但方向仍然可用；只有灾难性的错误（关节被识别到别的部位）才值得丢弃，
 * 否则大段插值反而会把真实动作抹平。
 */
const LENGTH_MIN_RATIO = 0.15;
const LENGTH_MAX_RATIO = 2.5;

/**
 * 尖峰判据：以「偏离前后帧中点」这个量自身的中位数为基准。
 * 直接衡量轨迹的不光滑程度，因此对慢关节和快关节都能自适应 ——
 * 真实的高速运动虽然位移大，但仍会平滑地穿过中点。
 */
const SPIKE_RATIO = 6;

/** 整帧退化判据：关节离质心的中位距离低于序列中位数的这个比例 */
const DEGENERATE_SPREAD_RATIO = 0.35;

/** 平滑核（三点加权平均），坏帧插值后仍会有轻微抖动 */
const SMOOTH_KERNEL = [0.25, 0.5, 0.25];

/**
 * 铰链关节：肘和膝只能朝一个方向弯。
 * maxFlexionDeg 是「相对伸直状态」的最大弯曲量（180° 表示完全对折）。
 *
 * checkBendSide 只对膝盖开启：判断弯曲方向要拿骨盆左向轴当参照，
 * 而挥杆时整条手臂会绕身体转过很大范围，肘的铰链轴相对骨盆本来就会翻面，
 * 对肘做这项检查会把正常动作误判成反关节。腿是支撑结构，不存在这个问题。
 */
const HINGES = [
  {
    proximal: 'left_shoulder',
    joint: 'left_elbow',
    distal: 'left_wrist',
    maxFlexionDeg: 150,
    checkBendSide: false,
  },
  {
    proximal: 'right_shoulder',
    joint: 'right_elbow',
    distal: 'right_wrist',
    maxFlexionDeg: 150,
    checkBendSide: false,
  },
  {
    proximal: 'left_hip',
    joint: 'left_knee',
    distal: 'left_ankle',
    maxFlexionDeg: 150,
    checkBendSide: true,
  },
  {
    proximal: 'right_hip',
    joint: 'right_knee',
    distal: 'right_ankle',
    maxFlexionDeg: 150,
    checkBendSide: true,
  },
];

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * 把 pb 帧转成 Map<关节名, Vector3>，兼容 joints 是数组或对象两种形态。
 * @param {object} frame
 * @returns {Map<string, THREE.Vector3>}
 */
function toJointMap(frame) {
  /** @type {Map<string, THREE.Vector3>} */
  const map = new Map();
  const list = Array.isArray(frame?.joints)
    ? frame.joints
    : Object.entries(frame?.joints ?? {}).map(([name, j]) => ({ name, ...j }));

  for (const entry of list) {
    const p = entry.position;
    if (!p) continue;
    map.set(entry.name, new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0));
  }
  return map;
}

/**
 * 剔除整帧退化的帧（所有关节塌缩到一点 / 质心飞到离谱的位置）。
 * @param {Map<string, THREE.Vector3>[]} table
 * @returns {number[]} 被丢弃的帧下标
 */
function dropDegenerateFrames(table) {
  const spreads = table.map((map) => {
    if (map.size === 0) return { spread: 0, centroidDist: 0 };
    const centroid = new THREE.Vector3();
    for (const p of map.values()) centroid.add(p);
    centroid.divideScalar(map.size);
    const distances = [...map.values()].map((p) => p.distanceTo(centroid));
    return { spread: median(distances), centroidDist: centroid.length() };
  });

  const spreadMedian = median(spreads.filter((s) => s.spread > 0).map((s) => s.spread));
  const centroidMedian = median(spreads.map((s) => s.centroidDist));
  const centroidLimit = Math.max(centroidMedian * 8, spreadMedian * 8);

  /** @type {number[]} */
  const dropped = [];
  table.forEach((map, i) => {
    const { spread, centroidDist } = spreads[i];
    const degenerate =
      map.size === 0 ||
      spread < spreadMedian * DEGENERATE_SPREAD_RATIO ||
      centroidDist > centroidLimit;
    if (degenerate) {
      map.clear();
      dropped.push(i);
    }
  });
  return dropped;
}

/**
 * 按骨段长度一致性剔除误检关节。
 * 某个关节的多条相连骨段同时长度异常时，说明是这个点被识别错了。
 * @param {Map<string, THREE.Vector3>[]} table
 * @returns {Map<string, number[]>} 关节名 → 被剔除的帧下标
 */
function dropMistrackedJoints(table) {
  /** @type {Map<string, number>} 骨段 → 长度中位数 */
  const segmentMedian = new Map();
  for (const [a, b] of SEGMENTS) {
    const lengths = [];
    for (const map of table) {
      const pa = map.get(a);
      const pb = map.get(b);
      if (pa && pb) lengths.push(pa.distanceTo(pb));
    }
    if (lengths.length > 0) segmentMedian.set(`${a}|${b}`, median(lengths));
  }

  /** @type {Map<string, number[]>} */
  const removed = new Map();

  table.forEach((map, frameIndex) => {
    /** @type {Map<string, { total: number, bad: number }>} */
    const score = new Map();

    for (const [a, b] of SEGMENTS) {
      const expected = segmentMedian.get(`${a}|${b}`);
      const pa = map.get(a);
      const pb = map.get(b);
      if (!expected || expected <= 0 || !pa || !pb) continue;

      const ratio = pa.distanceTo(pb) / expected;
      const bad = ratio < LENGTH_MIN_RATIO || ratio > LENGTH_MAX_RATIO;
      for (const name of [a, b]) {
        const entry = score.get(name) ?? { total: 0, bad: 0 };
        entry.total += 1;
        if (bad) entry.bad += 1;
        score.set(name, entry);
      }
    }

    for (const [name, { total, bad }] of score) {
      // 两条以上相连骨段同时异常，或唯一一条骨段异常 → 判定该关节误检
      if (bad >= 2 || (total === 1 && bad === 1)) {
        map.delete(name);
        if (!removed.has(name)) removed.set(name, []);
        removed.get(name).push(frameIndex);
      }
    }
  });

  return removed;
}

/**
 * 剔除「瞬移」关节：某一帧突然跳到远处，下一帧又跳回来。
 * 快速但连贯的真实运动不会被误伤，因为它不会「跳出去再跳回来」。
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Set<string>} names
 * @param {Map<string, number[]>} removed - 就地累加剔除记录
 */
function dropSpikes(table, names, removed) {
  for (const name of names) {
    /** @type {{ index: number, deviation: number }[]} */
    const deviations = [];
    for (let i = 1; i < table.length - 1; i += 1) {
      const prev = table[i - 1].get(name);
      const cur = table[i].get(name);
      const next = table[i + 1].get(name);
      if (!prev || !cur || !next) continue;

      const expected = prev.clone().add(next).multiplyScalar(0.5);
      deviations.push({ index: i, deviation: cur.distanceTo(expected) });
    }
    if (deviations.length < 4) continue;

    const limit = median(deviations.map((d) => d.deviation)) * SPIKE_RATIO;
    if (!(limit > 0)) continue;

    for (const { index, deviation } of deviations) {
      if (deviation <= limit) continue;
      table[index].delete(name);
      if (!removed.has(name)) removed.set(name, []);
      removed.get(name).push(index);
    }
  }
}

/**
 * 缺失关节按最近的前后有效帧线性插值补齐；只有单侧时直接沿用。
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Set<string>} names
 */
function fillGaps(table, names) {
  for (const name of names) {
    for (let i = 0; i < table.length; i += 1) {
      if (table[i].has(name)) continue;

      let prev = i - 1;
      while (prev >= 0 && !table[prev].has(name)) prev -= 1;
      let next = i + 1;
      while (next < table.length && !table[next].has(name)) next += 1;

      const before = prev >= 0 ? table[prev].get(name) : null;
      const after = next < table.length ? table[next].get(name) : null;

      if (before && after) {
        table[i].set(name, before.clone().lerp(after, (i - prev) / (next - prev)));
      } else if (before || after) {
        table[i].set(name, (before ?? after).clone());
      }
    }
  }
}

/**
 * 取躯干的「向左」参考轴，用来判断铰链关节朝哪一侧弯。
 * @param {Map<string, THREE.Vector3>} map
 * @returns {THREE.Vector3 | null}
 */
function bodyLeftAxis(map) {
  const pairs = [
    ['left_hip', 'right_hip'],
    ['left_shoulder', 'right_shoulder'],
  ];
  for (const [l, r] of pairs) {
    const a = map.get(l);
    const b = map.get(r);
    if (a && b) {
      const axis = a.clone().sub(b);
      if (axis.lengthSq() > 1e-12) return axis.normalize();
    }
  }
  return null;
}

/** 驱动骨骼朝向所依赖的骨段：这些段的「方向」必须连续 */
const DIRECTION_SEGMENTS = [
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

/** 方向突变阈值：取该骨段自身 p90 角速度的这个倍数，再夹到下面的上下限内 */
const DIRECTION_JUMP_RATIO = 3;
const DIRECTION_JUMP_MIN_DEG = 30;
/** 人体肢体在 30fps 下不可能一帧转过这么多度，超过必然是误检 */
const DIRECTION_JUMP_MAX_DEG = 90;

/**
 * 剔除造成骨段「方向突变」的远端关节。
 *
 * 骨骼是靠骨段方向驱动的，而这份数据里前臂常被解得很短；
 * 骨段越短，末端一点点位置误差就会被放大成巨大的角度摆动，
 * 严重时肘和腕直接被解反，方向整体翻转 180°、还会连续错好几帧。
 * 因此这里同样要带「跟丢」状态：一直丢到方向回到上一个可信朝向附近。
 *
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Map<string, number[]>} removed - 就地累加剔除记录
 */
function dropDirectionJumps(table, removed) {
  for (const [proximal, distal] of DIRECTION_SEGMENTS) {
    /** @param {Map<string, THREE.Vector3>} map */
    const directionOf = (map) => {
      const a = map.get(proximal);
      const b = map.get(distal);
      if (!a || !b) return null;
      const dir = b.clone().sub(a);
      return dir.lengthSq() > 1e-12 ? dir.normalize() : null;
    };

    const dirs = table.map(directionOf);
    const steps = [];
    for (let i = 1; i < dirs.length; i += 1) {
      if (dirs[i - 1] && dirs[i]) steps.push(dirs[i - 1].angleTo(dirs[i]));
    }
    if (steps.length < 4) continue;

    steps.sort((x, y) => x - y);
    const limit = THREE.MathUtils.clamp(
      steps[Math.floor(steps.length * 0.9)] * DIRECTION_JUMP_RATIO,
      THREE.MathUtils.degToRad(DIRECTION_JUMP_MIN_DEG),
      THREE.MathUtils.degToRad(DIRECTION_JUMP_MAX_DEG),
    );

    let lastGood = null;
    let gap = 1;
    for (let i = 0; i < table.length; i += 1) {
      const current = dirs[i];
      if (!current) {
        gap += 1;
        continue;
      }
      if (lastGood && current.angleTo(lastGood) > limit * Math.min(gap, 3)) {
        table[i].delete(distal);
        if (!removed.has(distal)) removed.set(distal, []);
        removed.get(distal).push(i);
        gap += 1;
        continue;
      }
      lastGood = current;
      gap = 1;
    }
  }
}

/**
 * 下肢是支撑结构，挥杆时移动缓慢；一旦某帧突然位移远超它自己的常规速度，
 * 就是跟踪丢失。与尖峰不同，跟丢会连续错好几帧，所以要一直丢到它回到
 * 上一个可信位置附近为止。上肢与球杆本来就快，不参与这项检查。
 */
const SLOW_JOINTS = [
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

/** 跟踪丢失判据：位移超过该关节自身 p90 位移的这个倍数 */
const TRACKING_LOSS_RATIO = 3;

/**
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Map<string, number[]>} removed - 就地累加剔除记录
 */
function dropTrackingLoss(table, removed) {
  for (const name of SLOW_JOINTS) {
    const steps = [];
    for (let i = 1; i < table.length; i += 1) {
      const a = table[i - 1].get(name);
      const b = table[i].get(name);
      if (a && b) steps.push(a.distanceTo(b));
    }
    if (steps.length < 4) continue;

    steps.sort((x, y) => x - y);
    const limit = steps[Math.floor(steps.length * 0.9)] * TRACKING_LOSS_RATIO;
    if (!(limit > 0)) continue;

    let lastGood = null;
    let gap = 1;
    for (let i = 0; i < table.length; i += 1) {
      const current = table[i].get(name);
      if (!current) {
        gap += 1;
        continue;
      }
      if (lastGood && current.distanceTo(lastGood) > limit * Math.min(gap, 3)) {
        table[i].delete(name);
        if (!removed.has(name)) removed.set(name, []);
        removed.get(name).push(i);
        gap += 1;
        continue;
      }
      lastGood = current;
      gap = 1;
    }
  }
}

/**
 * 剔除违反人体上下次序的腿部关节：沿躯干上方向投影，必须满足 踝 < 膝 < 髋。
 *
 * 这份数据在收杆段会把左踝跟丢到胸口高度，长度检查与尖峰检查都抓不到
 * （它错得很稳定，连错好几帧），但「脚在膝盖上面」显然不合常理。
 *
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Map<string, number[]>} removed - 就地累加剔除记录
 */
function dropInvertedLegs(table, removed) {
  const legs = [
    { hip: 'left_hip', knee: 'left_knee', ankle: 'left_ankle' },
    { hip: 'right_hip', knee: 'right_knee', ankle: 'right_ankle' },
  ];

  table.forEach((map, i) => {
    const hipMid = midpoint(map, 'left_hip', 'right_hip');
    const shoulderMid = midpoint(map, 'left_shoulder', 'right_shoulder');
    if (!hipMid || !shoulderMid) return;

    const up = shoulderMid.clone().sub(hipMid);
    if (up.lengthSq() < 1e-12) return;
    up.normalize();

    /** @param {string} name */
    const height = (name) => {
      const p = map.get(name);
      return p ? p.clone().sub(hipMid).dot(up) : null;
    };

    /** @param {string} name */
    const drop = (name) => {
      map.delete(name);
      if (!removed.has(name)) removed.set(name, []);
      removed.get(name).push(i);
    };

    for (const leg of legs) {
      const hipH = height(leg.hip);
      const kneeH = height(leg.knee);
      const ankleH = height(leg.ankle);

      if (hipH != null && kneeH != null && kneeH >= hipH) {
        drop(leg.knee);
        if (ankleH != null) drop(leg.ankle);
        continue;
      }
      if (kneeH != null && ankleH != null && ankleH >= kneeH) drop(leg.ankle);
    }
  });
}

/**
 * @param {Map<string, THREE.Vector3>} map
 * @param {string} a
 * @param {string} b
 * @returns {THREE.Vector3 | null}
 */
function midpoint(map, a, b) {
  const pa = map.get(a);
  const pb = map.get(b);
  if (!pa || !pb) return null;
  return pa.clone().add(pb).multiplyScalar(0.5);
}

/**
 * 逐帧算出铰链的骨轴方向与弯曲侧符号。
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {(typeof HINGES)[number]} hinge
 */
function hingeSamples(table, hinge) {
  return table.map((map) => {
    const p = map.get(hinge.proximal);
    const j = map.get(hinge.joint);
    const d = map.get(hinge.distal);
    const left = bodyLeftAxis(map);
    if (!p || !j || !d || !left) return null;

    const axis = j.clone().sub(p);
    const limb = d.clone().sub(j);
    if (axis.lengthSq() < 1e-12 || limb.lengthSq() < 1e-12) return null;

    axis.normalize();
    const sign = new THREE.Vector3()
      .crossVectors(axis, limb.clone().normalize())
      .dot(left);
    return { axis, sign };
  });
}

/**
 * 整段序列里弯曲侧出现更多的那一方，即为该铰链的解剖学正确方向。
 * @param {({ sign: number } | null)[]} samples
 * @returns {number} 1 或 -1；无有效样本时返回 0
 */
function dominantBendSide(samples) {
  let positive = 0;
  let negative = 0;
  for (const s of samples) {
    if (!s || Math.abs(s.sign) < 1e-6) continue;
    if (s.sign > 0) positive += 1;
    else negative += 1;
  }
  if (positive === 0 && negative === 0) return 0;
  return positive >= negative ? 1 : -1;
}

/**
 * 剔除造成「反关节」的远端关节（膝盖朝前折、肘部朝外折）。
 *
 * 出现反关节几乎一定是远端点被解错了位置，直接翻转会让脚/手瞬移一大段；
 * 丢掉再按邻帧插值，支撑脚才能稳稳踩在地上。
 *
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Map<string, number[]>} removed - 就地累加剔除记录
 */
function dropReverseBends(table, removed) {
  for (const hinge of HINGES) {
    if (!hinge.checkBendSide) continue;
    const samples = hingeSamples(table, hinge);
    const dominant = dominantBendSide(samples);
    if (dominant === 0) continue;

    samples.forEach((sample, i) => {
      if (!sample || Math.abs(sample.sign) < 1e-6) return;
      if (Math.sign(sample.sign) === dominant) return;

      table[i].delete(hinge.distal);
      if (!removed.has(hinge.distal)) removed.set(hinge.distal, []);
      removed.get(hinge.distal).push(i);
    });
  }
}

/**
 * 最后一道兜底：把弯曲角收进人体可达范围，必要时纠正弯曲侧。
 * 插值与平滑之后仍可能残留越界，因此这一步必须放在流程末尾。
 *
 * @param {Map<string, THREE.Vector3>[]} table
 * @returns {Record<string, number>} 各铰链被修正的帧数
 */
function enforceHingeLimits(table) {
  /** @type {Record<string, number>} */
  const fixed = {};

  for (const hinge of HINGES) {
    const { joint, distal, maxFlexionDeg, checkBendSide } = hinge;
    const samples = hingeSamples(table, hinge);
    const dominant = checkBendSide ? dominantBendSide(samples) : 0;

    const maxFlexion = THREE.MathUtils.degToRad(maxFlexionDeg);
    let count = 0;

    table.forEach((map, i) => {
      const sample = samples[i];
      if (!sample) return;
      const j = map.get(joint);
      const d = map.get(distal);
      if (!j || !d) return;

      const length = j.distanceTo(d);
      if (length < 1e-9) return;

      const axis = sample.axis;
      const limb = d.clone().sub(j).divideScalar(length);

      // 分解成「沿骨轴」与「垂直于骨轴」两部分
      const along = axis.dot(limb);
      const perp = limb.clone().addScaledVector(axis, -along);
      if (perp.lengthSq() < 1e-12) return;

      let changed = false;

      // 反关节：把垂直分量翻到另一侧（弯曲平面不变，只换边）
      if (dominant !== 0 && Math.abs(sample.sign) > 1e-6 && Math.sign(sample.sign) !== dominant) {
        perp.negate();
        changed = true;
      }

      // 超过最大弯曲角：沿同一平面收回到极限
      const flexion = Math.atan2(perp.length(), along);
      if (flexion > maxFlexion) {
        perp.normalize().multiplyScalar(Math.sin(maxFlexion));
        limb.copy(axis).multiplyScalar(Math.cos(maxFlexion)).add(perp);
        changed = true;
      } else if (changed) {
        limb.copy(axis).multiplyScalar(along).add(perp);
      }

      if (!changed) return;
      map.set(distal, j.clone().addScaledVector(limb.normalize(), length));
      count += 1;
    });

    if (count > 0) fixed[joint] = count;
  }

  return fixed;
}

/**
 * 逐帧逐关节的可信度 0~1：由相连骨段的长度偏差推出。
 * 人体骨段长度恒定，量出来越离谱，说明这一帧这个点越不可信。
 * @param {Map<string, THREE.Vector3>[]} table
 * @returns {Map<string, number>[]}
 */
function computeReliability(table) {
  /** @type {Map<string, number>} */
  const segmentMedian = new Map();
  for (const [a, b] of SEGMENTS) {
    const lengths = [];
    for (const map of table) {
      const pa = map.get(a);
      const pb = map.get(b);
      if (pa && pb) lengths.push(pa.distanceTo(pb));
    }
    if (lengths.length > 0) segmentMedian.set(`${a}|${b}`, median(lengths));
  }

  /** 长度比 → 可信度 */
  const trust = (ratio) => {
    if (ratio >= 0.75 && ratio <= 1.35) return 1;
    if (ratio > 1.35) return Math.max(0, (2.2 - ratio) / (2.2 - 1.35));
    return Math.max(0, (ratio - 0.35) / (0.75 - 0.35));
  };

  return table.map((map) => {
    /** @type {Map<string, number>} */
    const out = new Map();
    for (const [a, b] of SEGMENTS) {
      const expected = segmentMedian.get(`${a}|${b}`);
      const pa = map.get(a);
      const pb = map.get(b);
      if (!expected || expected <= 0 || !pa || !pb) continue;

      const value = trust(pa.distanceTo(pb) / expected);
      for (const name of [a, b]) {
        out.set(name, Math.min(out.get(name) ?? 1, value));
      }
    }
    return out;
  });
}

/**
 * 自适应平滑：
 * - 数据可信时只做轻度三点去抖，保住真实的快速动作；
 * - 数据不可信时改用更宽的、按可信度加权的窗口，让姿势由邻近的可靠帧撑住，
 *   而不是硬跳到一个错误位置。
 *
 * @param {Map<string, THREE.Vector3>[]} table
 * @param {Set<string>} names
 * @returns {Map<string, THREE.Vector3>[]}
 */
function smooth(table, names) {
  if (table.length < 3) return table;

  const reliability = computeReliability(table);
  const halfWindow = 4;
  const sigma = 1.8;

  return table.map((map, i) => {
    /** @type {Map<string, THREE.Vector3>} */
    const out = new Map();

    for (const name of names) {
      const current = map.get(name);
      if (!current) continue;

      // 轻度去抖
      const base = new THREE.Vector3();
      let baseWeight = 0;
      SMOOTH_KERNEL.forEach((weight, k) => {
        const source = table[i + k - 1]?.get(name);
        if (!source) return;
        base.addScaledVector(source, weight);
        baseWeight += weight;
      });
      if (baseWeight > 0) base.divideScalar(baseWeight);
      else base.copy(current);

      const trust = reliability[i].get(name) ?? 1;
      if (trust >= 1) {
        out.set(name, base);
        continue;
      }

      // 按可信度加权的宽窗
      const wide = new THREE.Vector3();
      let wideWeight = 0;
      for (let k = -halfWindow; k <= halfWindow; k += 1) {
        const source = table[i + k]?.get(name);
        if (!source) continue;
        const w =
          Math.exp(-(k * k) / (2 * sigma * sigma)) *
          Math.max(reliability[i + k].get(name) ?? 1, 0.05);
        wide.addScaledVector(source, w);
        wideWeight += w;
      }
      if (wideWeight <= 0) {
        out.set(name, base);
        continue;
      }
      wide.divideScalar(wideWeight);

      out.set(name, wide.lerp(base, trust));
    }
    return out;
  });
}

/**
 * 清洗整段关节轨迹。
 *
 * @param {object[]} frames - SwingPose3D.frames
 * @returns {{
 *   joints: Map<string, THREE.Vector3>[],
 *   report: {
 *     droppedFrames: number[],
 *     removedJoints: Record<string, number[]>,
 *     frameCount: number,
 *   },
 * }}
 */
export function sanitizePose3D(frames) {
  const table = (frames ?? []).map(toJointMap);

  const names = new Set();
  for (const map of table) for (const name of map.keys()) names.add(name);

  const droppedFrames = dropDegenerateFrames(table);
  const removed = dropMistrackedJoints(table);
  dropSpikes(table, names, removed);
  dropDirectionJumps(table, removed);
  dropInvertedLegs(table, removed);
  dropTrackingLoss(table, removed);
  dropReverseBends(table, removed);
  fillGaps(table, names);
  // 先平滑再约束：平滑会把已修正的关节重新拉回违规位置，约束必须是最后一步
  const joints = smooth(table, names);
  const hingeFixes = enforceHingeLimits(joints);

  for (const frames of removed.values()) frames.sort((a, b) => a - b);

  return {
    joints,
    report: {
      droppedFrames,
      removedJoints: Object.fromEntries(removed),
      hingeFixes,
      frameCount: table.length,
    },
  };
}
