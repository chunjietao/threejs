/**
 * English: Loads the Xbot GLB model and returns its scene graph plus animation clips.
 * 中文：专门负责加载 Xbot GLB 模型并返回场景节点与动画片段（播放由动画模块负责）。
 *
 * 【为什么单独拆文件？】
 * - main.js 只管「场景怎么搭、怎么渲染」
 * - 本文件只管「Xbot 怎么加载」
 * - 动画播放 / 切换交给 src/features/animationController.js
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** 默认模型路径（相对网站根目录） */
const DEFAULT_URL = '/models/Xbot.glb';

/**
 * 在加载瞬间采样骨骼局部变换（真正的 bind），供之后从 idle 等动画恢复。
 * 注意：不可对带缩放 Armature 的模型调用 skeleton.pose()，会把世界尺度写进 local。
 * @param {import('three').Object3D} model
 * @returns {{ bone: import('three').Bone, position: import('three').Vector3, quaternion: import('three').Quaternion, scale: import('three').Vector3 }[]}
 */
export function captureBindPose(model) {
  /** @type {{ bone: import('three').Bone, position: import('three').Vector3, quaternion: import('three').Quaternion, scale: import('three').Vector3 }[]} */
  const pose = [];
  model.traverse((object) => {
    if (!object.isBone) return;
    pose.push({
      bone: object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });
  return pose;
}

/**
 * @param {{ bone: import('three').Bone, position: import('three').Vector3, quaternion: import('three').Quaternion, scale: import('three').Vector3 }[]} bindPose
 * @param {import('three').Object3D} [model]
 */
export function restoreBindPose(bindPose, model) {
  for (const entry of bindPose) {
    entry.bone.position.copy(entry.position);
    entry.bone.quaternion.copy(entry.quaternion);
    entry.bone.scale.copy(entry.scale);
  }
  model?.updateMatrixWorld(true);
}

/**
 * 加载 Xbot 模型并加入场景。
 *
 * @param {import('three').Scene} scene - 要放入模型的场景
 * @param {object} [options]
 * @param {string} [options.url] - 模型路径，默认 /models/Xbot.glb
 * @param {(percent: number) => void} [options.onProgress] - 加载进度 0~100
 * @returns {Promise<{
 *   model: import('three').Group,
 *   mixer: import('three').AnimationMixer | null,
 *   animations: import('three').AnimationClip[],
 *   bindPose: ReturnType<typeof captureBindPose>,
 * }>}
 */
export function loadXbot(scene, options = {}) {
  const { url = DEFAULT_URL, onProgress } = options;
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      // --- 加载成功 ---
      (gltf) => {
        const model = gltf.scene;
        const animations = gltf.animations ?? [];

        // 遍历模型里的每个子对象，给网格开启阴影
        model.traverse((object) => {
          if (object.isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        scene.add(model);

        // 在创建 mixer / 播放动画之前采样 bind（此时骨骼仍是蒙皮绑定姿势）
        const bindPose = captureBindPose(model);

        // 只创建 mixer，不在这里 play —— 交给动画控制器统一管理
        const mixer =
          animations.length > 0 ? new THREE.AnimationMixer(model) : null;

        resolve({ model, mixer, animations, bindPose });
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
