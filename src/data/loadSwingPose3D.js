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
 * 加载并解码 SwingPose3D 二进制数据。
 *
 * @param {object} [options]
 * @param {string} [options.url] - .pb 文件路径，默认项目内 swing_pose3d.pb
 * @returns {Promise<{
 *   message: protobuf.Message,
 *   data: object,
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
  const data = SwingPose3D.toObject(message, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: false,
    arrays: true,
    objects: true,
    oneofs: true,
  });

  return {
    message,
    data,
    json: JSON.stringify(data, null, 2),
  };
}
