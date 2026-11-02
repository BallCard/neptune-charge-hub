import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stage=resolve(process.argv[2]||'');
if(!stage.startsWith(join(root,'.local','static-deployment')+sep))throw Error('Provide a screened deployment directory');
const files=[];
async function walk(dir,prefix=''){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.isSymbolicLink()||entry.name.startsWith('.'))throw Error('Unexpected public asset');
    const path=prefix+entry.name;
    if(entry.isDirectory())await walk(join(dir,entry.name),path+'/');
    else{
      const data=await readFile(join(dir,entry.name));
      if(!/\.(html|js|css|txt|json|svg|png|webmanifest|wasm|woff2)$/.test(path)||data.length>5000000)throw Error('Invalid public asset');
      if(/(?:sb_secret_[A-Za-z0-9_-]{16,}|SUPABASE_SERVICE_ROLE_KEY|\/api\/hub|qnvtuuwvloddxvhmppcd|openId=test-local-only)/.test(data.toString('utf8')))throw Error('Private marker in public asset');
      files.push({path,data});
    }
  }
}
await walk(join(stage,'.vercel/output/static'));
files.sort((a,b)=>a.path.localeCompare(b.path));
const runtime=await build({entryPoints:[join(root,'server/coze-server.mjs')],bundle:true,platform:'node',target:'node22',format:'esm',write:false,logLevel:'silent',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
const code=runtime.outputFiles[0].contents;
const stationMetadata=await readFile(join(root,'public/nearby/stations.json'));
const directReader=await readFile(join(root,'modules/nearby/status.mjs'));
const hash=createHash('sha256').update('neptune-coze-v1').update(code).update(stationMetadata);
for(const f of files)hash.update(f.path).update(f.data);
const release=hash.digest('hex').slice(0,12);
const output=join(root,'.local/coze-deployment',release,'coze-device-probe');
await mkdir(output,{recursive:true});
for(const f of files){const dest=join(output,'public',f.path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,f.data);}
const config=JSON.parse(files.find(f=>f.path==='cloud-config.json')?.data.toString()||'{}');
if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(config.url))throw Error('Invalid cloud endpoint');
await writeFile(join(output,'server.mjs'),code);
await writeFile(join(output,'stations.json'),stationMetadata);
await writeFile(join(output,'status.mjs'),directReader);
await writeFile(join(output,'asset-manifest.json'),JSON.stringify({version:1,release,cloudUrl:config.url,files:files.map(f=>f.path)},null,2));
await writeFile(join(output,'package.json'),JSON.stringify({name:'neptune-charge-web',version:'1.0.0',private:true,type:'module',engines:{node:'>=22'},scripts:{start:'node server.mjs'}},null,2));
await writeFile(join(output,'README.md'),`# 晨充完整网页与后端\n\n筛选产物 ${release}，沿用正式网页的 ${files.length} 个静态资源。Node.js 22+，无运行时安装依赖，npm start，PORT=5000，HOST=0.0.0.0。\n\n只覆盖当前 coze-device-probe 技术项目中的本包文件，保留已有根/子 .coze 和 scripts。不得重写 server.mjs、修改静态网页、放宽TLS或新增模型依赖。后台业务已打包，账号和预约仍使用现有Supabase，不新建数据库或执行器。\n\n服务端仅通过生产环境变量 NEPTUNE_SUPABASE_SECRET 接入现有云端；不要在对话、源码、压缩包或预览环境中写入真实值。NEPTUNE_PUBLIC_ORIGIN 默认为 https://xkrd9zr7b8.coze.site。未配置服务密钥时预约接口保持503，公开空位仅作只读展示。\n\n/health 显示发行号；/api/web/health 核对持久调度。未改调度地址前不能声称完整迁移完成。不要创建真实预约、开电或测试付款；不要自动配置/复制数据库或删除已有记录。\n`);
console.log(JSON.stringify({output,release,staticFiles:files.length,bytes:files.reduce((n,f)=>n+f.data.length,0)+code.length,privateData:false,runtimeDependencies:0}));
