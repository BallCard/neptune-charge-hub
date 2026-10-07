import { localDataSchema, newLocalData, type LocalData } from "./local-data";

export type Envelope = { format: "neptune-local-vault"; version: 1; iterations: number; revision: number; salt: string; iv: string; cipher: string };
export type UnlockedVault = { key: CryptoKey; envelope: Envelope; data: LocalData };
const ITERATIONS = 310_000;
const AAD = new TextEncoder().encode("neptune-local-vault:1");
const STORE = "vault", DB = "neptune-local-v1";
function base64(bytes: Uint8Array) { return btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")); }
function bytes(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("备份格式不正确。");
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export function validateEnvelope(value: unknown): Envelope {
  const e = value as Partial<Envelope> | null;
  if (!e || e.format !== "neptune-local-vault" || e.version !== 1 || e.iterations !== ITERATIONS ||
    !Number.isSafeInteger(e.revision) || e.revision! < 0 || typeof e.salt !== "string" || typeof e.iv !== "string" ||
    typeof e.cipher !== "string" || e.cipher.length > 2_000_000 || bytes(e.salt).length !== 16 ||
    bytes(e.iv).length !== 12 || bytes(e.cipher).length < 16) throw new Error("备份文件格式或版本不正确。");
  return { format: e.format, version: e.version, iterations: e.iterations, revision: e.revision!, salt: e.salt, iv: e.iv, cipher: e.cipher };
}
async function derive(password: string, salt: string) {
  if (password.length < 8 || password.length > 256) throw new Error("本机密码需要8–256个字符。");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations: ITERATIONS },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptData(key: CryptoKey, data: LocalData, base: Envelope): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(localDataSchema.parse(data)));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plain);
  return { ...base, revision: base.revision + 1, iv: base64(iv), cipher: base64(new Uint8Array(cipher)) };
}
export async function createVault(password: string): Promise<UnlockedVault> {
  const salt = base64(crypto.getRandomValues(new Uint8Array(16))), key = await derive(password, salt), data = newLocalData();
  const envelope = await encryptData(key, data, { format: "neptune-local-vault", version: 1, iterations: ITERATIONS,
    revision: 0, salt, iv: "", cipher: "" });
  return { key, data, envelope };
}
export async function unlockVault(raw: unknown, password: string): Promise<UnlockedVault> {
  const envelope = validateEnvelope(raw), key = await derive(password, envelope.salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(envelope.iv), additionalData: AAD }, key, bytes(envelope.cipher));
    const data = localDataSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
    return { key, envelope, data };
  } catch { throw new Error("密码不正确，或备份文件已损坏。"); }
}
async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !crypto.subtle) throw new Error("当前浏览器不支持本机加密存储。请使用安全地址下的新版浏览器。");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(new Error("无法打开本机存储，请确认不是受限制的浏览模式。"));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readEnvelope(): Promise<Envelope | null> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("primary");
    request.onsuccess = () => { try { resolve(request.result ? validateEnvelope(request.result) : null); } catch (e) { reject(e); } };
    request.onerror = () => reject(new Error("本机数据读取失败。"));
  }); } finally { db.close(); }
}
/** Atomic compare-and-set prevents one open tab overwriting another tab's changes. */
export async function storeEnvelope(envelope: Envelope, expected: Envelope | null): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite"), store = transaction.objectStore(STORE), request = store.get("primary");
    let conflict = false;
    request.onsuccess = () => {
      const current = request.result as Envelope | undefined;
      if (expected ? !current || current.revision !== expected.revision || current.cipher !== expected.cipher : Boolean(current)) {
        conflict = true; transaction.abort(); return;
      }
      store.put(validateEnvelope(envelope), "primary");
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error(conflict
      ? "另一个页面更新了本机数据，请锁定后重新解锁再操作。" : "未能保存到本机。请检查浏览器存储空间。"));
  }); } finally { db.close(); }
}
