package cn.neptune.local;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
final class NearbyStatus {
    static JSONObject read(JSONArray stations,Platform.Transport reader) throws Exception {
        if(stations.length()>100)throw new Exception("站点清单异常。");
        LinkedHashSet<String> ids=new LinkedHashSet<>();
        for(int i=0;i<stations.length();i++){JSONArray list=stations.getJSONObject(i).getJSONArray("device_ids");for(int j=0;j<list.length();j++){String id=list.getString(j);if(!id.matches("\\d{8}"))throw new Exception("设备编号异常。");ids.add(id);}}
        if(ids.size()>100)throw new Exception("设备清单过大。");
        ExecutorService pool=Executors.newFixedThreadPool(8);Map<String,JSONObject> results=new HashMap<>();
        try {
            List<String> ordered=new ArrayList<>(ids);List<Callable<JSONObject>> tasks=new ArrayList<>();
            for(String id:ordered)tasks.add(()->{try{JSONObject response=reader.call("getDeviceInfo",new JSONObject().put("areaId",6).put("devaddress",id));return Boolean.TRUE.equals(response.opt("success"))?response.optJSONObject("obj"):null;}catch(Exception e){return null;}});
            List<Future<JSONObject>> futures=pool.invokeAll(tasks,25,TimeUnit.SECONDS);
            for(int i=0;i<ordered.size();i++)try{results.put(ordered.get(i),futures.get(i).get());}catch(Exception e){results.put(ordered.get(i),null);}
        }finally{pool.shutdownNow();}
        JSONArray output=new JSONArray();int failures=0;
        for(int i=0;i<stations.length();i++){
            JSONObject source=stations.getJSONObject(i),station=new JSONObject().put("name",source.getString("name")).put("lon",source.getDouble("lon")).put("lat",source.getDouble("lat")).put("aliases",source.optJSONArray("aliases"));
            JSONArray devices=new JSONArray(),list=source.getJSONArray("device_ids");int[] totals=new int[4];boolean reachable=false;
            for(int j=0;j<list.length();j++){
                String id=list.getString(j);JSONObject obj=results.get(id);String raw=obj==null?"":obj.optString("portstatur","");boolean valid=raw.length()>0&&raw.length()<=99;int[] counts=new int[4];JSONArray ports=new JSONArray();
                if(valid){reachable=true;for(char ch:raw.toCharArray()){int kind=ch=='0'?0:ch=='1'?1:ch=='3'?2:3;counts[kind]++;totals[kind]++;ports.put(new String[]{"free","used","fault","other"}[kind]);}}else failures++;
                JSONObject device=new JSONObject().put("id",id).put("reachable",valid).put("error",valid?JSONObject.NULL:"设备暂不可连接").put("ports",ports).put("total",ports.length());
                for(String key:new String[]{"longitude","latitude"}){double coordinate=obj==null?Double.NaN:obj.optDouble(key,Double.NaN);device.put(key.equals("longitude")?"lon":"lat",Double.isNaN(coordinate)||Double.isInfinite(coordinate)?JSONObject.NULL:coordinate);}
                setCounts(device,counts);devices.put(device);
            }
            setCounts(station,totals);station.put("total",totals[0]+totals[1]+totals[2]+totals[3]).put("reachable",reachable).put("devices",devices.length()).put("devices_detail",devices);output.put(station);
        }
        java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return new JSONObject().put("stations",output).put("updated_at",format.format(new Date())).put("last_error",failures>0?failures+" 台设备暂不可连接，未计入空位。":JSONObject.NULL).put("fetching",false);
    }
    private static void setCounts(JSONObject object,int[] counts)throws Exception {String[] names={"free","used","fault","other"};for(int i=0;i<4;i++)object.put(names[i],counts[i]);}
}
