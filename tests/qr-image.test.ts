import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import jsQR from "jsqr";
import { parseQrTarget } from "../src/lib/qr-target";
const require = createRequire(import.meta.url);
const QR = require("qrcode") as {toBuffer(text:string,options:{type:string,width:number,margin:number}):Promise<Buffer>};
const PNG = require("pngjs").PNG as {sync:{read(buffer:Buffer):{data:Buffer,width:number,height:number}}};
test("actual PNG QR decodes on device to the correct target",async()=>{
  const raw="https://www.szlzxn.cn/wx/?devaddress=1234567806&areaid=6";
  const png=await QR.toBuffer(raw,{type:"png",width:500,margin:3});
  const bitmap=PNG.sync.read(png),result=jsQR(new Uint8ClampedArray(bitmap.data),bitmap.width,bitmap.height,{inversionAttempts:"attemptBoth"});
  assert.ok(result);assert.deepEqual(parseQrTarget(result.data),{device:"12345678",port:"06",areaId:6});
  await mkdir(".local/artifacts",{recursive:true});await writeFile(".local/artifacts/synthetic-qr.png",png);
});
