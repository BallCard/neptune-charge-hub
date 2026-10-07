import type { QrTarget } from "./workflow-types";

/** Decode an official QR string without fetching it or following login redirects. */
export function parseQrTarget(raw: string): QrTarget {
  if (typeof raw !== "string" || raw.length > 8192) throw new Error("二维码内容过长或格式不正确。");
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("未识别到尼普顿插座链接，请上传清晰的二维码图片。"); }
  if (url.hostname === "open.weixin.qq.com" && url.pathname === "/connect/oauth2/authorize") {
    const redirect = url.searchParams.getAll("redirect_uri");
    if (redirect.length !== 1) throw new Error("微信二维码缺少设备入口。");
    try { url = new URL(redirect[0]); } catch { throw new Error("设备入口格式不正确。"); }
  }
  if (!["https:", "http:"].includes(url.protocol) || !["www.szlzxn.cn", "szlzxn.cn"].includes(url.hostname) ||
    url.username || url.password || url.port) throw new Error("这不是尼普顿官方插座二维码。");
  const params = url.searchParams;
  const fragment = new URLSearchParams(url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "");
  const unique = (key: string, optional = false) => {
    const values = [...params.getAll(key), ...fragment.getAll(key)];
    if (values.length > 1 || (!optional && values.length !== 1)) throw new Error("二维码字段缺失或重复。");
    return values[0];
  };
  const device = unique("devaddress")!;
  if (!/^\d{10}$/.test(device)) throw new Error("二维码必须包含8位设备号和2位插座号。");
  const port = device.slice(8), socket = unique("socketNumber", true);
  if (Number(port) < 1 || Number(port) > 99 || socket !== undefined && (!/^\d{1,2}$/.test(socket) || socket.padStart(2, "0") !== port))
    throw new Error("二维码中的插座号不一致。");
  const area = unique("areaid", true);
  if (area !== undefined && (!/^\d+$/.test(area) || !Number.isSafeInteger(Number(area)) || Number(area) <= 0))
    throw new Error("二维码区域字段不正确。");
  return { device: device.slice(0, 8), port, ...(area ? { areaId: Number(area) } : {}) };
}

export async function readQrImage(file: File): Promise<QrTarget> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 12_000_000)
    throw new Error("请选择不超过12MB的 PNG、JPEG 或 WebP 二维码图片。");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new Error("图片过大，请先裁剪二维码区域。");
    const ratio = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法读取图片，请粘贴二维码链接。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height), { default: jsQR } = await import("jsqr");
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    if (!result) throw new Error("没有识别到二维码。请裁剪二维码区域或换一张清晰图片。");
    return parseQrTarget(result.data);
  } finally { bitmap.close(); }
}
