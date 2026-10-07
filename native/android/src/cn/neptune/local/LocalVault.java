package cn.neptune.local;

import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;

final class LocalVault implements ChargeRunner.Repository {
    interface Edit { void apply(JSONObject root) throws Exception; }
    private static final Object LOCK = new Object();
    private final AtomicFile file;
    LocalVault(Context context) { file = new AtomicFile(new File(context.getFilesDir(),"vault-v2.enc")); }
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("neptune-local-v2")) {
            KeyGenerator generator = KeyGenerator.getInstance("AES","AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("neptune-local-v2",KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setUserAuthenticationRequired(false).build()); generator.generateKey();
        }
        return (javax.crypto.SecretKey)store.getKey("neptune-local-v2",null);
    }
    JSONObject read() throws Exception {
        synchronized (LOCK) {
            if (!file.getBaseFile().exists()) return new JSONObject().put("version",2).put("bookings",new JSONArray());
            byte[] raw = file.readFully(); if (raw.length > 2_000_000) throw new Exception("本机数据文件异常。");
            JSONObject envelope = new JSONObject(new String(raw,StandardCharsets.UTF_8));
            if (envelope.getInt("version") != 2) throw new Exception("本机数据版本不支持。");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.getDecoder().decode(envelope.getString("iv"))));
            cipher.updateAAD("neptune-native-v2".getBytes(StandardCharsets.UTF_8));
            return new JSONObject(new String(cipher.doFinal(Base64.getDecoder().decode(envelope.getString("cipher"))),StandardCharsets.UTF_8));
        }
    }
    void edit(Edit edit) throws Exception {
        synchronized (LOCK) { JSONObject root = read(); edit.apply(root); write(root); }
    }
    private void write(JSONObject data) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key());
        cipher.updateAAD("neptune-native-v2".getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject().put("version",2).put("iv",Base64.getEncoder().encodeToString(cipher.getIV()))
            .put("cipher",Base64.getEncoder().encodeToString(cipher.doFinal(data.toString().getBytes(StandardCharsets.UTF_8))));
        FileOutputStream out = null;
        try { out = file.startWrite(); out.write(envelope.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(out); }
        catch (Exception e) { if (out != null) file.failWrite(out); throw e; }
    }
    static JSONObject find(JSONObject root,String id) throws Exception {
        JSONArray list = root.getJSONArray("bookings");
        for (int i = 0; i < list.length(); i++) if (list.getJSONObject(i).getString("id").equals(id)) return list.getJSONObject(i);
        throw new Exception("预约不存在。");
    }
    public JSONObject booking(String id) throws Exception { synchronized (LOCK) { return Checks.copy(find(read(),id)); } }
    public void update(String id, ChargeRunner.Edit edit) throws Exception { edit(root -> edit.apply(find(root,id))); }
}
