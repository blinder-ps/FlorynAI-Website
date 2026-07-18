import { createHash, randomUUID } from 'node:crypto';
import { Router, raw, type Request, type Response } from 'express';
import { earningsSyncSchema } from '../schemas/ingestion.js';
import { getServerConfig } from '../config.js';
import { getSupabaseAdmin } from '../supabase.js';
import { isFreshTimestamp, verifyN8nSignature } from '../security/hmac.js';

export const n8nRouter=Router();
const fail=(res:Response,status:number,requestId:string,code:string,message:string)=>res.status(status).json({success:false,request_id:requestId,error:{code,message}});
n8nRouter.post('/earnings-sync',raw({type:'application/json',limit:'2mb'}),async(req:Request,res:Response)=>{
  const requestId=randomUUID(); const timestamp=req.get('X-Floryn-Timestamp'); const signature=req.get('X-Floryn-Signature'); const workflow=req.get('X-Floryn-Workflow'); const idempotency=req.get('X-Floryn-Idempotency-Key');
  if(!timestamp||!signature||!workflow||!idempotency)return fail(res,400,requestId,'missing_headers','Required integration headers are missing.');
  if(!Buffer.isBuffer(req.body))return fail(res,400,requestId,'invalid_body','A raw JSON request body is required.');
  if(!isFreshTimestamp(timestamp))return fail(res,401,requestId,'expired_timestamp','The request timestamp is outside the allowed window.');
  if(!verifyN8nSignature(getServerConfig().N8N_WEBHOOK_SECRET,timestamp,req.body,signature))return fail(res,401,requestId,'invalid_signature','The request signature is invalid.');
  let json:unknown; try{json=JSON.parse(req.body.toString('utf8'));}catch{return fail(res,400,requestId,'invalid_json','The request body is not valid JSON.');}
  const parsed=earningsSyncSchema.safeParse(json); if(!parsed.success)return fail(res,422,requestId,'invalid_payload','The synchronization payload is invalid.');
  if(parsed.data.workflow_name!==workflow||parsed.data.sync_id!==idempotency)return fail(res,422,requestId,'header_mismatch','Workflow or idempotency headers do not match the payload.');
  const payloadHash=createHash('sha256').update(req.body).digest('hex');
  const {data,error}=await getSupabaseAdmin().rpc('ingest_earnings_sync',{p_payload:parsed.data,p_payload_hash:payloadHash});
  if(error){const duplicate=error.message.includes('duplicate_sync');return fail(res,duplicate?409:422,requestId,duplicate?'duplicate_sync':'ingestion_failed',duplicate?'This synchronization has already been processed.':'The synchronization could not be processed.');}
  return res.status(200).json({...data,request_id:requestId});
});
