// Read-only check suitable for an external monitor. Never calls tick or charging APIs.
const endpoint='https://ballcard-neptune-charge-hub.ms.show/api/web/health';
try {
  const response=await fetch(endpoint,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok||result.app!=='neptune-charge-web'||result.schedulerReady!==true)throw Error('unhealthy');
  console.log('PASS: scheduler health');
} catch {
  console.error('ALERT: scheduler unavailable, delayed, or failed; inspect protected operations diagnostics. Do not retry charging.');
  process.exitCode=1;
}
