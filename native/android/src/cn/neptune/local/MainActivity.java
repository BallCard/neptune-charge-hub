package cn.neptune.local;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private WebView web;
    private WorkflowController controller;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> files;
    private byte[] backupBytes;
    private String restorePassword;
    static final String ORIGIN="https://app.neptune.local";
    public void onCreate(Bundle saved) {
        super.onCreate(saved);ChargeService.channels(this);controller=new WorkflowController(this);
        web=new WebView(this);setContentView(web);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);
        web.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        web.addJavascriptInterface(new Bridge(),"NeptuneNative");
        web.setWebViewClient(new WebViewClient(){
            public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !request.getUrl().toString().startsWith(ORIGIN+"/");}
            public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(!"https".equals(uri.getScheme())||!"app.neptune.local".equals(uri.getHost())||!"GET".equals(request.getMethod()))return denied();
                String path=uri.getPath();if(path==null)return denied();if(path.equals("/"))path="/index.html";
                if(path.contains("..")||path.contains("\\")||path.indexOf('\0')>=0||path.startsWith("/downloads/"))return denied();
                String type=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".webmanifest")?"application/manifest+json":path.endsWith(".html")?"text/html":"text/plain";
                try{
                    java.util.Map<String,String> headers=new java.util.HashMap<>();headers.put("X-Content-Type-Options","nosniff");headers.put("Referrer-Policy","no-referrer");
                    headers.put("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'");
                    return new WebResourceResponse(type,"UTF-8",200,"OK",headers,getAssets().open("web"+path));
                }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
            }
            public void onPageFinished(WebView view,String url){if(url.startsWith(ORIGIN+"/"))web.evaluateJavascript("window.dispatchEvent(new Event('neptune-native-ready'))",null);}
        });
        web.setWebChromeClient(new WebChromeClient(){
            public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(files!=null)files.onReceiveValue(null);files=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                try{startActivityForResult(intent,101);}catch(Exception e){files.onReceiveValue(null);files=null;}return true;
            }
            public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确认",(d,w)->result.confirm()).setNegativeButton("取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
        });
        web.loadUrl(ORIGIN+"/");
    }
    private static WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    protected void onResume(){super.onResume();if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('neptune-native-ready'))",null);}
    protected void onDestroy(){if(files!=null)files.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("NeptuneNative");web.destroy();}worker.shutdown();super.onDestroy();}
    public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);web.evaluateJavascript("window.dispatchEvent(new Event('neptune-native-ready'))",null);}
    private void reply(String id,JSONObject state,String error){
        try{JSONObject message=new JSONObject().put("id",id);if(error==null)message.put("state",state);else message.put("error",error);
            String js="window.dispatchEvent(new CustomEvent('neptune-native-result',{detail:"+message.toString()+"}))";
            runOnUiThread(()->{if(!isFinishing())web.evaluateJavascript(js,null);});
        }catch(Exception ignored){}
    }
    final class Bridge {
        @JavascriptInterface public void request(String raw){
            if(raw==null||raw.length()>20000)return;
            worker.submit(()->{
                String id="";
                try{JSONObject request=new JSONObject(raw);id=Checks.text(request,"id","[0-9a-fA-F-]{36}",36);String action=Checks.text(request,"action","[A-Za-z]{1,40}",40);JSONObject input=request.optJSONObject("payload");if(input==null)input=new JSONObject();
                    if(action.equals("openAlarmSettings")){runOnUiThread(()->{if(Build.VERSION.SDK_INT>=31)startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));});}
                    else if(action.equals("openNotificationSettings")){runOnUiThread(()->{if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},102);else startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));});}
                    else if(action.equals("openBatterySettings")){runOnUiThread(()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));}
                    else if(action.equals("exportBackup")){runOnUiThread(()->passwordDialog(false));}
                    else if(action.equals("restoreBackup")){runOnUiThread(()->passwordDialog(true));}
                    else{reply(id,controller.action(action,input),null);return;}
                    reply(id,controller.status(),null);
                }catch(Exception error){reply(id,null,"操作未完成："+(error.getMessage()==null?"请核对输入或本机权限。":error.getMessage()));}
            });
        }
    }
    private void passwordDialog(boolean restore){
        EditText password=new EditText(this);password.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);password.setHint("至少8个字符，请自行保管");
        new AlertDialog.Builder(this).setTitle(restore?"恢复配置备份":"设置配置备份密码").setMessage("账号和邮件配置将加密保存。备份不登记任何预约，密码遗失无法找回。").setView(password)
            .setNegativeButton("取消",null).setPositiveButton("继续",(dialog,which)->{
                String secret=password.getText().toString();password.setText("");
                if(secret.length()<8||secret.length()>256){Toast.makeText(this,"密码长度不正确。",Toast.LENGTH_LONG).show();return;}
                if(restore){restorePassword=secret;startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),104);}
                else worker.submit(()->{try{JSONObject data=new LocalVault(this).read(),config=new JSONObject();if(data.has("account"))config.put("account",data.getJSONObject("account"));if(data.has("mail"))config.put("mail",data.getJSONObject("mail"));
                    backupBytes=BackupCodec.encrypt(config,secret).toString().getBytes(StandardCharsets.UTF_8);
                    runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"neptune-encrypted-config.json"),103));
                }catch(Exception e){runOnUiThread(()->Toast.makeText(this,"备份未能生成。",Toast.LENGTH_LONG).show());}});
            }).show();
    }
    protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==101&&files!=null){files.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);files=null;return;}
        if(request==103){byte[] bytes=backupBytes;backupBytes=null;if(result==RESULT_OK&&data!=null&&bytes!=null)worker.submit(()->{try(OutputStream out=getContentResolver().openOutputStream(data.getData())){out.write(bytes);runOnUiThread(()->Toast.makeText(this,"加密配置备份已保存。",Toast.LENGTH_LONG).show());}catch(Exception e){runOnUiThread(()->Toast.makeText(this,"备份未能保存。",Toast.LENGTH_LONG).show());}});}
        if(request==104){String secret=restorePassword;restorePassword=null;if(result==RESULT_OK&&data!=null&&secret!=null)worker.submit(()->{try(InputStream in=getContentResolver().openInputStream(data.getData())){
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>1_000_000)throw new Exception("文件过大。");bytes.write(buffer,0,n);}
            JSONObject config=BackupCodec.decrypt(new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8)),secret);
            if(config.has("account")){JSONObject account=config.getJSONObject("account");Checks.text(account,"openId","[A-Za-z0-9_-]{1,256}",256);Checks.number(account,"employeeId",1,Integer.MAX_VALUE);Checks.number(account,"areaId",1,Integer.MAX_VALUE);Checks.target(account.getJSONObject("defaultTarget"));}
            if(config.has("mail"))Checks.mail(config.getJSONObject("mail"));
            new LocalVault(this).edit(root->{if(root.has("account")||root.has("mail"))throw new Exception("请在空的本机空间恢复，避免覆盖已有配置。");if(config.has("account"))root.put("account",config.getJSONObject("account"));if(config.has("mail"))root.put("mail",config.getJSONObject("mail"));});
            runOnUiThread(()->{Toast.makeText(this,"配置已恢复；没有自动登记预约。",Toast.LENGTH_LONG).show();web.evaluateJavascript("window.dispatchEvent(new Event('neptune-native-ready'))",null);});
        }catch(Exception e){runOnUiThread(()->Toast.makeText(this,"恢复未完成，请核对密码、文件和当前空间。",Toast.LENGTH_LONG).show());}});}
    }
}
