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
 *
 * 【初学者学习路线】请按下面「第 1 步 → 第 9 步」顺序阅读本文件。
 * Three.js 最核心的思路只有一句话：
 *   场景(Scene) + 相机(Camera) + 渲染器(Renderer) → 每帧画一张图。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../style.css';
import { createAnimationController } from './features/animationController.js';
import { loadXbot } from './models/loadXbot.js';
import { createAnimationPanel } from './ui/animationPanel.js';
import { collectBones, createBonePanel } from './ui/bonePanel.js';

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

loadXbot(scene, {
  onProgress(percent) {
    loading.textContent = `正在加载 Xbot... ${percent}%`;
  },
})
  .then(({ model, mixer, animations }) => {
    loading.remove();

    // 收集并展示人物全部骨骼
    const bones = collectBones(model);
    createBonePanel(app, bones);
    console.log(
      '骨骼列表：',
      bones.map((bone) => bone.name || '(unnamed)'),
    );

    if (!mixer || animations.length === 0) {
      console.warn('模型没有可用动画。');
      return;
    }

    // 想知道模型自带哪些片段，可以打开这行看控制台
    // console.log(animations.map((clip) => clip.name));

    animController = createAnimationController(mixer, animations);
    createAnimationPanel(app, animController);
  })
  .catch((error) => {
    console.error('Xbot 模型加载失败：', error);
    loading.textContent = '模型加载失败，请检查控制台。';
    loading.classList.add('error');
  });

// ============================================================
// 第 9 步：渲染循环 + 窗口自适应
// requestAnimationFrame 会在浏览器准备好下一帧时再次调用 animate。
// 这就是「游戏循环 / 动画循环」：每帧更新 → 再画一帧。
// ============================================================
function animate() {
  requestAnimationFrame(animate); // 预约下一帧
  const delta = clock.getDelta();
  animController?.update(delta); // 推进当前动画
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
