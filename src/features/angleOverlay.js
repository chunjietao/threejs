/**
 * English: Renders solved joint angles on a skeleton as arcs with degree labels.
 * 中文：把逆向运动学解出的关节角度，以圆弧 + 度数标签画在火柴人或 GLB 骨架上。
 *
 * 本文件不含任何运动学计算 —— 顶点、两条边的方向、角度值全部由 ikSolver 给出，
 * 这里只负责把它们画成「参考边 → 圆弧 → 目标边」的角度标记。
 *
 * 父节点和弧坐标必须处于同一坐标空间：
 * - 火柴人：挂在 stickman.root，弧使用火柴人的局部坐标；
 * - GLB：挂在 scene，弧使用模型骨骼的世界坐标。
 */
import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

/** 弧半径（米）；再小就看不清，再大会和相邻关节的弧打架 */
const ARC_RADIUS = 0.075;

/** 弧的分段数：18 段在 180° 时仍然平滑 */
const ARC_SEGMENTS = 18;

/** 两条边各自伸出弧外的长度倍率，让角标记读起来像「∠」 */
const RAY_SCALE = 1.55;

/** 小于这个角度不画：弧退化成点，且旋转轴不稳定 */
const MIN_VISIBLE_DEG = 3;

const GROUP_COLORS = Object.freeze({
  left: 0x4ade80,
  right: 0xf472b6,
  torso: 0xa78bfa,
});
const FALLBACK_COLOR = 0xe2e8f0;

const LABEL_CANVAS_WIDTH = 256;
const LABEL_CANVAS_HEIGHT = 64;
/** 标签在世界空间的宽度（米） */
const LABEL_WIDTH = 0.26;
const LABEL_FONT =
  'bold 38px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _point = new THREE.Vector3();
const _bisector = new THREE.Vector3();

/**
 * @param {THREE.Object3D} parent - 承载角度标记的父节点（一般是火柴人的 root）
 * @param {object} options
 * @param {() => { arcs: import('./ikSolver.js').AngleArc[] }} options.solve - 每帧提供角度弧
 * @param {number} [options.radius] - 弧半径（米）
 * @param {string} [options.name] - 场景节点名称，便于区分多个角度层
 */
export function createAngleOverlay(parent, options) {
  const { solve } = options;
  const radius =
    typeof options.radius === 'number' && options.radius > 0
      ? options.radius
      : ARC_RADIUS;

  const root = new THREE.Group();
  root.name = options.name ?? 'AngleOverlay';
  parent.add(root);

  /** @type {Map<string, ReturnType<typeof createMark>>} */
  const marks = new Map();
  let visible = true;

  /** @param {import('./ikSolver.js').AngleArc} arc */
  function markFor(arc) {
    let mark = marks.get(arc.id);
    if (!mark) {
      mark = createMark(arc, root);
      marks.set(arc.id, mark);
    }
    return mark;
  }

  /** 按当前帧的解算结果刷新全部角度标记 */
  function update() {
    root.visible = visible;
    if (!visible) return;

    const arcs = solve()?.arcs ?? [];
    /** @type {Set<string>} */
    const drawn = new Set();

    for (const arc of arcs) {
      const mark = markFor(arc);
      if (drawArc(mark, arc, radius)) drawn.add(arc.id);
      else hideMark(mark);
    }

    // 本帧缺关节的角度标记要收起来，否则会残留上一帧的位置
    for (const [id, mark] of marks) {
      if (!drawn.has(id)) hideMark(mark);
    }
  }

  /** @param {boolean} show */
  function setVisible(show) {
    visible = show;
    root.visible = show;
  }

  function dispose() {
    parent.remove(root);
    for (const mark of marks.values()) {
      mark.line.geometry.dispose();
      mark.line.material.dispose();
      mark.sprite.material.map?.dispose();
      mark.sprite.material.dispose();
    }
    marks.clear();
  }

  return {
    root,
    update,
    setVisible,
    isVisible: () => visible,
    dispose,
  };
}

/**
 * 一个角度标记 = 一条折线（参考边 + 弧 + 目标边）+ 一个度数标签。
 * @param {import('./ikSolver.js').AngleArc} arc
 * @param {THREE.Group} root
 */
function createMark(arc, root) {
  const color = GROUP_COLORS[arc.group] ?? FALLBACK_COLOR;

  // 折线点数：参考边端点 + 弧上 (ARC_SEGMENTS + 1) 点 + 目标边端点
  const pointCount = ARC_SEGMENTS + 3;
  const positions = new Float32Array(pointCount * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  line.name = `AngleArc:${arc.id}`;
  line.renderOrder = 998;
  line.frustumCulled = false;
  line.visible = false;
  root.add(line);

  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.name = `AngleLabel:${arc.id}`;
  sprite.renderOrder = 999;
  sprite.scale.set(
    LABEL_WIDTH,
    (LABEL_WIDTH * LABEL_CANVAS_HEIGHT) / LABEL_CANVAS_WIDTH,
    1,
  );
  sprite.visible = false;
  root.add(sprite);

  return {
    line,
    positions,
    sprite,
    canvas,
    ctx,
    texture,
    cssColor: `#${color.toString(16).padStart(6, '0')}`,
    text: '',
  };
}

/**
 * @param {ReturnType<typeof createMark>} mark
 * @param {import('./ikSolver.js').AngleArc} arc
 * @param {number} radius
 * @returns {boolean} 是否画出（角度过小或退化时返回 false）
 */
function drawArc(mark, arc, radius) {
  if (!(arc.deg >= MIN_VISIBLE_DEG)) return false;

  _axis.crossVectors(arc.refDir, arc.targetDir);
  if (_axis.lengthSq() < 1e-10) return false;
  _axis.normalize();

  const theta = arc.deg * DEG2RAD;
  const { positions } = mark;

  // 起点：参考边伸出弧外的一段，读起来像「从这条边量起」
  writePoint(positions, 0, arc.vertex, arc.refDir, radius * RAY_SCALE);

  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    _quat.setFromAxisAngle(_axis, (theta * i) / ARC_SEGMENTS);
    _point.copy(arc.refDir).applyQuaternion(_quat);
    writePoint(positions, i + 1, arc.vertex, _point, radius);
  }

  writePoint(
    positions,
    ARC_SEGMENTS + 2,
    arc.vertex,
    arc.targetDir,
    radius * RAY_SCALE,
  );

  mark.line.geometry.attributes.position.needsUpdate = true;
  mark.line.geometry.computeBoundingSphere();
  mark.line.visible = true;

  // 标签摆在角平分线外侧，避免压住弧和骨架线
  _bisector.copy(arc.refDir).add(arc.targetDir);
  if (_bisector.lengthSq() < 1e-10) _bisector.copy(arc.targetDir);
  _bisector.normalize();
  mark.sprite.position
    .copy(arc.vertex)
    .addScaledVector(_bisector, radius * 2.1);
  mark.sprite.visible = true;

  drawLabel(mark, `${arc.label} ${Math.round(arc.deg)}°`);
  return true;
}

/**
 * @param {Float32Array} positions
 * @param {number} index
 * @param {THREE.Vector3} origin
 * @param {THREE.Vector3} dir - 单位向量
 * @param {number} length
 */
function writePoint(positions, index, origin, dir, length) {
  const base = index * 3;
  positions[base] = origin.x + dir.x * length;
  positions[base + 1] = origin.y + dir.y * length;
  positions[base + 2] = origin.z + dir.z * length;
}

/**
 * 重绘度数文字。文案不变时直接跳过，避免每帧都重画 canvas 并上传纹理。
 * @param {ReturnType<typeof createMark>} mark
 * @param {string} text
 */
function drawLabel(mark, text) {
  if (mark.text === text) return;
  mark.text = text;

  const { ctx, canvas } = mark;
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(13, 17, 23, 0.9)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = mark.cssColor;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  mark.texture.needsUpdate = true;
}

/** @param {ReturnType<typeof createMark>} mark */
function hideMark(mark) {
  mark.line.visible = false;
  mark.sprite.visible = false;
}
