package cn.neptune.local;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import org.json.*;

final class AlarmScheduler {
    private final Context context;
    private final AlarmManager manager;
    AlarmScheduler(Context context) { this.context=context; manager=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE); }
    boolean allowed() { return Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms(); }
    private PendingIntent operation(String id,boolean watch) {
        Intent intent = new Intent(context,AlarmReceiver.class).setAction(watch ? "neptune.watch" : "neptune.execute")
            .setData(Uri.parse("neptune://booking/" + id + (watch ? "/watch" : "/execute"))).putExtra("id",id).putExtra("watch",watch);
        return PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    void register(String id,long at) throws Exception {
        if (!allowed()) throw new Exception("请先允许精确定时，再预约。");
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,operation(id,false));
        try { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at + 15 * 60_000,operation(id,true)); }
        catch (Exception error) { cancel(id); throw error; }
    }
    void cancel(String id) { for (boolean watch : new boolean[]{false,true}) { PendingIntent intent=operation(id,watch); manager.cancel(intent); intent.cancel(); } }
    void recover(LocalVault vault) throws Exception {
        if (!allowed()) return;
        JSONArray list = vault.read().getJSONArray("bookings"); long now=System.currentTimeMillis();
        for (int i=0;i<list.length();i++) {
            JSONObject item=list.getJSONObject(i); String phase=item.getString("phase"),id=item.getString("id"); long at=Checks.at(item.getString("scheduledAt"));
            if (Checks.active(phase) && !phase.equals("uncertain")) {
                if (at > now) register(id,at);
                else if (now <= at + 10 * 60_000) { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,now+10_000,operation(id,false)); manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,now+15*60_000,operation(id,true)); }
                else manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,now+10_000,operation(id,true));
            } else if (Checks.terminal(phase) && !java.util.Arrays.asList("sent","uncertain","not-required").contains(item.optString("mailStatus")) && item.optInt("mailAttempts",0)<3)
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,now+10_000,operation(id,true));
        }
    }
}
