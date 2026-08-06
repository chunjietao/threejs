/**
 * English: Draws the golf club from three SwingPose3D joints (handle tip, shaft tip, head toe).
 * 中文：用 pb 的三个球杆关节（握把端、杆身尖端、杆头趾部）在场景里画出高尔夫球杆。
 *
 * 三点语义（与 protobuf JointName 一致）：
 * - golf_club_shaft_handle_tip → 握把末端（杆身顶端）
 * - golf_shaft_tip             → 杆身尖端（靠近杆头）
 * - club_head_toe              → 杆头趾部
 *
 * 连线顺序：握把 → 杆身尖端 → 杆头趾部，近似「杆身 + 杆头」折线。
 */
import * as THREE from 'three';

/** 握把端 → 杆身尖端 → 杆头趾部 */
export const CLUB_JOINTS = Object.freeze([
  'golf_club_shaft_handle_tip',
  'golf_shaft_tip',
  'club_head_toe',
]);

const POINT_RADIUS = 0.028;

/** 球杆三点在 3D 与关节列表中共用的颜色（hex number） */
export const CLUB_JOINT_COLORS = Object.freeze({
  golf_club_shaft_handle_tip: 0xf0c14b,
  golf_shaft_tip: 0x5ec8ff,
  club_head_toe: 0xff6b6b,
});

/** @param {number} hex */
export function clubColorCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

const POINT_COLORS = CLUB_JOINT_COLORS;
const SHAFT_COLOR = 0xd8dee9;
const HEAD_COLOR = 0xc0c8d4;

/**
 * @param {THREE.Scene} scene
 * @param {object} [options]
 * @param {(name: string) => THREE.Vector3 | null} [options.getJointPosition]
 */
export function createClub(scene, options = {}) {
  /** @type {(name: string) => THREE.Vector3 | null} */
  let getJointPosition = options.getJointPosition ?? (() => null);

  const root = new THREE.Group();
  root.name = 'GolfClub';
  scene.add(root);

  const sphereGeo = new THREE.SphereGeometry(POINT_RADIUS, 16, 16);

  /** @type {Map<string, THREE.Mesh>} */
  const markers = new Map();
  for (const name of CLUB_JOINTS) {
    const mat = new THREE.MeshBasicMaterial({
      color: POINT_COLORS[name],
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.name = `ClubPoint:${name}`;
    mesh.renderOrder = 998;
    mesh.visible = false;
    root.add(mesh);
    markers.set(name, mesh);
  }

  // 杆身：握把 → 杆身尖端
  const shaftPositions = new Float32Array(6);
  const shaftGeo = new THREE.BufferGeometry();
  shaftGeo.setAttribute('position', new THREE.BufferAttribute(shaftPositions, 3));
  const shaftLine = new THREE.Line(
    shaftGeo,
    new THREE.LineBasicMaterial({
      color: SHAFT_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  shaftLine.name = 'ClubShaft';
  shaftLine.renderOrder = 997;
  shaftLine.visible = false;
  root.add(shaftLine);

  // 杆头：杆身尖端 → 杆头趾部
  const headPositions = new Float32Array(6);
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(headPositions, 3));
  const headLine = new THREE.Line(
    headGeo,
    new THREE.LineBasicMaterial({
      color: HEAD_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  headLine.name = 'ClubHead';
  headLine.renderOrder = 997;
  headLine.visible = false;
  root.add(headLine);

  let visible = true;

  /**
   * @param {(name: string) => THREE.Vector3 | null} fn
   */
  function setJointGetter(fn) {
    getJointPosition = fn;
  }

  /**
   * @param {Float32Array} arr
   * @param {THREE.Vector3} a
   * @param {THREE.Vector3} b
   * @param {THREE.BufferGeometry} geo
   */
  function writeSegment(arr, a, b, geo) {
    arr[0] = a.x;
    arr[1] = a.y;
    arr[2] = a.z;
    arr[3] = b.x;
    arr[4] = b.y;
    arr[5] = b.z;
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /** 按当前帧关节位置刷新球杆可视化 */
  function update() {
    if (!visible) {
      for (const mesh of markers.values()) mesh.visible = false;
      shaftLine.visible = false;
      headLine.visible = false;
      return;
    }

    /** @type {(THREE.Vector3 | null)[]} */
    const pts = CLUB_JOINTS.map((name) => getJointPosition(name));

    for (let i = 0; i < CLUB_JOINTS.length; i++) {
      const mesh = markers.get(CLUB_JOINTS[i]);
      const p = pts[i];
      if (!mesh) continue;
      if (p) {
        mesh.position.copy(p);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }

    const [handle, tip, toe] = pts;
    if (handle && tip) {
      writeSegment(shaftPositions, handle, tip, shaftGeo);
      shaftLine.visible = true;
    } else {
      shaftLine.visible = false;
    }

    if (tip && toe) {
      writeSegment(headPositions, tip, toe, headGeo);
      headLine.visible = true;
    } else {
      headLine.visible = false;
    }
  }

  /** @param {boolean} show */
  function setVisible(show) {
    visible = show;
    if (!show) {
      for (const mesh of markers.values()) mesh.visible = false;
      shaftLine.visible = false;
      headLine.visible = false;
    }
  }

  function dispose() {
    scene.remove(root);
    sphereGeo.dispose();
    shaftGeo.dispose();
    headGeo.dispose();
    for (const mesh of markers.values()) {
      mesh.material.dispose();
    }
    shaftLine.material.dispose();
    headLine.material.dispose();
    markers.clear();
  }

  return {
    root,
    update,
    setVisible,
    setJointGetter,
    isVisible: () => visible,
    dispose,
  };
}
