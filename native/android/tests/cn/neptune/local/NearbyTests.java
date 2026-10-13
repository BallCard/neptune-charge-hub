package cn.neptune.local;
import org.json.*;
import java.util.*;
public class NearbyTests {
    public static void main(String[] args)throws Exception {
        JSONArray stations=new JSONArray().put(new JSONObject().put("name","合成站点").put("lon",120.13).put("lat",30.27).put("aliases",new JSONArray()).put("device_ids",new JSONArray().put("12345678").put("87654321")));
        List<String> paths=Collections.synchronizedList(new ArrayList<>());
        JSONObject result=NearbyStatus.read(stations,(path,input)->{
            paths.add(path);if(input.has("openId")||input.has("employeeId"))throw new AssertionError("Public query must not read account identity");
            if(input.getString("devaddress").equals("87654321"))throw new Exception("isolated offline");
            return new JSONObject().put("success",true).put("obj",new JSONObject().put("portstatur","0013x").put("openId","do-not-expose"));
        });
        JSONObject station=result.getJSONArray("stations").getJSONObject(0);
        CoreTests.check(paths.size()==2&&paths.stream().allMatch(p->p.equals("getDeviceInfo")),"Only public reads");
        CoreTests.check(station.getInt("free")==2&&station.getInt("total")==5,"Accurate partial counts");
        CoreTests.check(station.getJSONArray("devices_detail").getJSONObject(1).getInt("free")==0,"Offline device cannot inherit counts");
        CoreTests.check(!result.toString().contains("do-not-expose"),"Private fields not returned");
        System.out.println("PASS public nearby reads, partial failure counts and private-field filtering");
    }
}
