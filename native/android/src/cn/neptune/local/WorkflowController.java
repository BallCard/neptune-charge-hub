package cn.neptune.local;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.*;
import java.util.*;

final class WorkflowController {
    private final Context context;
    private final LocalVault vault;
    private final AlarmScheduler alarms;
    private final Platform platform;
    private JSONObject selectedTarget;
    private JSONObject quote;
    WorkflowController(Context context) { this.context=context;vault=new LocalVault(context);alarms=new AlarmScheduler(context);platform=new Platform(); }
    private void requireNoActive(JSONObject root) throws Exception {
        JSONArray bookings=root.getJSONArray("bookings");
        for(int i=0;i<bookings.length();i++)if(Checks.active(bookings.getJSONObject(i).optString("phase")))throw new Exception("请先完成或取消已有预约；结果不明时先在微信核对。");
    }
    boolean notifications() {
        return ((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT<33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);
    }
    JSONObject status() throws Exception {
        JSONObject root=vault.read(); JSONArray list=root.getJSONArray("bookings"),publicList=new JSONArray();
        for(int i=list.length()-1;i>=0;i--){ JSONObject source=list.getJSONObject(i),safe=new JSONObject();
            for(String key:Arrays.asList("id","device","port","scheduledAt","createdAt","schemeTitle","maxMinutes","phase","result","mailStatus"))safe.put(key,source.opt(key));
            publicList.put(safe);
        }
        boolean ready=alarms.allowed(),notices=notifications();
        return new JSONObject().put("executor",new JSONObject().put("kind","android").put("connected",true).put("exactAlarm",ready).put("notifications",notices)
            .put("detail",ready&&notices ? "安卓本机助手已连接。预约由系统定时执行；请保持手机联网，并允许后台运行。" : "请允许精确定时与通知后再预约。手机关机或被强制停止时不能执行。"))
            .put("profile",new JSONObject().put("accountBound",root.has("account")).put("mailConfigured",root.has("mail"))
                .put("recipient",root.has("mail")?root.getJSONObject("mail").optString("recipient"):""))
            .put("target",selectedTarget==null?JSONObject.NULL:selectedTarget).put("quote",quote==null?JSONObject.NULL:quote).put("bookings",publicList);
    }
    JSONObject action(String action,JSONObject input) throws Exception {
        if(action.equals("status") || action.equals("refresh")) return status();
        if(action.equals("configureAccount")) {
            JSONObject account=Checks.account(Checks.text(input,"url",".{1,8192}",8192));
            platform.read(account,account.getJSONObject("defaultTarget"));
            vault.edit(root->{requireNoActive(root);root.put("account",account);}); quote=null;
            if(selectedTarget==null)selectedTarget=account.getJSONObject("defaultTarget");
        } else if(action.equals("configureMail")) {
            JSONObject mail=Checks.mail(input);vault.edit(root->{requireNoActive(root);root.put("mail",mail);});
        } else if(action.equals("setTarget")) { selectedTarget=Checks.target(input.getJSONObject("target"));quote=null; }
        else if(action.equals("clearTarget")) { selectedTarget=null;quote=null; }
        else if(action.equals("inspectTarget")) {
            JSONObject root=vault.read();if(!root.has("account")||selectedTarget==null)throw new Exception("请先配置账号并上传插座二维码。");
            quote=platform.read(root.getJSONObject("account"),selectedTarget).getJSONObject("quote");
        } else if(action.equals("reserve")) reserve(input);
        else if(action.equals("cancel")) {
            String id=Checks.text(input,"id","[0-9a-fA-F-]{36}",36);
            vault.update(id,b->{if(!b.getString("phase").equals("scheduled") || Checks.at(b.getString("scheduledAt"))<=System.currentTimeMillis()+30_000)throw new Exception("预约已进入执行窗口，不能取消。");
                b.put("phase","cancelled").put("result","预约已取消，没有提交新的充电请求。").put("mailStatus","not-required");}); alarms.cancel(id);
        } else if(action.equals("reviewUncertain")) {
            String id=Checks.text(input,"id","[0-9a-fA-F-]{36}",36);JSONObject booking=vault.booking(id);
            JSONObject order=platform.order(booking.getJSONObject("account"));
            vault.update(id,b->Checks.review(b,Boolean.TRUE.equals(input.opt("confirmedReview")),order));
        } else if(action.equals("retryMail")) {
            String id=Checks.text(input,"id","[0-9a-fA-F-]{36}",36);JSONObject booking=vault.booking(id);
            if(!Checks.terminal(booking.optString("phase"))||!booking.optString("mailStatus").equals("failed")||booking.optInt("mailAttempts",0)>=3)
                throw new Exception("邮件不能重发：只允许明确失败且少于三次的发送尝试。");
            context.startForegroundService(new Intent(context,ChargeService.class).putExtra("id",id).putExtra("watch",true));
        } else throw new Exception("不支持此操作。");
        return status();
    }
    private void reserve(JSONObject input) throws Exception {
        long at=Checks.schedule(input,System.currentTimeMillis());
        if(!alarms.allowed()||!notifications())throw new Exception("请先允许精确定时与通知。");
        String id=Checks.text(input,"idempotencyKey","[0-9a-fA-F-]{36}",36);
        JSONObject root=vault.read();
        JSONArray bookings=root.getJSONArray("bookings");for(int i=0;i<bookings.length();i++)if(bookings.getJSONObject(i).getString("id").equals(id))return;
        requireNoActive(root);
        if(!root.has("account")||!root.has("mail"))throw new Exception("请先配置本人付款信息和通知邮箱。");
        JSONObject target=Checks.target(input.getJSONObject("target"));
        JSONObject snapshot=platform.read(root.getJSONObject("account"),target), fresh=snapshot.getJSONObject("quote");
        String fingerprint=Checks.text(input,"quoteFingerprint","[0-9a-f]{64}",64),schemeId=Checks.text(input,"schemeId","(full-stop|minutes-[0-9]{1,4})",32);
        if(!fresh.getString("fingerprint").equals(fingerprint))throw new Exception("方案或费率已改变，请重新核对后确认。");
        JSONObject scheme=Platform.select(fresh,schemeId);int cap=Checks.number(input,"maxPrepayCents",1,1000);
        if(!fresh.getBoolean("available")||fresh.getInt("balanceCents")<Math.max(200,scheme.getInt("prepayCents"))||scheme.getInt("prepayCents")>cap)throw new Exception("插座、余额或预扣金额核对未通过，请在微信确认。");
        JSONObject booking=new JSONObject().put("id",id).put("device",target.getString("device")).put("port",target.getString("port"))
            .put("scheduledAt",Checks.iso(at)).put("createdAt",Checks.iso(System.currentTimeMillis())).put("schemeId",schemeId).put("schemeTitle",scheme.getString("title"))
            .put("maxMinutes",scheme.getInt("maxMinutes")).put("maxPrepayCents",cap).put("quoteFingerprint",fingerprint).put("account",root.getJSONObject("account"))
            .put("mail",root.getJSONObject("mail")).put("phase","scheduling-failed").put("result","定时登记尚未确认，没有自动开电。").put("mailStatus","not-required");
        vault.edit(data->{requireNoActive(data);if(!data.getJSONObject("account").toString().equals(root.getJSONObject("account").toString())||!data.getJSONObject("mail").toString().equals(root.getJSONObject("mail").toString()))throw new Exception("配置已改变，请重新确认。");
            JSONArray list=data.getJSONArray("bookings");if(list.length()>=200)throw new Exception("本机预约记录已达测试版上限，暂时不能新建预约。");list.put(booking);});
        try { alarms.register(id,at); vault.update(id,b->b.put("phase","scheduled").put("registeredAt",Checks.iso(System.currentTimeMillis())).put("mailStatus","queued").put("result","系统已登记单次预约，执行后会通知结果。")); }
        catch(Exception error){alarms.cancel(id);throw new Exception("系统定时登记失败，尚未生效。请重新检查权限。");}
        selectedTarget=target;quote=fresh;
    }
}
