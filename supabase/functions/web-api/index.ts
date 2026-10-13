import { createClient } from '@supabase/supabase-js';
import { createHandler } from '../_shared/handler.ts';
const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key)throw Error('Service environment is not configured.');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
// Gateway legacy JWT validation does not support the project's new signing keys. The handler
// instead verifies every user JWT through auth.getUser(), and checks a separate Vault cron secret.
Deno.serve(createHandler(admin,new Set(['https://neptune-charge-hub.vercel.app','http://127.0.0.1:3086'])));
