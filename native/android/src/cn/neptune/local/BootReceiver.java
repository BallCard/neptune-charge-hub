package cn.neptune.local;
import android.content.*;
public final class BootReceiver extends BroadcastReceiver {
    public void onReceive(Context context,Intent intent) {
        if (!java.util.Arrays.asList(Intent.ACTION_BOOT_COMPLETED,"android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED").contains(intent.getAction())) return;
        PendingResult pending=goAsync();
        new Thread(() -> { try { new AlarmScheduler(context).recover(new LocalVault(context)); } catch(Exception ignored) {} finally { pending.finish(); } },"neptune-restore").start();
    }
}
