import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function key() {
  const value = Buffer.from(process.env.ACCOUNT_ENCRYPTION_KEY ?? "", "base64");
  if (value.length !== 32) throw new Error("账号加密配置尚未完成。");
  return value;
}
export function seal(value: unknown, owner: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}
export function unseal<T>(value: string, owner: string): T {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("账号数据无法读取，请重新绑定。");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body, "base64")), cipher.final()]).toString("utf8")) as T;
}
export function fingerprint(identity: string) {
  return createHmac("sha256", key()).update(identity).digest("hex");
}
