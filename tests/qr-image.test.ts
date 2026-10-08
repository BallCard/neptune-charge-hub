import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import jsQR from "jsqr";
import { decodeQrPixels } from "../src/lib/qr-target";
import { prepareZXingModule } from "zxing-wasm/reader";
const require = createRequire(import.meta.url);
const QR = require("qrcode") as {toBuffer(text:string,options:{type:string,width:number,margin:number}):Promise<Buffer>};
const PNG = require("pngjs").PNG as {sync:{read(buffer:Buffer):{data:Buffer,width:number,height:number}}};
test("actual PNG QR decodes on device to the correct target",async()=>{
  const raw="https://www.szlzxn.cn/wx/?devaddress=1234567806&areaid=6";
  const png=await QR.toBuffer(raw,{type:"png",width:500,margin:3});
  const bitmap=PNG.sync.read(png);
  prepareZXingModule({overrides:{wasmBinary:await readFile("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm")}});
  assert.deepEqual(await decodeQrPixels({data:new Uint8ClampedArray(bitmap.data),width:bitmap.width,height:bitmap.height,colorSpace:"srgb"}),{device:"12345678",port:"06",areaId:6});
  await mkdir(".local/artifacts",{recursive:true});await writeFile(".local/artifacts/synthetic-qr.png",png);
});
test("private tilted photo regression, when the local diagnostic fixture is present", async t=>{
  let pixels: Buffer, dimensions: {width:number;height:number};
  try { pixels=await readFile(".local/artifacts/real-qr-diagnostic/pixels.rgba");dimensions=JSON.parse(await readFile(".local/artifacts/real-qr-diagnostic/dimensions.json","utf8")); }
  catch { t.skip("Private user photo is not part of the repository.");return; }
  prepareZXingModule({overrides:{wasmBinary:await readFile("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm")}});
  assert.equal(jsQR(new Uint8ClampedArray(pixels),dimensions.width,dimensions.height,{inversionAttempts:"attemptBoth"}),null);
  const decoded=await decodeQrPixels({data:new Uint8ClampedArray(pixels),...dimensions,colorSpace:"srgb"});
  // Compare with the number in this private fixture without publishing the user's socket.
  const expected=JSON.parse(await readFile(".local/artifacts/real-qr-diagnostic/expected-target.json","utf8"));
  assert.deepEqual(decoded,expected);
});
