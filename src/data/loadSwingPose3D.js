/**
 * English: Loads and decodes swing_pose3d.pb using golf_pose3d.proto (SwingPose3D).
 * 中文：按 golf_pose3d.proto 中的 SwingPose3D 定义，加载并解码 swing_pose3d.pb。
 */
import protobuf from 'protobufjs';
import protoSrc from '../../protobuf/golf_pose3d.proto?raw';
import pbUrl from '../../protobuf/swing_pose3d.pb?url';

const DEFAULT_PB_URL = pbUrl;

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
 * 加载并解码 SwingPose3D 二进制数据。
 *
 * @param {object} [options]
 * @param {string} [options.url] - .pb 文件路径，默认项目内 swing_pose3d.pb
 * @returns {Promise<{
 *   message: protobuf.Message,
 *   data: object,
 *   joints: string[],
 *   json: string,
 * }>}
 */
export async function loadSwingPose3D(options = {}) {
  const { url = DEFAULT_PB_URL } = options;
  const SwingPose3D = getSwingPose3DType();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载 ${url} 失败：HTTP ${response.status}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
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
