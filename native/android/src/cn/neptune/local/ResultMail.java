package cn.neptune.local;

import org.json.*;
import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

final class ResultMail implements ChargeRunner.Notifier {
    interface ConnectionFactory { SSLSocket open(String host,int port) throws Exception; }
    private final ConnectionFactory connectionFactory;
    ResultMail() { this((host,port) -> {
        SSLSocket socket = (SSLSocket)SSLSocketFactory.getDefault().createSocket();
        SSLParameters parameters = socket.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS"); socket.setSSLParameters(parameters);
        socket.connect(new InetSocketAddress(host,port),10_000); socket.setSoTimeout(15_000); socket.startHandshake(); return socket;
    }); }
    ResultMail(ConnectionFactory factory) { connectionFactory = factory; }
    private static int reply(BufferedReader reader) throws Exception {
        int code = -1;
        for (int lines = 0; lines < 100; lines++) {
            String line = reader.readLine();
            if (line == null || line.length() < 3 || line.length() > 4096 || !line.substring(0,3).matches("[0-9]{3}")) throw new IOException("SMTP reply unavailable");
            int next = Integer.parseInt(line.substring(0,3));
            if (code != -1 && code != next) throw new IOException("SMTP reply changed"); code = next;
            if (line.length() == 3 || line.charAt(3) == ' ') return code;
            if (line.charAt(3) != '-') throw new IOException("SMTP reply invalid");
        }
        throw new IOException("SMTP reply too large");
    }
    private static void command(BufferedWriter writer, BufferedReader reader, String value, int expected) throws Exception {
        writer.write(value + "\r\n"); writer.flush(); if (reply(reader) != expected) throw new IOException("SMTP command refused");
    }
    static String base64(String value) { return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)); }
    static String body(JSONObject booking) throws Exception {
        String at = OffsetDateTime.parse(booking.getString("scheduledAt")).withOffsetSameInstant(Checks.CN).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
        return "预约时间：" + at + "（北京时间）\n设备：" + booking.getString("device") + "，插座：" + booking.getString("port") +
            "\n方案：" + booking.getString("schemeTitle") + "\n结果：" + booking.getString("result") +
            "\n\n请在微信查看实际订单和功率。邮件报告启动检查结果，不表示电池已经充满。结果不明时不会重新新建开电请求。";
    }
    public void send(ChargeRunner.Repository repository,String id) throws Exception {
        JSONObject booking = repository.booking(id);
        if(!booking.has("mail")||booking.optString("notificationMode").equals("local")) { repository.update(id,b->b.put("mailStatus","not-required"));return; }
        String old = booking.optString("mailStatus","queued");
        if (Arrays.asList("sent","uncertain","not-required").contains(old) || booking.optInt("mailAttempts",0) >= 3) return;
        if ("sending".equals(booking.optString("mailPhase"))) { repository.update(id,b -> b.put("mailStatus","uncertain").put("mailPhase","uncertain")); return; }
        JSONObject config = Checks.mail(booking.getJSONObject("mail"));
        repository.update(id,b -> b.put("mailStatus","queued").put("mailPhase","connecting").put("mailAttempts",b.optInt("mailAttempts",0) + 1));
        boolean sending = false;
        try (SSLSocket socket = connectionFactory.open(config.getString("host"),config.getInt("port"))) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII));
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.US_ASCII));
            if (reply(reader) != 220) throw new IOException("SMTP greeting refused");
            command(writer,reader,"EHLO neptune.local",250); command(writer,reader,"AUTH LOGIN",334);
            command(writer,reader,base64(config.getString("sender")),334); command(writer,reader,base64(config.getString("password")),235);
            command(writer,reader,"MAIL FROM:<" + config.getString("sender") + ">",250);
            writer.write("RCPT TO:<" + config.getString("recipient") + ">\r\n"); writer.flush();
            int rcpt = reply(reader); if (rcpt != 250 && rcpt != 251) throw new IOException("SMTP recipient refused");
            command(writer,reader,"DATA",354);
            repository.update(id,b -> b.put("mailPhase","sending")); sending = true;
            String subject = "【晨充】" + (Arrays.asList("confirmed","already-charging").contains(booking.getString("phase")) ? "充电启动已确认" : "充电需要核对");
            writer.write("From: <" + config.getString("sender") + ">\r\nTo: <" + config.getString("recipient") + ">\r\n");
            writer.write("Subject: =?UTF-8?B?" + base64(subject) + "?=\r\nMessage-ID: <neptune-" + id + "@neptune.local>\r\n");
            writer.write("Date: " + DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now(ZoneOffset.UTC)) + "\r\n");
            writer.write("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
            writer.write(Base64.getMimeEncoder(76,"\r\n".getBytes(StandardCharsets.US_ASCII)).encodeToString(body(booking).getBytes(StandardCharsets.UTF_8)));
            writer.write("\r\n.\r\n"); writer.flush();
            int code = reply(reader);
            if (code != 250) { sending = false; throw new IOException("SMTP message rejected"); }
            repository.update(id,b -> b.put("mailStatus","sent").put("mailPhase","sent"));
            try { writer.write("QUIT\r\n"); writer.flush(); } catch (Exception ignored) { }
        } catch (Exception error) {
            final boolean uncertain = sending;
            repository.update(id,b -> b.put("mailStatus",uncertain ? "uncertain" : "failed").put("mailPhase",uncertain ? "uncertain" : "failed"));
        }
    }
}
