package cn.neptune.local;

import org.json.*;
import java.io.*;
import java.util.*;
import javax.net.ssl.*;

public final class CoreTests {
    interface Test { void run() throws Exception; }
    static int count=0;
    static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    static void rejects(Test test) throws Exception {try{test.run();}catch(Exception expected){return;}throw new AssertionError("Expected rejection");}
    static void test(String name,Test test) throws Exception {test.run();count++;System.out.println("PASS "+name);}
    static JSONObject target() throws Exception{return new JSONObject().put("device","12345678").put("port","06");}
    static JSONObject account() throws Exception{return new JSONObject().put("openId","synthetic-account").put("employeeId",123).put("areaId",6).put("defaultTarget",target());}
    static JSONObject mail() throws Exception{return new JSONObject().put("host","smtp.example.org").put("port",465).put("sender","test@example.org").put("recipient","student@example.org").put("password","synthetic-auth-only");}
    static class Time implements ChargeRunner.Clock {long value=1_800_000_000_000L;public long now(){return value;}public void sleep(long millis){value+=millis;}}
    static class Store implements ChargeRunner.Repository {
        JSONObject value;
        public JSONObject booking(String id)throws Exception{return Checks.copy(value);}
        public void update(String id,ChargeRunner.Edit edit)throws Exception{JSONObject next=Checks.copy(value);edit.apply(next);value=next;}
    }
    static class FakePlatform implements Platform.Transport {
        JSONObject device=new JSONObject(),order;
        int created=0,ackCalls=0,readCalls=0,closedReads=0;
        String scenario="success";
        FakePlatform()throws Exception{
            device.put("devaddress","12345678").put("devtypeid",40).put("measure",1).put("isuse",1).put("countPay",1).put("yuan5",1).put("ycTime",480)
                .put("yk",200).put("safeCharge",9).put("portstatur","000000000000").put("isWorkTime",1);
            for(String field:Platform.PRICES)device.put(field,55);
        }
        public JSONObject call(String endpoint,JSONObject input)throws Exception{
            JSONObject result=new JSONObject().put("success",true);
            if(endpoint.equals("getUserInfo"))return result.put("obj",new JSONObject().put("employeeid",123).put("readyaccountmoney",639));
            if(endpoint.equals("getMsgs"))return result.put("obj",new JSONObject().put("registrationCz",1).put("telphone","00000000000"));
            if(endpoint.equals("getDeviceInfo")){readCalls++;JSONObject copy=Checks.copy(device);if(closedReads>0){closedReads--;copy.put("isWorkTime",0);}return result.put("obj",copy);}
            if(endpoint.equals("isChargeing"))return result.put("obj",order==null?JSONObject.NULL:order);
            if(endpoint.equals("beginCharge")){
                if(input.has("msgflag")){check(input.getString("msgflag").equals("same-request"),"Must only acknowledge original token");ackCalls++;return result.put("success",!scenario.equals("no-ack")).put("obj",true);}
                created++;order=new JSONObject().put("devaddress",input.getString("devaddress")).put("devport",input.getString("port"));
                if(scenario.equals("lost"))throw new IOException("synthetic lost response");
                if(scenario.equals("rejected")){order=null;return result.put("success",false).put("obj",JSONObject.NULL);}
                return result.put("obj",scenario.equals("bad-token")?new JSONObject():"same-request");
            }
            throw new AssertionError("Unapproved endpoint");
        }
    }
    static class Rig {
        final FakePlatform fake=new FakePlatform();final Platform platform=new Platform(fake);final Store store=new Store();final Time time=new Time();int notices=0;boolean brokenMail=false;
        Rig()throws Exception{
            JSONObject quote=platform.read(account(),target()).getJSONObject("quote");
            store.value=new JSONObject().put("id","00000000-0000-4000-8000-000000000001").put("device","12345678").put("port","06")
                .put("account",account()).put("mail",mail()).put("scheduledAt",Checks.iso(time.value)).put("schemeId","full-stop").put("schemeTitle","充满自停 · 最长480分钟")
                .put("maxMinutes",480).put("maxPrepayCents",200).put("quoteFingerprint",quote.getString("fingerprint")).put("phase","scheduled").put("result","").put("mailStatus","queued");
        }
        ChargeRunner runner(){return new ChargeRunner(store,platform,(repository,id)->{if(brokenMail)throw new IOException("isolated mail failure");
            if(!repository.booking(id).optString("mailStatus").equals("sent")){notices++;repository.update(id,b->b.put("mailStatus","sent"));}},time);}
        void run()throws Exception{runner().run(store.value.getString("id"),false);}
    }
    static class Socket extends SSLSocket {
        final ByteArrayOutputStream writes=new ByteArrayOutputStream();final InputStream reads;
        Socket(String responses){reads=new ByteArrayInputStream(responses.getBytes(java.nio.charset.StandardCharsets.US_ASCII));}
        public InputStream getInputStream(){return reads;}public OutputStream getOutputStream(){return writes;}public void close(){}
        public String[] getSupportedCipherSuites(){return new String[0];}public String[] getEnabledCipherSuites(){return new String[0];}public void setEnabledCipherSuites(String[] v){}
        public String[] getSupportedProtocols(){return new String[0];}public String[] getEnabledProtocols(){return new String[0];}public void setEnabledProtocols(String[] v){}
        public SSLSession getSession(){return null;}public void addHandshakeCompletedListener(HandshakeCompletedListener l){}public void removeHandshakeCompletedListener(HandshakeCompletedListener l){}
        public void startHandshake(){}public void setUseClientMode(boolean v){}public boolean getUseClientMode(){return true;}
        public void setNeedClientAuth(boolean v){}public boolean getNeedClientAuth(){return false;}public void setWantClientAuth(boolean v){}public boolean getWantClientAuth(){return false;}
        public void setEnableSessionCreation(boolean v){}public boolean getEnableSessionCreation(){return false;}
    }
    public static void main(String[] args)throws Exception{
        test("local notification mode needs no SMTP and never opens email transport",()->{Rig r=new Rig();r.store.value.remove("mail");r.store.value.put("notificationMode","local");r.run();check(r.fake.created==1&&r.store.value.getString("phase").equals("confirmed")&&r.store.value.getString("mailStatus").equals("not-required")&&r.notices==0,"Local result without mail");check(r.store.value.getString("notificationStatus").equals("queued"),"Queued phone notice");new ResultMail((h,p)->{throw new AssertionError("SMTP must not open");}).send(r.store,r.store.value.getString("id"));});
        test("phone notification failure cannot change charging outcome and retry cannot recharge",()->{Rig r=new Rig();r.store.value.remove("mail");r.store.value.put("notificationMode","local");r.run();String id=r.store.value.getString("id"),result=r.store.value.getString("result");NotificationResult.send(r.store,id,b->{throw new IOException("Permission removed");});check(r.store.value.getString("phase").equals("confirmed")&&r.store.value.getString("result").equals(result)&&r.store.value.getString("notificationStatus").equals("failed"),"Preserved outcome");r.runner().run(id,true);int[] posts={0};NotificationResult.send(r.store,id,b->posts[0]++);NotificationResult.send(r.store,id,b->posts[0]++);check(r.fake.created==1&&posts[0]==1&&r.store.value.getString("notificationStatus").equals("shown"),"Only result delivery retries");});
        test("phone result delivery excludes future and cancelled appointments and bounds failures",()->{Rig r=new Rig();String id=r.store.value.getString("id");int[] posts={0};NotificationResult.send(r.store,id,b->posts[0]++);r.store.value.put("phase","cancelled");NotificationResult.send(r.store,id,b->posts[0]++);check(posts[0]==0,"No premature result");r.store.value.put("phase","failed").put("notificationStatus","queued");for(int i=0;i<5;i++)NotificationResult.send(r.store,id,b->{posts[0]++;throw new IOException("offline");});check(posts[0]==3,"Bounded delivery attempts");});
        test("scheme catalog comes from actual supported flags",()->{FakePlatform fake=new FakePlatform();check(Platform.catalog(fake.device).length()==1,"Only full stop initially");fake.device.put("yuan11",1);check(Platform.catalog(fake.device).length()==5,"Four timed options");fake.device.put("yuan5",0).put("yuan11",0);check(Platform.catalog(fake.device).length()==0,"No invented options");});
        test("timed payload preserves verified rates and safe stop mode",()->{FakePlatform fake=new FakePlatform();fake.device.put("yuan11",1);Platform p=new Platform(fake);JSONObject snapshot=p.read(account(),target()),quote=snapshot.getJSONObject("quote");JSONObject data=p.payload(account(),snapshot,"minutes-120",200,quote.getString("fingerprint"));check(data.getInt("money")==7&&data.getInt("yuan7")==120&&data.getInt("fullStop")==0,"Exact timed protocol");rejects(()->p.payload(account(),snapshot,"minutes-999",200,quote.getString("fingerprint")));rejects(()->p.payload(account(),snapshot,"full-stop",199,quote.getString("fingerprint")));});
        test("booking window requires confirmed plug and 48 hour bound",()->{JSONObject input=new JSONObject().put("confirmedPlug",true).put("scheduledAt",Checks.iso(100_000));check(Checks.schedule(input,0)==100_000,"Valid schedule");input.put("confirmedPlug",false);rejects(()->Checks.schedule(input,0));input.put("confirmedPlug",true).put("scheduledAt",Checks.iso(48*3600_000L+1));rejects(()->Checks.schedule(input,0));});
        test("confirmed start submits once and sends success notification",()->{Rig r=new Rig();r.run();check(r.fake.created==1&&r.fake.ackCalls==1&&r.store.value.getString("phase").equals("confirmed")&&r.notices==1,"Complete success: phase="+r.store.value.optString("phase")+" created="+r.fake.created+" ack="+r.fake.ackCalls+" notices="+r.notices+" result="+r.store.value.optString("result"));r.run();check(r.fake.created==1&&r.notices==1,"No duplicate transaction or mail");});
        test("future appointment never starts early",()->{Rig r=new Rig();r.store.value.put("scheduledAt",Checks.iso(r.time.value+60000));r.run();check(r.fake.created==0&&r.notices==0,"Future untouched");});
        test("closed station waits and gives device 30 seconds",()->{Rig r=new Rig();r.fake.closedReads=2;long start=r.time.value;r.run();check(r.fake.created==1&&r.time.value>=start+60000,"Station and startup wait");});
        test("changed rates abort before transaction",()->{Rig r=new Rig();r.fake.device.put("efee",99);r.run();check(r.fake.created==0&&r.store.value.getString("phase").equals("failed")&&r.notices==1,"Changed tariff rejected");});
        test("occupied port and another own order cannot be charged",()->{Rig r=new Rig();r.fake.device.put("portstatur","000001000000");r.run();check(r.fake.created==0,"No occupied submission");Rig other=new Rig();other.fake.order=new JSONObject().put("devaddress","87654321").put("devport",1);other.run();check(other.fake.created==0,"No competing order submission");});
        test("existing own target order is reported without new charge",()->{Rig r=new Rig();r.fake.order=new JSONObject().put("devaddress","12345678").put("devport",6);r.run();check(r.fake.created==0&&r.store.value.getString("phase").equals("already-charging")&&r.notices==1,"Existing order reported");});
        test("lost submission response stays uncertain and never retries",()->{Rig r=new Rig();r.fake.scenario="lost";r.run();check(r.fake.created==1&&r.store.value.getString("phase").equals("uncertain"),"Durable consumed claim");r.run();check(r.fake.created==1&&r.notices==1,"No retry on restart");});
        test("order alone is insufficient without original request acknowledgement",()->{Rig r=new Rig();r.fake.scenario="no-ack";r.run();check(r.fake.created==1&&r.store.value.getString("phase").equals("uncertain"),"No false confirmation");});
        test("malformed token and explicit rejection do not resubmit",()->{for(String scenario:new String[]{"bad-token","rejected"}){Rig r=new Rig();r.fake.scenario=scenario;r.run();r.run();check(r.fake.created==1&&r.fake.ackCalls==0,"No second request");}});
        test("crash during submission without token never creates another transaction",()->{Rig r=new Rig();r.store.value.put("phase","submitting").put("submittedAt",Checks.iso(r.time.value));r.run();check(r.fake.created==0&&r.store.value.getString("phase").equals("uncertain"),"Consumed claim retained");});
        test("recovered pending request uses original token only",()->{Rig r=new Rig();JSONObject snapshot=r.platform.read(account(),target());r.store.value.put("phase","pending").put("msgflag","same-request").put("payload",r.platform.payload(account(),snapshot,"full-stop",200,snapshot.getJSONObject("quote").getString("fingerprint")));r.fake.order=new JSONObject().put("devaddress","12345678").put("devport",6);r.run();check(r.fake.created==0&&r.fake.ackCalls==1&&r.store.value.getString("phase").equals("confirmed"),"Original token recovery");});
        test("cancelled and missed appointments cannot create requests",()->{Rig cancelled=new Rig();cancelled.store.value.put("phase","cancelled");cancelled.run();check(cancelled.fake.created==0&&cancelled.notices==0,"Cancelled quiet");Rig missed=new Rig();missed.time.value+=11*60000;missed.run();check(missed.fake.created==0&&missed.store.value.getString("phase").equals("missed")&&missed.notices==1,"Missed notification");});
        test("watchdog cannot start charging and reports missing execution",()->{Rig r=new Rig();r.time.value+=15*60000;r.runner().run(r.store.value.getString("id"),true);check(r.fake.created==0&&r.store.value.getString("phase").equals("missed"),"Watch only");});
        test("mail failure must preserve confirmed charging result",()->{Rig r=new Rig();r.brokenMail=true;r.run();check(r.store.value.getString("phase").equals("confirmed")&&r.store.value.getString("mailStatus").equals("failed")&&r.fake.created==1,"Notification does not alter payment outcome");r.run();check(r.fake.created==1,"Retry only mail");});
        test("manual review requires no current order and never retries consumed charging",()->{Rig r=new Rig();r.fake.scenario="lost";r.run();rejects(()->Checks.review(r.store.value,false,null));rejects(()->Checks.review(r.store.value,true,r.fake.order));r.fake.order=null;Checks.review(r.store.value,true,null);check(r.store.value.getString("phase").equals("reviewed")&&!Checks.active("reviewed"),"Review releases only future booking lock");r.run();check(r.fake.created==1,"Old request never repeated after review");});
        test("config backups are encrypted and reject wrong password or tampering",()->{JSONObject config=new JSONObject().put("account",account()).put("mail",mail());JSONObject encrypted=BackupCodec.encrypt(config,"Test-only-2026!");check(!encrypted.toString().contains("synthetic-account")&&!encrypted.toString().contains("synthetic-auth-only"),"No plaintext secrets");check(BackupCodec.decrypt(encrypted,"Test-only-2026!").getJSONObject("account").getString("openId").equals("synthetic-account"),"Roundtrip");rejects(()->BackupCodec.decrypt(encrypted,"Wrong-only-2026!"));encrypted.put("iterations",1);rejects(()->BackupCodec.decrypt(encrypted,"Test-only-2026!"));});
        String replies="220 ready\r\n250-test\r\n250 AUTH LOGIN\r\n334 user\r\n334 pass\r\n235 ok\r\n250 from\r\n250 recipient\r\n354 data\r\n";
        test("SMTP acceptance is recorded once without claiming inbox delivery",()->{Rig r=new Rig();r.store.value.put("phase","confirmed").put("result","已确认启动");Socket socket=new Socket(replies+"250 accepted\r\n");int[] opens={0};ResultMail notifier=new ResultMail((host,port)->{opens[0]++;return socket;});notifier.send(r.store,r.store.value.getString("id"));notifier.send(r.store,r.store.value.getString("id"));check(opens[0]==1&&r.store.value.getString("mailStatus").equals("sent"),"One acceptance");check(socket.writes.toString("US-ASCII").contains("Message-ID: <neptune-"),"Stable message identity");});
        test("SMTP lost DATA reply remains uncertain and is never resent",()->{Rig r=new Rig();r.store.value.put("phase","uncertain");int[] opens={0};ResultMail notifier=new ResultMail((host,port)->{opens[0]++;return new Socket(replies);});notifier.send(r.store,r.store.value.getString("id"));notifier.send(r.store,r.store.value.getString("id"));check(opens[0]==1&&r.store.value.getString("mailStatus").equals("uncertain"),"No uncertain resend");});
        test("SMTP pre-send failures may retry only up to three times",()->{Rig r=new Rig();int[] opens={0};ResultMail notifier=new ResultMail((host,port)->{opens[0]++;throw new IOException("isolated offline");});for(int i=0;i<5;i++)notifier.send(r.store,r.store.value.getString("id"));check(opens[0]==3&&r.store.value.getString("mailStatus").equals("failed"),"Bounded retry");});
        test("email and payment imports reject injection or foreign origins",()->{JSONObject bad=mail();bad.put("recipient","student@example.org\r\nBcc:x@example.org");rejects(()->Checks.mail(bad));bad.put("recipient","student@example.org").put("port",25);rejects(()->Checks.mail(bad));rejects(()->Checks.account("https://evil.example/wx/indexn.html?openId=synthetic-account"));});
        System.out.println(count+" isolated Java checks passed; no real platform requests or emails sent.");
    }
}
