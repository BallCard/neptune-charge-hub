package cn.neptune.local;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class Platform {
    interface Transport { JSONObject call(String endpoint, JSONObject input) throws Exception; }
    static final String[] PRICES = {"efee","eCharge","serviceCharge","efee_l","eCharge_l","serviceCharge_l"};
    private final Transport transport;
    Platform() { this(Platform::request); }
    Platform(Transport transport) { this.transport = transport; }
    static JSONObject request(String endpoint, JSONObject input) throws Exception {
        if (!Arrays.asList("getDeviceInfo","getUserInfo","getMsgs","isChargeing","beginCharge").contains(endpoint)) throw new Exception("不支持此平台请求。");
        HttpURLConnection connection = (HttpURLConnection)new URL("https://www.szlzxn.cn/wxn/" + endpoint).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10_000); connection.setReadTimeout(10_000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type","application/x-www-form-urlencoded; charset=UTF-8");
        StringJoiner encoded = new StringJoiner("&");
        for (Iterator<String> keys = input.keys(); keys.hasNext();) { String key = keys.next(); encoded.add(URLEncoder.encode(key,"UTF-8") + "=" + URLEncoder.encode(String.valueOf(input.get(key)),"UTF-8")); }
        byte[] bytes = encoded.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length);
        try {
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            if (connection.getResponseCode() != 200) throw new Exception("平台请求未完成，请在微信核对。");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) { byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) { if (out.size() + count > 1_000_000) throw new Exception("平台响应过大。"); out.write(buffer,0,count); }
            }
            return new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
        } catch (Exception e) { throw new Exception("平台请求失败或格式异常，请在微信核对。"); }
        finally { connection.disconnect(); }
    }
    private static JSONObject obj(JSONObject response) throws Exception {
        if (!Boolean.TRUE.equals(response.opt("success")) || !(response.opt("obj") instanceof JSONObject)) throw new Exception("平台只读核对失败。");
        return response.getJSONObject("obj");
    }
    JSONObject order(JSONObject account) throws Exception {
        JSONObject response = transport.call("isChargeing",new JSONObject().put("openId",account.getString("openId")).put("areaId",account.getInt("areaId")));
        if (!Boolean.TRUE.equals(response.opt("success")) || response.opt("obj") != JSONObject.NULL && !(response.opt("obj") instanceof JSONObject)) throw new Exception("本人订单查询失败。");
        return response.optJSONObject("obj");
    }
    static boolean matches(JSONObject order, JSONObject target) {
        if(order==null||!order.optString("devaddress").equals(target.optString("device")))return false;
        String port=String.valueOf(order.opt("devport")),expected=String.valueOf(target.opt("port"));
        if(!port.matches("[0-9]{1,2}")||!expected.matches("[0-9]{1,2}"))return false;
        return Integer.parseInt(port)==Integer.parseInt(expected);
    }
    JSONObject read(JSONObject account, JSONObject rawTarget) throws Exception {
        JSONObject target = Checks.target(rawTarget);
        if (target.has("areaId") && target.getInt("areaId") != account.getInt("areaId")) throw new Exception("二维码区域与当前账号不同，请在微信重新授权此区域。");
        JSONObject user = obj(transport.call("getUserInfo", new JSONObject().put("openId",account.getString("openId")).put("areaId",account.getInt("areaId"))));
        if (!String.valueOf(user.opt("employeeid")).equals(String.valueOf(account.getInt("employeeId")))) throw new Exception("本人账号核对失败。");
        int balance = Checks.number(user,"readyaccountmoney",0,10_000_000);
        JSONObject messages = obj(transport.call("getMsgs",new JSONObject().put("employeeid",account.getInt("employeeId")).put("areaid",account.getInt("areaId"))));
        if ("1".equals(String.valueOf(messages.opt("registrationCz"))) && !messages.optString("telphone").matches("[0-9]{11}")) throw new Exception("请先在微信绑定手机号。");
        JSONObject device = obj(transport.call("getDeviceInfo",new JSONObject().put("areaId",account.getInt("areaId")).put("devaddress",target.getString("device"))));
        if (!device.optString("devaddress").equals(target.getString("device"))) throw new Exception("设备身份核对失败。");
        for (String key : Arrays.asList("devtypeid","measure","isuse","countPay")) {
            int expected = key.equals("devtypeid") ? 40 : 1;
            if (Checks.number(device,key,0,100) != expected) throw new Exception("此设备或付款方式尚不支持自动执行，请在微信操作。");
        }
        int minutes = Checks.number(device,"ycTime",1,1440), prepay = Checks.number(device,"yk",1,10_000);
        Checks.number(device,"safeCharge",0,10_000);
        JSONObject pricing = new JSONObject(); for (String key : PRICES) pricing.put(key,Checks.number(device,key,0,10_000_000));
        String ports = Checks.text(device,"portstatur","[0-9]{1,99}",99); int port = Integer.parseInt(target.getString("port"));
        if (port > ports.length()) throw new Exception("插座号超出设备范围。");
        int open = Checks.number(device,"isWorkTime",0,1);
        JSONArray schemes = catalog(device);
        if (schemes.length() == 0) throw new Exception("此设备没有已验证的可选充电方案。");
        StringJoiner recipe = new StringJoiner("|");
        for (String key : PRICES) recipe.add(key + "=" + pricing.getInt(key));
        for (String key : Arrays.asList("devtypeid","measure","isuse","countPay","yuan5","yuan11","ycTime","yk","safeCharge")) recipe.add(key + "=" + device.optString(key,"0"));
        recipe.add("device=" + target.getString("device")); recipe.add("port=" + target.getString("port"));
        JSONObject order = order(account);
        JSONObject quote = new JSONObject().put("device",target.getString("device")).put("port",target.getString("port"))
            .put("checkedAt",Checks.iso(System.currentTimeMillis())).put("balanceCents",balance).put("businessOpen",open == 1)
            .put("available",ports.charAt(port - 1) == '0' && order == null).put("fingerprint",Checks.hash(recipe.toString())).put("schemes",schemes);
        return new JSONObject().put("quote",quote).put("device",device).put("order",order == null ? JSONObject.NULL : order).put("target",target);
    }
    static JSONArray catalog(JSONObject device) throws Exception {
        int minutes = Checks.number(device,"ycTime",1,1440), prepay = Checks.number(device,"yk",1,10_000);
        JSONArray out = new JSONArray();
        if (device.optInt("yuan5",0) == 1) out.put(scheme("full-stop","充满自停 · 最长" + minutes + "分钟",minutes,prepay,"充满或保护触发可提前停止，最终以平台订单为准。"));
        if (device.optInt("yuan11",0) == 1) for (int timed : new int[]{60,120,240,360}) {
            if (timed <= minutes) out.put(scheme("minutes-" + timed,timed + "分钟方案",timed,prepay,"保留智能断电保护；不能保证车辆一定充满。"));
        }
        return out;
    }
    static JSONObject scheme(String id,String title,int minutes,int prepay,String description) throws Exception {
        return new JSONObject().put("id",id).put("title",title).put("maxMinutes",minutes).put("prepayCents",prepay).put("description",description);
    }
    static JSONObject select(JSONObject quote, String id) throws Exception {
        JSONArray schemes = quote.getJSONArray("schemes");
        for (int i = 0; i < schemes.length(); i++) if (schemes.getJSONObject(i).getString("id").equals(id)) return schemes.getJSONObject(i);
        throw new Exception("所选方案已不可用，请重新核对插座。");
    }
    JSONObject payload(JSONObject account, JSONObject snapshot, String schemeId, int cap, String fingerprint) throws Exception {
        JSONObject quote = snapshot.getJSONObject("quote"), device = snapshot.getJSONObject("device"), target = snapshot.getJSONObject("target");
        JSONObject selected = select(quote,schemeId);
        if (!quote.getString("fingerprint").equals(fingerprint)) throw new Exception("方案或收费标准已改变，请重新确认。");
        if (snapshot.optJSONObject("order") != null || !quote.getBoolean("available")) throw new Exception("本人已有订单或插座被占用，未提交新充电。");
        if (!quote.getBoolean("businessOpen")) throw new Exception("平台尚未恢复营业。");
        if (selected.getInt("prepayCents") > cap) throw new Exception("预扣金额超过设置上限。");
        if (quote.getInt("balanceCents") < Math.max(200,selected.getInt("prepayCents"))) throw new Exception("本人账户余额不足，请在微信充值。");
        JSONObject data = new JSONObject().put("devaddress",target.getString("device")).put("port",target.getString("port"))
            .put("money",7).put("areaId",account.getInt("areaId")).put("openId",account.getString("openId"))
            .put("beforemoney",quote.getInt("balanceCents")).put("devtypeid",40).put("fullStop",0).put("payType",1)
            .put("safeOpen",0).put("safeCharge",device.get("safeCharge")).put("edtType",0)
            .put("yuan7",schemeId.equals("full-stop") ? 0 : selected.getInt("maxMinutes"));
        for (String key : new String[]{"efee","eCharge","serviceCharge"}) data.put(key,device.get(key));
        return data;
    }
    JSONObject submit(JSONObject payload) throws Exception { return transport.call("beginCharge",payload); }
    boolean acknowledge(JSONObject payload, String token) throws Exception {
        JSONObject result = transport.call("beginCharge",Checks.copy(payload).put("msgflag",token));
        return Boolean.TRUE.equals(result.opt("success"));
    }
}
