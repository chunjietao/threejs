/**
 * English: Highlights selected Mixamo bones in the 3D scene with world-space markers.
 * 中文：在 3D 场景中用标记点高亮选中的骨骼位置，并随动画每帧跟随更新。
 */
import * as THREE from 'three';

const MARKER_COLOR = 0x3dd68c;
const MARKER_COLOR_ACTIVE = 0x6aa8ff;
const MARKER_RADIUS = 0.035;

/**
 * @param {THREE.Scene} scene
 * @param {import('three').Bone[]} bones
 */
export function createBoneHighlighter(scene, bones) {
  /** @type {Map<string, import('three').Bone>} */
  const boneByName = new Map();
  for (const bone of bones) {
    boneByName.set(bone.name || '(unnamed)', bone);
  }

  const root = new THREE.Group();
  root.name = 'BoneHighlights';
  scene.add(root);

  /** @type {Map<string, { mesh: THREE.Mesh, bone: import('three').Bone }>} */
  const markers = new Map();
  /** @type {Set<string>} */
  const visibleNames = new Set();
  /** @type {string | null} */
  let activeName = null;

  const geometry = new THREE.SphereGeometry(MARKER_RADIUS, 16, 16);
  const worldPos = new THREE.Vector3();

  /**
   * @param {string} boneName
   */
  function ensureMarker(boneName) {
    let entry = markers.get(boneName);
    if (entry) return entry;

    const bone = boneByName.get(boneName);
    if (!bone) return null;

    const material = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `BoneHighlight:${boneName}`;
    mesh.renderOrder = 999;
    mesh.visible = false;
    root.add(mesh);

    entry = { mesh, bone };
    markers.set(boneName, entry);
    return entry;
  }

  function refreshVisibility() {
    for (const [name, entry] of markers) {
      const show = visibleNames.has(name);
      entry.mesh.visible = show;
      const material = /** @type {THREE.MeshBasicMaterial} */ (entry.mesh.material);
      material.color.setHex(name === activeName ? MARKER_COLOR_ACTIVE : MARKER_COLOR);
      entry.mesh.scale.setScalar(name === activeName ? 1.35 : 1);
    }
  }

  /**
   * 选中骨骼：列表高亮对应；默认打开该骨骼的 3D 标记显示。
   * @param {string | null} boneName
   */
  function setActive(boneName) {
    activeName = boneName;
    if (boneName) {
      ensureMarker(boneName);
      visibleNames.add(boneName);
    }
    refreshVisibility();
  }

  /**
   * 眼睛按钮：单独控制某块骨骼标记是否显示。
   * @param {string} boneName
   * @param {boolean} visible
   */
  function setVisible(boneName, visible) {
    if (visible) {
      ensureMarker(boneName);
      visibleNames.add(boneName);
    } else {
      visibleNames.delete(boneName);
    }
    refreshVisibility();
  }

  /** @param {string} boneName */
  function isVisible(boneName) {
    return visibleNames.has(boneName);
  }

  /** @param {string} boneName */
  function toggleVisible(boneName) {
    const next = !visibleNames.has(boneName);
    setVisible(boneName, next);
    return next;
  }

  /** 关闭全部 3D 高亮标记并取消当前选中 */
  function clearAll() {
    visibleNames.clear();
    activeName = null;
    refreshVisibility();
  }

  /** @returns {string[]} */
  function getVisibleNames() {
    return [...visibleNames];
  }

  /** 每帧把标记同步到骨骼世界坐标 */
  function update() {
    for (const name of visibleNames) {
      const entry = markers.get(name);
      if (!entry || !entry.mesh.visible) continue;
      entry.bone.getWorldPosition(worldPos);
      entry.mesh.position.copy(worldPos);
    }
  }

  function dispose() {
    scene.remove(root);
    geometry.dispose();
    for (const { mesh } of markers.values()) {
      mesh.material.dispose();
    }
    markers.clear();
    visibleNames.clear();
  }

  return {
    setActive,
    setVisible,
    toggleVisible,
    isVisible,
    clearAll,
    getVisibleNames,
    getActive: () => activeName,
    update,
    dispose,
  };
}
