package cn.neptune.local;

import org.json.*;
import java.util.*;

final class ChargeRunner {
    interface Edit { void apply(JSONObject booking) throws Exception; }
    interface Repository { JSONObject booking(String id) throws Exception; void update(String id,Edit edit) throws Exception; }
    interface Notifier { void send(Repository repository,String id) throws Exception; }
    interface Clock { long now(); void sleep(long millis) throws Exception; }
    private final Repository repository;
    private final Platform platform;
    private final Notifier notifier;
    private final Clock clock;
    ChargeRunner(Repository repository, Platform platform, Notifier notifier) {
        this(repository,platform,notifier,new Clock(){ public long now(){ return System.currentTimeMillis(); } public void sleep(long millis) throws Exception { Thread.sleep(millis); } });
    }
    ChargeRunner(Repository repository, Platform platform, Notifier notifier, Clock clock) {
        this.repository=repository;this.platform=platform;this.notifier=notifier;this.clock=clock;
    }
    private void phase(String id,String value,String result) throws Exception {
        repository.update(id,b -> { if (b.optString("phase").equals("cancelled")) throw new Exception("预约已取消。"); b.put("phase",value).put("result",result); });
    }
    private void finish(String id,String value,String result) throws Exception {
        repository.update(id,b -> { if (b.optString("phase").equals("cancelled")) return; b.put("phase",value).put("result",result).put("mailStatus","queued"); });
        if (!repository.booking(id).optString("phase").equals("cancelled")) notifyResult(id);
    }
    private void notifyResult(String id) throws Exception {
        try { notifier.send(repository,id); }
        catch (Exception ignored) { repository.update(id,b -> { if (!Arrays.asList("sent","uncertain").contains(b.optString("mailStatus"))) b.put("mailStatus","failed"); }); }
    }
    synchronized void run(String id,boolean watchOnly) throws Exception {
        JSONObject booking = repository.booking(id); String phase = booking.getString("phase");
        if (phase.equals("cancelled")) return;
        if (Checks.terminal(phase)) { notifyResult(id); return; }
        if (Arrays.asList("submitting","pending").contains(phase)) { verify(id); return; }
        long at = Checks.at(booking.getString("scheduledAt")), deadline = at + 10 * 60_000;
        if (clock.now() < at) return;
        if (watchOnly || clock.now() > deadline) { finish(id,"missed","执行端未在预约窗口内完成开电，没有新建充电请求。"); return; }
        if (!Arrays.asList("scheduled","waiting","checking").contains(phase)) return;
        JSONObject account = booking.getJSONObject("account"), target = new JSONObject().put("device",booking.getString("device")).put("port",booking.getString("port"));
        boolean opened = false;
        try {
            while (clock.now() <= deadline) {
                if (repository.booking(id).getString("phase").equals("cancelled")) return;
                phase(id,"checking","正在核对本人账号、方案和插座。");
                JSONObject snapshot;
                try { snapshot = platform.read(account,target); }
                catch (Exception error) {
                    if (clock.now() + 15_000 > deadline) throw new Exception("只读核对未完成，没有提交充电。");
                    phase(id,"waiting","只读核对未完成，正在等待网络恢复。"); clock.sleep(15_000); continue;
                }
                JSONObject ownOrder = snapshot.optJSONObject("order");
                if (Platform.matches(ownOrder,target)) { finish(id,"already-charging","目标插座已有本人的充电订单，没有重复启动。"); return; }
                if (ownOrder != null) throw new Exception("本人在其他插座已有订单，没有新建充电。");
                if (!snapshot.getJSONObject("quote").getBoolean("businessOpen")) { phase(id,"waiting","等待平台恢复营业。"); clock.sleep(15_000); continue; }
                if (!opened) { opened = true; phase(id,"waiting","平台已营业，等待设备恢复30秒。"); clock.sleep(30_000); continue; }
                if (clock.now() > deadline) break;
                JSONObject payload = platform.payload(account,snapshot,booking.getString("schemeId"),booking.getInt("maxPrepayCents"),booking.getString("quoteFingerprint"));
                repository.update(id,b -> {
                    if (!Arrays.asList("scheduled","waiting","checking").contains(b.getString("phase"))) throw new Exception("预约状态已变化，没有提交充电。");
                    b.put("phase","submitting").put("payload",payload).put("submittedAt",Checks.iso(clock.now())).put("acknowledged",false).put("result","启动请求已占用，正在提交；不会重复新建。");
                });
                JSONObject response;
                try { response = platform.submit(payload); }
                catch (Exception error) { finish(id,"uncertain","提交响应未能确认，请在微信核对；不会重新提交。"); return; }
                if (!Boolean.TRUE.equals(response.opt("success"))) { finish(id,"rejected","平台拒绝启动，请在微信核对。"); return; }
                Object rawToken = response.opt("obj"); String token = rawToken instanceof String ? (String)rawToken : "";
                if(rawToken instanceof Number){double numeric=((Number)rawToken).doubleValue();if(Double.isFinite(numeric)&&numeric==Math.rint(numeric)&&Math.abs(numeric)<=9007199254740991L)token=String.valueOf(((Number)rawToken).longValue());}
                if (token.isEmpty() || token.length() > 256) { finish(id,"uncertain","平台请求标识异常，请在微信核对；不会重新提交。"); return; }
                final String originalToken=token;
                repository.update(id,b -> b.put("msgflag",originalToken).put("phase","pending").put("result","请求已发送，等待平台和本人订单确认。"));
                verify(id); return;
            }
            finish(id,"failed","超过10分钟执行窗口，没有提交新充电。");
        } catch (Exception error) {
            JSONObject current = repository.booking(id);
            if (current.optString("phase").equals("cancelled")) return;
            boolean submitted = current.has("submittedAt");
            finish(id,submitted ? "uncertain" : "failed",submitted ? "执行中断，启动结果不明；请在微信核对，不会重新提交。" : error.getMessage());
        }
    }
    private void verify(String id) throws Exception {
        JSONObject booking = repository.booking(id); String token = booking.optString("msgflag","");
        if (token.isEmpty()) { finish(id,"uncertain","缺少原请求标识，请在微信核对；没有重新提交。"); return; }
        long end = clock.now() + 120_000;
        while (clock.now() <= end) {
            booking = repository.booking(id); boolean acknowledged = booking.optBoolean("acknowledged",false);
            if (!acknowledged) {
                try {
                    acknowledged = platform.acknowledge(booking.getJSONObject("payload"),token);
                    if (acknowledged) repository.update(id,b -> b.put("acknowledged",true));
                } catch (Exception ignored) { }
            }
            try {
                JSONObject order = platform.order(booking.getJSONObject("account"));
                if (order != null && !Platform.matches(order,booking)) { finish(id,"uncertain","本人订单在其他插座，请在微信核对；不会重新提交。"); return; }
                if (acknowledged && Platform.matches(order,booking)) { finish(id,"confirmed","平台已确认目标插座启动，请在微信查看实时订单和功率。"); return; }
            } catch (Exception ignored) { }
            clock.sleep(8_000);
        }
        finish(id,"uncertain","未能同时确认原请求和本人订单，请在微信核对；不会重新提交。");
    }
}
