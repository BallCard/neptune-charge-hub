package cn.neptune.local;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

final class BackupCodec {
    private static final int ITERATIONS=310000;
    static SecretKeySpec key(String password,byte[] salt) throws Exception {
        if(password.length()<8||password.length()>256)throw new Exception("备份密码需要8–256个字符。");
        PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,ITERATIONS,256);
        try{return new SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(),"AES");}finally{spec.clearPassword();}
    }
    static JSONObject encrypt(JSONObject config,String password) throws Exception {
        byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(password,salt));
        cipher.updateAAD("neptune-config-backup:1".getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("format","neptune-native-config-backup").put("version",1).put("iterations",ITERATIONS)
            .put("salt",Base64.getEncoder().encodeToString(salt)).put("iv",Base64.getEncoder().encodeToString(cipher.getIV()))
            .put("cipher",Base64.getEncoder().encodeToString(cipher.doFinal(config.toString().getBytes(StandardCharsets.UTF_8))));
    }
    static JSONObject decrypt(JSONObject envelope,String password) throws Exception {
        if(!envelope.optString("format").equals("neptune-native-config-backup")||envelope.optInt("version")!=1||envelope.optInt("iterations")!=ITERATIONS)throw new Exception("不支持此备份版本。");
        String encoded=Checks.text(envelope,"cipher","[A-Za-z0-9+/=]+",1_000_000);
        byte[] salt=Base64.getDecoder().decode(envelope.getString("salt")),iv=Base64.getDecoder().decode(envelope.getString("iv"));
        if(salt.length!=16||iv.length!=12)throw new Exception("备份格式不正确。");
        try{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(password,salt),new GCMParameterSpec(128,iv));
            cipher.updateAAD("neptune-config-backup:1".getBytes(StandardCharsets.UTF_8));
            return new JSONObject(new String(cipher.doFinal(Base64.getDecoder().decode(encoded)),StandardCharsets.UTF_8));
        }catch(Exception e){throw new Exception("备份密码不正确，或文件已损坏。");}
    }
}
