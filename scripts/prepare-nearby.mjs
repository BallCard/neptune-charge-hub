import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The canonical station list stays in upstream BD-09. This file contains public metadata only.
const source = new URL('../modules/nearby/stations_yuquan.csv', import.meta.url);
function fields(line) {
  const result=[]; let value='', quoted=false;
  for(let i=0;i<line.length;i++) {
    const char=line[i];
    if(char==='"') { if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted; }
    else if(char===','&&!quoted){result.push(value);value='';}else value+=char;
  }
  if(quoted)throw new Error('Invalid station CSV');
  return [...result,value];
}
const lines=(await readFile(source,'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
const keys=fields(lines.shift());
const stations=lines.map(line=>{
  const row=Object.fromEntries(fields(line).map((value,i)=>[keys[i],value]));
  const station={name:row.name,lon:Number(row.lon),lat:Number(row.lat),device_ids:JSON.parse(row.device_ids).map(String),aliases:(row.aliases||'').split('|').filter(Boolean)};
  if(!station.name||!Number.isFinite(station.lon)||!Number.isFinite(station.lat)||!station.device_ids.every(id=>/^\d{8}$/.test(String(id))))throw new Error('Invalid public station metadata');
  return station;
});
const target=new URL('../public/nearby/stations.json',import.meta.url);
await mkdir(dirname(fileURLToPath(target)),{recursive:true});
await writeFile(target,JSON.stringify(stations));
await writeFile(new URL('../modules/nearby/stations.json',import.meta.url),JSON.stringify(stations));
console.log(JSON.stringify({nearbyStations:stations.length,coordinateSystem:'BD-09'}));
