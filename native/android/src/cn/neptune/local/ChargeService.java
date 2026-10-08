package cn.neptune.local;

import android.app.*;
import android.content.*;
import android.os.*;
import java.util.concurrent.*;

public final class ChargeService extends Service {
    private static final ExecutorService WORKER=Executors.newSingleThreadExecutor();
    static final String CHANNEL="neptune-charge";
    static void channels(Context context) {
        NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"充电预约与结果",NotificationManager.IMPORTANCE_DEFAULT));
    }
    static Notification notification(Context context,String title,String text) {
        PendingIntent open=PendingIntent.getActivity(context,0,new Intent(context,MainActivity.class),PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_charging).setContentTitle(title)
            .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(open).setOnlyAlertOnce(true).setAutoCancel(true).build();
    }
    public void onCreate() { super.onCreate(); channels(this); startForeground(6,notification(this,"晨充正在核对","本机执行中，结果将通过手机通知告知。")); }
    public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent==null){stopSelf(startId);return START_NOT_STICKY;}
        String id=intent.getStringExtra("id"); boolean watch=intent.getBooleanExtra("watch",false);
        if(id==null){stopSelf(startId);return START_NOT_STICKY;}
        WORKER.submit(() -> {
            PowerManager.WakeLock wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"neptune:charge");
            wake.acquire(14*60_000L);
            LocalVault vault=new LocalVault(this);
            try {
                new ChargeRunner(vault,new Platform(),new ResultMail()).run(id,watch);
            } catch(Exception ignored) {
                try { vault.update(id,b -> { if(!Checks.terminal(b.optString("phase"))&&!b.optString("phase").equals("cancelled")) {
                    b.put("phase",b.has("submittedAt")?"uncertain":"failed").put("result","后台检查未完成，请在微信核对；没有自动重复提交。").put("notificationStatus","queued");
                }}); } catch(Exception ignoredAgain) {}
            } finally {
                try { NotificationResult.send(vault,id,b -> {
                    if(!new WorkflowController(this).notifications())throw new Exception("通知权限不可用。");
                    ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(id.hashCode(),notification(this,"晨充预约结果",b.optString("result","请在微信核对。")));
                }); } catch(Exception ignored) {}
                if(wake.isHeld())wake.release(); stopSelf(startId);
            }
        });
        return START_NOT_STICKY;
    }
    public IBinder onBind(Intent intent){return null;}
}
