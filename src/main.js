/**
 * English: Application entry — builds the Three.js scene and render loop.
 * 中文：应用入口 —— 搭建 Three.js 场景与渲染循环；模型加载与动画控制交给独立模块。
 *
 * 【目录约定（方便以后扩展）】
 * - src/main.js                          → 入口：场景 / 相机 / 灯光 / 循环
 * - src/models/loadXbot.js               → 功能：加载 Xbot 模型
 * - src/features/animationController.js  → 功能：切换 / 暂停 / 调速动画
 * - src/ui/animationPanel.js             → UI：动画控制面板
 * - src/ui/bonePanel.js                  → UI：骨骼名称列表
 * - src/data/loadSwingPose3D.js          → 数据：解码 .pb（本地文件 / 示例文件）
 * - src/ui/filePanel.js                  → UI：pb 文件选择条
 * - src/ui/jsonTreePanel.js              → UI：可折叠 JSON 树
 * - src/ui/jointPanel.js                 → UI：关节列表（含骨骼映射）
 * - src/features/jointBoneMap.js         → 功能：关节↔骨骼映射
 * - src/features/jointBoneMapStorage.js  → 功能：映射 JSON 持久化 / 导入导出
 * - src/features/boneHighlighter.js      → 功能：骨骼位置 3D 高亮标记
 * - src/data/sanitizePose3D.js           → 数据：pb 关节轨迹清洗（剔坏帧 / 补洞 / 人体约束）
 * - src/data/mirrorPose3D.js             → 数据：pb 左手系（镜像）判定与消除
 * - src/features/poseDriver.js           → 功能：pb 关节方向 → Mixamo 骨骼朝向驱动
 * - src/features/golfGrip.js             → 功能：手指骨骼写成高尔夫重叠握杆姿势
 * - src/features/club.js                 → 功能：用 pb 三关节画出高尔夫球杆
 * - src/features/stickman.js             → 功能：用 pb 关节画火柴人（X 轴旁置）
 * - src/features/ikSolver.js             → 功能：逆向运动学，pb 关节位置 → 关节角度
 * - src/features/angleOverlay.js         → 功能：关节角度以弧线 + 度数画在火柴人上
 * - src/features/posePlayback.js         → 功能：姿势帧播放 / 循环 / scrub
 * - src/ui/posePanel.js                  → UI：播放按钮 + 滑条 + 帧号 + 距离 + 关节名/角度开关
 *
 * 【初学者学习路线】请按下面「第 1 步 → 第 9 步」顺序阅读本文件。
 * Three.js 最核心的思路只有一句话：
 *   场景(Scene) + 相机(Camera) + 渲染器(Renderer) → 每帧画一张图。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../style.css';
import {
  loadSwingPose3D,
  loadSwingPose3DFromFile,
  SAMPLE_PB_NAME,
} from './data/loadSwingPose3D.js';
import { createAngleOverlay } from './features/angleOverlay.js';
import { createAnimationController } from './features/animationController.js';
import { createBoneHighlighter } from './features/boneHighlighter.js';
import { createClub } from './features/club.js';
import { createIKSolver, solvePoseAngles } from './features/ikSolver.js';
import { createJointBoneMap } from './features/jointBoneMap.js';
import {
  loadMappingFromStorage,
  saveMappingToStorage,
} from './features/jointBoneMapStorage.js';
import { createPoseDriver } from './features/poseDriver.js';
import { createPosePlayback } from './features/posePlayback.js';
import { createStickman } from './features/stickman.js';
import { loadXbot, restoreBindPose } from './models/loadXbot.js';
import { createAnimationPanel } from './ui/animationPanel.js';
import { collectBones, createBonePanel } from './ui/bonePanel.js';
import { createFilePanel } from './ui/filePanel.js';
import { createJointPanel } from './ui/jointPanel.js';
import { createJsonTreePanel } from './ui/jsonTreePanel.js';
import { createPosePanel } from './ui/posePanel.js';

// ============================================================
// 第 1 步：拿到页面里的 DOM 节点
// - #app：用来挂载 Three.js 画出来的 <canvas>
// - .loading：加载模型时显示进度提示
// ============================================================
const app = document.querySelector('#app');
const loading = document.querySelector('.loading');

// ============================================================
// 第 2 步：创建「场景」Scene
// 场景 = 一个虚拟的 3D 世界容器，后面灯光、地面、模型都要放进去。
// ============================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117); // 背景色（深色）
scene.fog = new THREE.Fog(0x0d1117, 8, 18); // 雾效：远处物体逐渐融入背景

// ============================================================
// 第 3 步：创建「相机」Camera
// 相机 = 观察者的眼睛。没有相机就看不到场景。
//
// PerspectiveCamera 参数含义：
//   1) fov（视野角度）45：数值越大，看到的范围越广（像广角镜头）
//   2) aspect（宽高比）：一般用 窗口宽 / 窗口高
//   3) near（近裁剪面）0.1：比这个更近的物体不画
//   4) far（远裁剪面）100：比这个更远的物体不画
// ============================================================
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
// 把相机放到空间中的某个位置（x, y, z）
camera.position.set(3, 1.8, 5);

// ============================================================
// 第 4 步：创建「渲染器」Renderer
// 渲染器负责把 3D 场景真正画到网页的 <canvas> 上。
// antialias: true 可以让边缘更平滑。
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 适配高清屏，但上限 2 以免太卡
renderer.setSize(window.innerWidth, window.innerHeight); // 画布尺寸 = 窗口尺寸
renderer.shadowMap.enabled = true; // 开启阴影
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 软阴影，看起来更自然
renderer.outputColorSpace = THREE.SRGBColorSpace; // 正确的颜色空间
renderer.toneMapping = THREE.ACESFilmicToneMapping; // 电影感色调映射
renderer.toneMappingExposure = 1.1; // 曝光（亮度）微调
app.prepend(renderer.domElement); // 把 canvas 插入页面

// ============================================================
// 第 5 步：添加「轨道控制器」OrbitControls
// 让用户可以用鼠标：拖动旋转、滚轮缩放、右键平移。
// ============================================================
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // 阻尼：松手后有一点惯性，更跟手
controls.target.set(0, 1, 0); // 相机围绕的目标点（角色胸口附近）
controls.minDistance = 2; // 最近距离
controls.maxDistance = 10; // 最远距离
controls.maxPolarAngle = Math.PI / 2 - 0.03; // 限制仰角，避免钻到地下

// ============================================================
// 第 6 步：添加灯光
// 没有灯光时，很多材质会看起来一片黑。
// - HemisphereLight：天空/地面环境光，整体提亮
// - DirectionalLight：平行光，像太阳，可投射阴影
// ============================================================
scene.add(new THREE.HemisphereLight(0xc8ddff, 0x29323c, 2.5));

const keyLight = new THREE.DirectionalLight(0xffffff, 3); // 主光
keyLight.position.set(3, 6, 4);
keyLight.castShadow = true; // 这盏光要投射阴影
keyLight.shadow.mapSize.set(2048, 2048); // 阴影贴图分辨率（越大越清晰，也越耗性能）
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 20;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6aa8ff, 2); // 轮廓光，从背后勾边
rimLight.position.set(-4, 3, -3);
scene.add(rimLight);

// ============================================================
// 第 7 步：创建地面
// Mesh = 几何体 Geometry（形状） + 材质 Material（外观）
// ============================================================
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(5, 96), // 半径 5 的圆盘
  new THREE.MeshStandardMaterial({
    color: 0x151c25,
    roughness: 0.85, // 粗糙度：越高越哑光
    metalness: 0.05, // 金属度：越高越像金属
  }),
);
floor.rotation.x = -Math.PI / 2; // 默认圆盘是立着的，旋转后平铺在地面
floor.receiveShadow = true; // 地面接收阴影
scene.add(floor);

// ============================================================
// 第 8 步：加载模型 → 创建动画控制器 → 挂上动画面板
// Clock 用来计算帧间隔；动画由 animationController 统一推进。
// ============================================================
const clock = new THREE.Clock();
/** @type {ReturnType<typeof createAnimationController> | null} */
let animController = null;
/** @type {ReturnType<typeof createJointBoneMap> | null} */
let jointBoneMap = null;
/** @type {ReturnType<typeof createBoneHighlighter> | null} */
let boneHighlighter = null;
/** @type {ReturnType<typeof createPoseDriver> | null} */
let poseDriver = null;
/** @type {ReturnType<typeof createPosePlayback> | null} */
let posePlayback = null;
/** @type {ReturnType<typeof createClub> | null} */
let club = null;
/** @type {ReturnType<typeof createStickman> | null} */
let stickman = null;
/** @type {ReturnType<typeof createIKSolver> | null} */
let ikSolver = null;
/** @type {ReturnType<typeof createAngleOverlay> | null} */
let stickmanAngleOverlay = null;
/** @type {ReturnType<typeof createAngleOverlay> | null} */
let glbAngleOverlay = null;
/** @type {ReturnType<typeof createJsonTreePanel> | null} */
let jsonPanel = null;
/** @type {ReturnType<typeof createPosePanel> | null} */
let posePanel = null;
/** @type {ReturnType<typeof createBonePanel> | null} */
let bonePanel = null;
/** @type {ReturnType<typeof createJointPanel> | null} */
let jointPanel = null;
/** pb 姿势驱动开启时，跳过 mixer 更新以免覆盖骨骼 */
let poseDriveActive = false;

const xbotReady = loadXbot(scene, {
  onProgress(percent) {
    loading.textContent = `正在加载 Xbot... ${percent}%`;
  },
}).then(({ model, mixer, animations, bindPose }) => {
  loading.remove();

  const bones = collectBones(model);
  console.log(
    '骨骼列表：',
    bones.map((bone) => bone.name || '(unnamed)'),
  );

  if (mixer && animations.length > 0) {
    animController = createAnimationController(mixer, animations);
    createAnimationPanel(app, animController);
  } else {
    console.warn('模型没有可用动画。');
  }

  return { model, bones, bindPose };
});

xbotReady.catch((error) => {
  console.error('模型加载失败：', error);
  if (loading.isConnected) {
    loading.textContent = '加载失败，请检查控制台。';
    loading.classList.add('error');
  }
});

// ============================================================
// 第 8.5 步：pb 文件由用户选择（不再默认加载）
// 选择后 → 解码 → 重建姿势相关面板与 3D 对象；可随时换文件重来。
// ============================================================
const filePanel = createFilePanel(app, {
  onPickFile(file) {
    loadPose(file.name, () => loadSwingPose3DFromFile(file));
  },
  onPickSample() {
    loadPose(SAMPLE_PB_NAME, () => loadSwingPose3D());
  },
});

/** 每次选择自增，用于忽略过期请求的返回结果 */
let poseRequestId = 0;

/**
 * @param {string} label - 展示用文件名
 * @param {() => Promise<{ data: object, joints: string[] }>} load
 */
async function loadPose(label, load) {
  const requestId = ++poseRequestId;
  filePanel.setBusy(true);
  filePanel.setStatus(`正在解析 ${label}…`, 'loading');

  try {
    const xbot = await xbotReady;
    const { data, joints } = await load();
    if (requestId !== poseRequestId) return; // 已有更新的选择，丢弃本次结果

    teardownPose();
    setupPose(xbot, { data, joints });

    const frameCount = data.frames?.length ?? 0;
    filePanel.setStatus(
      `${label} · ${frameCount} 帧 · ${joints.length} 关节`,
      'ok',
    );
  } catch (error) {
    console.error(`加载 ${label} 失败：`, error);
    if (requestId === poseRequestId) {
      filePanel.setStatus(`${label} 加载失败：${error.message}`, 'error');
    }
  } finally {
    if (requestId === poseRequestId) filePanel.setBusy(false);
  }
}

/** 清掉上一份 pb 带来的面板与 3D 对象，便于切换文件 */
function teardownPose() {
  posePlayback?.pause();
  poseDriveActive = false;

  stickmanAngleOverlay?.dispose();
  glbAngleOverlay?.dispose();
  club?.dispose();
  stickman?.dispose();
  boneHighlighter?.dispose();

  jsonPanel?.element.remove();
  posePanel?.element.remove();
  bonePanel?.element.remove();
  jointPanel?.element.remove();

  stickmanAngleOverlay = null;
  glbAngleOverlay = null;
  club = null;
  stickman = null;
  boneHighlighter = null;
  poseDriver = null;
  posePlayback = null;
  ikSolver = null;
  jointBoneMap = null;
  jsonPanel = null;
  posePanel = null;
  bonePanel = null;
  jointPanel = null;
}

/**
 * 模型骨骼 + pb 关节都就绪后：映射联动 + pb 姿势驱动
 * @param {{ model: import('three').Object3D, bones: import('three').Bone[], bindPose: unknown }} xbot
 * @param {{ data: object, joints: string[] }} pose
 */
function setupPose({ model, bones, bindPose }, { data, joints }) {
  const frameCount = data.frames?.length ?? 0;
  jsonPanel = createJsonTreePanel(app, {
    title: `SwingPose3D（${frameCount} frames · ${joints.length} joints）`,
    data,
    defaultExpandDepth: 1,
  });
  console.log('SwingPose3D joints：', joints);
  console.log('SwingPose3D 已加载：', data);

  const boneNames = bones.map((bone) => bone.name || '(unnamed)');
  const savedMap = loadMappingFromStorage();
  jointBoneMap = createJointBoneMap({
    joints,
    boneNames,
    savedMap,
  });
  boneHighlighter = createBoneHighlighter(scene, bones);

  // pb 驱动：停掉内置 GLB 动画，避免 mixer 覆盖骨骼
  if (animController) {
    animController.switchBaseAction('None', 0);
    for (const name of animController.additiveNames) {
      animController.setAdditiveWeight(name, 0);
    }
    animController.setPaused(true);
  }
  // 恢复加载时的 bind（勿用 skeleton.pose：Armature 缩放会导致骨骼崩溃）
  restoreBindPose(bindPose, model);

  poseDriver = createPoseDriver({
    model,
    bones,
    data,
    mapping: jointBoneMap,
  });
  const jointPos = (name) => poseDriver?.getJointPosition(name) ?? null;
  club = createClub(scene, { getJointPosition: jointPos });
  stickman = createStickman(scene, { getJointPosition: jointPos });
  posePlayback = createPosePlayback({ data, driver: poseDriver });

  // 逆向运动学：整段序列一次性解算好角度；实时弧线则按当前帧的模型空间坐标现算，
  // 这样弧的顶点与火柴人骨架严格重合（角度本身不受刚体变换与缩放影响）。
  ikSolver = createIKSolver({ data });
  stickmanAngleOverlay = createAngleOverlay(stickman.root, {
    solve: () => solvePoseAngles(jointPos),
    name: 'StickmanAngleOverlay',
  });
  glbAngleOverlay = createAngleOverlay(scene, {
    solve: () => poseDriver.getModelAngleGeometry(),
    name: 'GlbAngleOverlay',
    radius: 0.085,
  });

  club.update();
  stickman.update();
  stickmanAngleOverlay.update();
  glbAngleOverlay.update();
  posePanel = createPosePanel(app, posePlayback, {
    offsetX: stickman.getOffsetX(),
    onOffsetXChange(x) {
      stickman?.setOffsetX(x);
    },
    labelsVisible: stickman.isLabelVisible(),
    onLabelsVisibleChange(show) {
      stickman?.setLabelVisible(show);
      if (show) stickman?.update();
    },
    anglesVisible: stickmanAngleOverlay.isVisible(),
    onAnglesVisibleChange(show) {
      stickmanAngleOverlay?.setVisible(show);
      glbAngleOverlay?.setVisible(show);
      if (show) {
        stickmanAngleOverlay?.update();
        glbAngleOverlay?.update();
      }
    },
  });
  poseDriveActive = true;

  /** @type {string | null} */
  let activeJoint = null;
  /** @type {string | null} */
  let activeBone = null;

  /** @param {{ joint: string | null, bone: string | null }} selection */
  function focusPair({ joint, bone }) {
    activeJoint = joint;
    activeBone = bone;
    jointPanel?.setActive(joint);
    bonePanel?.setActive(bone);
    if (bone) {
      boneHighlighter?.setActive(bone);
      bonePanel?.setEyeVisible(bone, true);
    }
  }

  /** 再次点击同一项时取消高亮 */
  function unfocusBone(boneName) {
    if (boneName) {
      boneHighlighter?.setVisible(boneName, false);
      bonePanel?.setEyeVisible(boneName, false);
    }
    if (boneHighlighter?.getActive() === boneName) {
      boneHighlighter?.setActive(null);
    }
    activeJoint = null;
    activeBone = null;
    bonePanel?.setActive(null);
    jointPanel?.setActive(null);
  }

  function syncLinkedHighlights(snapshot = jointBoneMap.getSnapshot()) {
    jointPanel?.setLinked(snapshot.paired.map((pair) => pair.joint));
    bonePanel?.setLinked(
      snapshot.paired.map((pair) => pair.bone).filter(Boolean),
    );
    bonePanel?.setMappedJoints(snapshot.paired);
    // 每次变更自动写成 JSON 存到 localStorage，刷新后直接恢复
    saveMappingToStorage(snapshot.map);
  }

  bonePanel = createBonePanel(app, bones, {
    isVisible: (boneName) => boneHighlighter?.isVisible(boneName) ?? false,
    onSelect(boneName) {
      if (activeBone === boneName && boneHighlighter?.isVisible(boneName)) {
        unfocusBone(boneName);
        return;
      }
      const joint = jointBoneMap.getJointForBone(boneName);
      focusPair({ joint, bone: boneName });
    },
    onToggleVisible(boneName, visible) {
      boneHighlighter?.setVisible(boneName, visible);
      if (visible) {
        const joint = jointBoneMap.getJointForBone(boneName);
        focusPair({ joint, bone: boneName });
      } else if (activeBone === boneName) {
        activeJoint = null;
        activeBone = null;
        boneHighlighter?.setActive(null);
        bonePanel?.setActive(null);
        jointPanel?.setActive(null);
      }
    },
    onClearHighlights() {
      boneHighlighter?.clearAll();
      bonePanel?.clearAllEyes();
      activeJoint = null;
      activeBone = null;
      jointPanel?.setActive(null);
    },
  });

  jointPanel = createJointPanel(app, joints, {
    mapping: jointBoneMap,
    onSelect(jointName) {
      const bone = jointBoneMap.getBoneForJoint(jointName) ?? null;
      if (activeJoint === jointName) {
        unfocusBone(bone);
        return;
      }
      focusPair({ joint: jointName, bone });
    },
  });

  jointBoneMap.subscribe((snapshot) => {
    syncLinkedHighlights(snapshot);
    poseDriver?.onMappingChanged();
    if (posePlayback) {
      poseDriver?.applyFrame(posePlayback.getFrameIndex());
    }
  });
  syncLinkedHighlights();

  console.log(
    savedMap ? '已从本地 JSON 恢复关节↔骨骼映射：' : '关节↔骨骼映射（默认）：',
    jointBoneMap.getSnapshot(),
  );
  console.log('PB 姿势驱动已启用，address 帧：', poseDriver.addressIndex);
  console.log('PB 数据清洗结果：', poseDriver.sanitizeReport);
  console.log('IK 关节角度定义：', ikSolver.definitions);
  console.log(
    'IK 关节角度（address 帧，单位：度）：',
    ikSolver.getFrameAngles(poseDriver.addressIndex),
  );
}

// ============================================================
// 第 9 步：渲染循环 + 窗口自适应
// requestAnimationFrame 会在浏览器准备好下一帧时再次调用 animate。
// 这就是「游戏循环 / 动画循环」：每帧更新 → 再画一帧。
// ============================================================
function animate() {
  requestAnimationFrame(animate); // 预约下一帧
  const delta = clock.getDelta();
  if (poseDriveActive) {
    // pb 驱动时不跑 mixer，避免覆盖骨骼变换
    posePlayback?.update(delta);
    club?.update(); // 球杆三点跟随当前 pb 帧
    stickman?.update(); // 火柴人与 GLB 同帧，仅 X 偏移
    stickmanAngleOverlay?.update(); // 火柴人关节角度
    glbAngleOverlay?.update(); // GLB 真实骨骼位置上的同一组关节角度
  } else {
    animController?.update(delta);
  }
  boneHighlighter?.update(); // 骨骼高亮点跟随骨骼世界坐标
  controls.update(); // 阻尼控制器需要每帧更新
  renderer.render(scene, camera); // ★ 真正把场景画出来
}

// 窗口大小变化时，相机宽高比和画布尺寸要一起改，否则画面会拉伸变形
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix(); // 改完 aspect 后必须调用
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', resize);
animate(); // 启动渲染循环
