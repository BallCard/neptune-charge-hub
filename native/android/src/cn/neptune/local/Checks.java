package cn.neptune.local;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;

final class Checks {
    static final ZoneOffset CN = ZoneOffset.ofHours(8);
    static String text(JSONObject obj, String key, String regex, int max) throws Exception {
        Object value = obj.opt(key);
        if (!(value instanceof String) || ((String)value).length() > max || !((String)value).matches(regex))
            throw new Exception("字段格式不正确，请重新核对。");
        return (String)value;
    }
    static int number(JSONObject obj, String key, int min, int max) throws Exception {
        Object raw = obj.opt(key);
        if (raw == null || !String.valueOf(raw).matches("[0-9]+")) throw new Exception("平台数字字段异常，已停止操作。");
        long value;
        try { value = Long.parseLong(String.valueOf(raw)); } catch (Exception e) { throw new Exception("平台数字字段异常，已停止操作。"); }
        if (value < min || value > max) throw new Exception("平台数字字段超出范围，已停止操作。");
        return (int)value;
    }
    static String iso(long millis) { return Instant.ofEpochMilli(millis).toString(); }
    static long at(String iso) throws Exception {
        try { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); }
        catch (Exception e) { throw new Exception("预约时间格式不正确。"); }
    }
    static long schedule(JSONObject input, long now) throws Exception {
        if (!Boolean.TRUE.equals(input.opt("confirmedPlug"))) throw new Exception("请确认车辆和充电器已接好。");
        long at = at(text(input,"scheduledAt",".{1,64}",64));
        if (at < now + 60_000 || at > now + 48 * 3600_000L) throw new Exception("请选择1分钟后至48小时内的预约时间。");
        return at;
    }
    static JSONObject target(JSONObject value) throws Exception {
        JSONObject result = new JSONObject().put("device", text(value,"device","[0-9]{8}",8))
            .put("port",text(value,"port","(0[1-9]|[1-9][0-9])",2));
        if (value.has("areaId")) result.put("areaId",number(value,"areaId",1,Integer.MAX_VALUE));
        return result;
    }
    static boolean active(String phase) {
        return Arrays.asList("scheduled","waiting","checking","submitting","pending","uncertain").contains(phase);
    }
    static boolean terminal(String phase) {
        return Arrays.asList("confirmed","already-charging","failed","uncertain","reviewed","rejected","missed","scheduling-failed").contains(phase);
    }
    static void review(JSONObject booking, boolean confirmedReview, JSONObject currentOrder) throws Exception {
        if (!confirmedReview || !booking.optString("phase").equals("uncertain")) throw new Exception("请先在微信核对结果不明的订单和扣款。");
        if (currentOrder != null) throw new Exception("本人仍有充电订单，请在微信结束或核对后再解除限制。");
        booking.put("phase","reviewed").put("reviewedAt",iso(System.currentTimeMillis()))
            .put("result","原启动结果未由执行器确认；你已在微信核对，平台当前没有本人充电订单。后续预约限制已解除，旧请求不会重发。");
    }
    static String hash(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder(); for (byte b : digest) out.append(String.format(Locale.ROOT,"%02x",b & 255)); return out.toString();
    }
    static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    static Map<String,String> query(String text) throws Exception {
        Map<String,String> result = new HashMap<>();
        for (String pair : text.split("&")) {
            if (pair.isEmpty()) continue; String[] parts = pair.split("=",2);
            String key = java.net.URLDecoder.decode(parts[0],"UTF-8"), value = parts.length > 1 ? java.net.URLDecoder.decode(parts[1],"UTF-8") : "";
            if (result.put(key,value) != null) throw new Exception("链接包含重复字段。");
        }
        return result;
    }
    static JSONObject account(String raw) throws Exception {
        if (raw.length() > 8192) throw new Exception("付款链接过长。");
        java.net.URI uri;
        try { uri = new java.net.URI(raw.trim()); } catch (Exception e) { throw new Exception("付款链接格式不正确。"); }
        if (!Arrays.asList("http","https").contains(uri.getScheme()) || !Arrays.asList("www.szlzxn.cn","szlzxn.cn").contains(uri.getHost()) ||
            !"/wx/indexn.html".equals(uri.getPath()) || uri.getUserInfo() != null || uri.getPort() != -1) throw new Exception("请复制尼普顿官方付款页的完整链接。");
        Map<String,String> query = query(uri.getRawQuery() == null ? "" : uri.getRawQuery());
        String fragment = uri.getRawFragment() == null ? "" : uri.getRawFragment();
        Map<String,String> tail = query(fragment.contains("?") ? fragment.substring(fragment.indexOf('?') + 1) : "");
        JSONObject obj = new JSONObject(query);
        String device = text(obj,"devaddress","[0-9]{10}",10);
        String portRaw = tail.get("socketNumber");
        if (portRaw == null || !portRaw.matches("[0-9]{1,2}")) throw new Exception("付款链接缺少插座号。");
        String port = String.format(Locale.ROOT,"%02d",Integer.parseInt(portRaw));
        if (!device.endsWith(port) || "00".equals(port)) throw new Exception("付款链接的设备与插座不一致。");
        return new JSONObject().put("openId",text(obj,"openId","[A-Za-z0-9_-]{1,256}",256))
            .put("employeeId",number(obj,"employeeId",1,Integer.MAX_VALUE)).put("areaId",number(obj,"areaid",1,Integer.MAX_VALUE))
            .put("defaultTarget", new JSONObject().put("device",device.substring(0,8)).put("port",port));
    }
    static JSONObject mail(JSONObject value) throws Exception {
        String emailPattern = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,63}";
        String host = text(value,"host","[A-Za-z0-9][A-Za-z0-9.-]{1,251}[A-Za-z0-9]",253);
        if (!host.contains(".") || host.endsWith(".local") || host.equals("localhost") || host.matches("[0-9.]+")) throw new Exception("请填写邮件服务商的SMTP域名。");
        int port = number(value,"port",465,465);
        String password = text(value,"password","[^\\r\\n\\x00]{1,256}",256);
        return new JSONObject().put("host",host).put("port",port).put("sender",text(value,"sender",emailPattern,254))
            .put("recipient",text(value,"recipient",emailPattern,254)).put("password",password);
    }
}
