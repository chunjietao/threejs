/**
 * English: Draws a Three.js stick figure from SwingPose3D joints beside the GLB model.
 * 中文：用 pb 关节在 GLB 角色旁画 Three.js 火柴人；与模型共用对齐后的坐标，仅在 X 轴拉开距离。
 *
 * 关节位置来自 poseDriver.getJointPosition（已镜像 / 缩放 / 偏航 / 贴地），
 * 因此火柴人与 GLB 在 Y、Z 上保持一致，只通过 Group 的 X 偏移并排显示。
 */
import * as THREE from 'three';

/** 人体骨架连线（火柴人主体） */
const BODY_EDGES = Object.freeze([
  ['left_ear', 'nose'],
  ['right_ear', 'nose'],
  ['left_ear', 'right_ear'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]);

/** 球杆折线（与 club.js 三点一致） */
const CLUB_EDGES = Object.freeze([
  ['golf_club_shaft_handle_tip', 'golf_shaft_tip'],
  ['golf_shaft_tip', 'club_head_toe'],
]);

const ALL_EDGES = Object.freeze([...BODY_EDGES, ...CLUB_EDGES]);

const BODY_JOINTS = Object.freeze([
  'nose',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
]);

const CLUB_JOINTS = Object.freeze([
  'golf_club_shaft_handle_tip',
  'golf_shaft_tip',
  'club_head_toe',
]);

const DEFAULT_OFFSET_X = 1.5;
const JOINT_RADIUS = 0.022;
const BODY_LINE_COLOR = 0x7dd3fc;
const CLUB_LINE_COLOR = 0xf0c14b;
const BODY_JOINT_COLOR = 0xe2e8f0;
const CLUB_JOINT_COLOR = 0xff9f43;

/**
 * @param {THREE.Scene} scene
 * @param {object} [options]
 * @param {(name: string) => THREE.Vector3 | null} [options.getJointPosition]
 * @param {number} [options.offsetX] - 相对 GLB 的 X 轴距离（米）
 */
export function createStickman(scene, options = {}) {
  /** @type {(name: string) => THREE.Vector3 | null} */
  let getJointPosition = options.getJointPosition ?? (() => null);
  let offsetX =
    typeof options.offsetX === 'number' && Number.isFinite(options.offsetX)
      ? options.offsetX
      : DEFAULT_OFFSET_X;

  const root = new THREE.Group();
  root.name = 'Stickman';
  root.position.x = offsetX;
  scene.add(root);

  const jointGeo = new THREE.SphereGeometry(JOINT_RADIUS, 12, 12);

  /** @type {Map<string, THREE.Mesh>} */
  const markers = new Map();
  for (const name of BODY_JOINTS) {
    markers.set(name, makeMarker(name, BODY_JOINT_COLOR, jointGeo, root));
  }
  for (const name of CLUB_JOINTS) {
    markers.set(name, makeMarker(name, CLUB_JOINT_COLOR, jointGeo, root));
  }

  const edgeCount = ALL_EDGES.length;
  const linePositions = new Float32Array(edgeCount * 2 * 3);
  const lineColors = new Float32Array(edgeCount * 2 * 3);
  for (let i = 0; i < edgeCount; i++) {
    const [a, b] = ALL_EDGES[i];
    const isClub = CLUB_JOINTS.includes(a) || CLUB_JOINTS.includes(b);
    const color = new THREE.Color(isClub ? CLUB_LINE_COLOR : BODY_LINE_COLOR);
    const base = i * 6;
    lineColors[base] = color.r;
    lineColors[base + 1] = color.g;
    lineColors[base + 2] = color.b;
    lineColors[base + 3] = color.r;
    lineColors[base + 4] = color.g;
    lineColors[base + 5] = color.b;
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
  const lines = new THREE.LineSegments(
    lineGeo,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    }),
  );
  lines.name = 'StickmanBones';
  lines.renderOrder = 996;
  lines.frustumCulled = false;
  root.add(lines);

  let visible = true;

  /**
   * @param {(name: string) => THREE.Vector3 | null} fn
   */
  function setJointGetter(fn) {
    getJointPosition = fn;
  }

  /** @param {number} x */
  function setOffsetX(x) {
    if (!Number.isFinite(x)) return;
    offsetX = x;
    root.position.x = offsetX;
  }

  function getOffsetX() {
    return offsetX;
  }

  /** 按当前帧关节刷新火柴人（位置与 GLB 同源，仅 root.x 偏移） */
  function update() {
    if (!visible) {
      for (const mesh of markers.values()) mesh.visible = false;
      lines.visible = false;
      return;
    }

    /** @type {Map<string, THREE.Vector3 | null>} */
    const pts = new Map();
    for (const name of markers.keys()) {
      pts.set(name, getJointPosition(name));
    }

    for (const [name, mesh] of markers) {
      const p = pts.get(name);
      if (p) {
        mesh.position.copy(p);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }

    let anyEdge = false;
    for (let i = 0; i < edgeCount; i++) {
      const [aName, bName] = ALL_EDGES[i];
      const a = pts.get(aName);
      const b = pts.get(bName);
      const base = i * 6;
      if (a && b) {
        linePositions[base] = a.x;
        linePositions[base + 1] = a.y;
        linePositions[base + 2] = a.z;
        linePositions[base + 3] = b.x;
        linePositions[base + 4] = b.y;
        linePositions[base + 5] = b.z;
        anyEdge = true;
      } else {
        // 缺关节时把线段缩成零长度，避免残留旧帧
        linePositions[base] = 0;
        linePositions[base + 1] = 0;
        linePositions[base + 2] = 0;
        linePositions[base + 3] = 0;
        linePositions[base + 4] = 0;
        linePositions[base + 5] = 0;
      }
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.computeBoundingSphere();
    lines.visible = anyEdge;
  }

  /** @param {boolean} show */
  function setVisible(show) {
    visible = show;
    if (!show) {
      for (const mesh of markers.values()) mesh.visible = false;
      lines.visible = false;
    }
  }

  function dispose() {
    scene.remove(root);
    jointGeo.dispose();
    lineGeo.dispose();
    lines.material.dispose();
    for (const mesh of markers.values()) {
      mesh.material.dispose();
    }
    markers.clear();
  }

  return {
    root,
    update,
    setOffsetX,
    getOffsetX,
    setVisible,
    setJointGetter,
    isVisible: () => visible,
    dispose,
    DEFAULT_OFFSET_X,
  };
}

/**
 * @param {string} name
 * @param {number} color
 * @param {THREE.SphereGeometry} geo
 * @param {THREE.Group} parent
 */
function makeMarker(name, color, geo, parent) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `StickmanJoint:${name}`;
  mesh.renderOrder = 997;
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}
