/**
 * English: Persist joint↔bone mapping as JSON in localStorage, with file export/import.
 * 中文：将关节↔骨骼映射以 JSON 存入 localStorage，并支持导出/导入 JSON 文件，刷新后无需重选。
 */

export const MAPPING_STORAGE_KEY = 'threejs.jointBoneMap.v1';
export const MAPPING_JSON_FILENAME = 'joint_bone_map.json';

/**
 * @typedef {{
 *   version: number,
 *   updatedAt: string,
 *   map: Record<string, string | null>,
 * }} JointBoneMapFile
 */

/**
 * 从 localStorage 读取映射 JSON。
 * @returns {Record<string, string | null> | null}
 */
export function loadMappingFromStorage() {
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
    if (!raw) return null;
    return parseMappingJson(raw);
  } catch (error) {
    console.warn('读取本地映射失败：', error);
    return null;
  }
}

/**
 * 把当前映射写入 localStorage（JSON 字符串）。
 * @param {Record<string, string | null>} map
 */
export function saveMappingToStorage(map) {
  const payload = buildMappingFile(map);
  localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(payload, null, 2));
  return payload;
}

/** 清除 localStorage 中的映射 */
export function clearMappingStorage() {
  localStorage.removeItem(MAPPING_STORAGE_KEY);
}

/**
 * @param {Record<string, string | null>} map
 * @returns {JointBoneMapFile}
 */
export function buildMappingFile(map) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    map: { ...map },
  };
}

/**
 * 解析映射 JSON 文本，返回 map 对象；格式非法时返回 null。
 * @param {string} text
 * @returns {Record<string, string | null> | null}
 */
export function parseMappingJson(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object') return null;

  // 兼容两种格式：完整文件 { version, map } 或直接 { joint: bone }
  const map =
    data.map && typeof data.map === 'object' && !Array.isArray(data.map)
      ? data.map
      : data.version == null
        ? data
        : null;

  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;

  /** @type {Record<string, string | null>} */
  const result = {};
  for (const [joint, bone] of Object.entries(map)) {
    if (bone === null || bone === '' || typeof bone === 'string') {
      result[joint] = bone === '' ? null : bone;
    }
  }
  return result;
}

/**
 * 触发浏览器下载映射 JSON 文件。
 * @param {Record<string, string | null>} map
 * @param {string} [filename]
 */
export function downloadMappingJson(map, filename = MAPPING_JSON_FILENAME) {
  const payload = buildMappingFile(map);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * 弹出文件选择框，读取用户导入的映射 JSON。
 * @returns {Promise<Record<string, string | null> | null>}
 */
export function pickMappingJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve(parseMappingJson(text));
      } catch (error) {
        console.error('导入映射 JSON 失败：', error);
        resolve(null);
      }
    });
    input.click();
  });
}
