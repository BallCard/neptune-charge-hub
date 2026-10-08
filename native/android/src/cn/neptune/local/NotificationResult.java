package cn.neptune.local;

import org.json.*;

/** Result delivery is independent of the already persisted charging outcome. */
final class NotificationResult {
    interface Delivery { void post(JSONObject booking) throws Exception; }
    static boolean pending(JSONObject booking) {
        String state=booking.optString("notificationStatus");
        return Checks.terminal(booking.optString("phase")) && !state.equals("shown") && !state.equals("not-required") && booking.optInt("notificationAttempts",0)<3;
    }
    static void send(ChargeRunner.Repository repository,String id,Delivery delivery) throws Exception {
        JSONObject booking=repository.booking(id);
        if(!pending(booking))return;
        repository.update(id,b->b.put("notificationAttempts",b.optInt("notificationAttempts",0)+1));
        try {
            delivery.post(booking);
            repository.update(id,b->b.put("notificationStatus","shown"));
        } catch(Exception ignored) {
            repository.update(id,b->b.put("notificationStatus","failed"));
        }
    }
}
