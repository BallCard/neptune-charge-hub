import assert from "node:assert/strict";
import test from "node:test";
import { parseQrTarget, parseSocketNumber } from "../src/lib/qr-target";
import { tomorrowAt } from "../src/lib/workflow-types";
test("tomorrow means next Shanghai calendar day even before 06:00 and on year boundaries",()=>{
  assert.equal(tomorrowAt("06:00",Date.parse("2026-10-07T01:00:00+08:00")),"2026-10-07T22:00:00.000Z");
  assert.equal(tomorrowAt("06:00",Date.parse("2026-12-31T23:59:00+08:00")),"2026-12-31T22:00:00.000Z");
  assert.throws(()=>tomorrowAt("25:00"));
});
test("official QR targets and WeChat wrappers decode locally without carrying account fields",()=>{
  const url="https://www.szlzxn.cn/wx/indexn.html?devaddress=1234567806&areaid=6&openId=synthetic-account#/pay?socketNumber=6";
  const target={device:"12345678",port:"06",areaId:6};
  assert.deepEqual(parseQrTarget(url),target);
  assert.deepEqual(parseQrTarget("https://open.weixin.qq.com/connect/oauth2/authorize?redirect_uri="+encodeURIComponent(url)),target);
  assert.ok(!JSON.stringify(parseQrTarget(url)).includes("synthetic-account"));
});
test("QR parser rejects foreign destinations, duplicate fields and inconsistent sockets",()=>{
  const base="https://www.szlzxn.cn/wx/?devaddress=1234567806";
  for(const url of [base.replace("www.szlzxn.cn","evil.example"),base+"&devaddress=8765432101",base+"#/pay?socketNumber=7",base.replace("1234567806","1234567800"),base.replace("www.szlzxn.cn","www.szlzxn.cn:444"),"https://open.weixin.qq.com/connect/oauth2/authorize?redirect_uri="+encodeURIComponent("https://evil.example/?devaddress=1234567806")])assert.throws(()=>parseQrTarget(url));
});
test("printed official scan routes and manual socket numbers identify the socket without authorization",()=>{
  const target={device:"12345678",port:"06"};
  assert.deepEqual(parseQrTarget("http://szlzxn.cn/wechat/wxscan/1234567806"),target);
  assert.deepEqual(parseSocketNumber(" 1234567806 "),target);
  for(const raw of ["1234567800","123456789","1234567806?openId=x"] )assert.throws(()=>parseSocketNumber(raw));
  assert.throws(()=>parseQrTarget("http://szlzxn.cn/wechat/wxscan/1234567806?devaddress=8765432101"));
});
