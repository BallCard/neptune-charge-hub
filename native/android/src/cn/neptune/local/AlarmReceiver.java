package cn.neptune.local;
import android.content.*;
public final class AlarmReceiver extends BroadcastReceiver {
    public void onReceive(Context context,Intent intent) {
        String id=intent.getStringExtra("id"); if (id==null || !id.matches("[0-9a-fA-F-]{36}")) return;
        try { context.startForegroundService(new Intent(context,ChargeService.class).putExtra("id",id).putExtra("watch",intent.getBooleanExtra("watch",false))); }
        catch (Exception error) { try { new LocalVault(context).update(id,b -> b.put("result","系统未能启动后台执行，请检查电池限制并在微信核对。")); } catch(Exception ignored) {} }
    }
}
