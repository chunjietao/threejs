/**
 * English: Loads the Xbot GLB model, enables shadows, and starts its animation.
 * 中文：专门负责加载 Xbot GLB 模型、开启阴影并播放动画（与其它功能模块解耦）。
 *
 * 【为什么单独拆文件？】
 * - main.js 只管「场景怎么搭、怎么渲染」
 * - 本文件只管「Xbot 怎么加载」
 * - 以后加其它功能（比如姿态、UI、交互）可以再新建独立 js，互不混杂
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** 默认模型路径（相对网站根目录） */
const DEFAULT_URL = '/models/Xbot.glb';

/**
 * 加载 Xbot 模型并加入场景。
 *
 * @param {THREE.Scene} scene - 要放入模型的场景
 * @param {object} [options]
 * @param {string} [options.url] - 模型路径，默认 /models/Xbot.glb
 * @param {(percent: number) => void} [options.onProgress] - 加载进度 0~100
 * @returns {Promise<{ model: THREE.Group, mixer: THREE.AnimationMixer | null }>}
 */
export function loadXbot(scene, options = {}) {
  const { url = DEFAULT_URL, onProgress } = options;
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      // --- 加载成功 ---
      (gltf) => {
        const model = gltf.scene; // gltf.scene 就是模型根节点

        // 遍历模型里的每个子对象，给网格开启阴影
        model.traverse((object) => {
          if (object.isMesh) {
            object.castShadow = true; // 投射阴影
            object.receiveShadow = true; // 接收阴影
          }
        });
        scene.add(model);

        // 如果模型自带动画，就播放第 1 个动画片段
        let mixer = null;
        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(gltf.animations[0]).play();
        }

        resolve({ model, mixer });
      },
      // --- 加载进度 ---
      (event) => {
        if (!onProgress || !(event.total > 0)) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      },
      // --- 加载失败 ---
      (error) => {
        reject(error);
      },
    );
  });
}
