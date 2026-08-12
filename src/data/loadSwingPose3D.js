/**
 * English: Decodes SwingPose3D .pb data (from URL or a user-picked File) via golf_pose3d.proto.
 * 中文：按 golf_pose3d.proto 中的 SwingPose3D 定义解码 .pb 数据；
 *       数据来源可以是 URL（示例文件）或用户本地选择的 File，不再在启动时自动加载。
 */
import protobuf from 'protobufjs';
import protoSrc from '../../protobuf/golf_pose3d.proto?raw';
import pbUrl from '../../protobuf/swing_pose3d.pb?url';

/** 项目内自带的示例 pb（仅在用户点击「加载示例」时才会真正请求） */
export const SAMPLE_PB_URL = pbUrl;
export const SAMPLE_PB_NAME = 'swing_pose3d.pb';

/**
 * 解析 proto 并返回 SwingPose3D 类型。
 * keepCase: 保留 proto 字段名（snake_case），便于对照规范查看。
 * @returns {protobuf.Type}
 */
function getSwingPose3DType() {
  const { root } = protobuf.parse(protoSrc, { keepCase: true });
  const type = root.lookupType('golf.pose.SwingPose3D');
  if (!type) {
    throw new Error('找不到 golf.pose.SwingPose3D 类型，请检查 proto 定义。');
  }
  return type;
}

/**
 * 从 SwingPose3D 数据中收集全部唯一关节名（按名字排序）。
 * @param {{ frames?: Array<{ joints?: Record<string, unknown> }> }} data
 * @returns {string[]}
 */
export function collectJointNames(data) {
  const names = new Set();
  for (const frame of data.frames ?? []) {
    for (const name of Object.keys(frame.joints ?? {})) {
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * 把每帧的 joints map 转成列表：[{ name, position, confidence }, ...]
 * @param {{ frames?: Array<{ joints?: Record<string, object>, [key: string]: unknown }> }} data
 * @returns {object}
 */
export function withJointsAsList(data) {
  const frames = (data.frames ?? []).map((frame) => {
    const jointsMap = frame.joints ?? {};
    const joints = Object.entries(jointsMap).map(([name, joint]) => ({
      name,
      ...joint,
    }));
    return { ...frame, joints };
  });

  return {
    ...data,
    frames,
    joint_names: collectJointNames(data),
  };
}

/**
 * 解码一段 SwingPose3D 二进制数据。
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{
 *   message: protobuf.Message,
 *   data: object,
 *   joints: string[],
 *   json: string,
 * }}
 */
export function decodeSwingPose3D(bytes) {
  const SwingPose3D = getSwingPose3DType();
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const message = SwingPose3D.decode(buffer);
  const raw = SwingPose3D.toObject(message, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: false,
    arrays: true,
    objects: true,
    oneofs: true,
  });

  const joints = collectJointNames(raw);
  const data = withJointsAsList(raw);

  return {
    message,
    data,
    joints,
    json: JSON.stringify(data, null, 2),
  };
}

/**
 * 从 URL 加载并解码 SwingPose3D。
 *
 * @param {object} [options]
 * @param {string} [options.url] - .pb 文件路径，默认项目内示例 swing_pose3d.pb
 * @returns {Promise<ReturnType<typeof decodeSwingPose3D>>}
 */
export async function loadSwingPose3D(options = {}) {
  const { url = SAMPLE_PB_URL } = options;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载 ${url} 失败：HTTP ${response.status}`);
  }

  return decodeSwingPose3D(await response.arrayBuffer());
}

/**
 * 从用户选择的本地文件解码 SwingPose3D。
 *
 * @param {File} file
 * @returns {Promise<ReturnType<typeof decodeSwingPose3D>>}
 */
export async function loadSwingPose3DFromFile(file) {
  return decodeSwingPose3D(await file.arrayBuffer());
}
