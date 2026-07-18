import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { getSupabaseAdmin } from '../supabase.js';

export const dashboardRouter=Router();
dashboardRouter.use(requireAuth);
let audCache:{rate:number;expires:number}|null=null;

const querySchema=z.object({modelId:z.string().uuid().optional(),range:z.enum(['1D','3D','1W','1M','3M','6M','1Y']).default('1M'),timezone:z.string().min(1).max(80).default('UTC'),search:z.string().max(100).optional(),cursor:z.string().datetime({offset:true}).optional(),type:z.string().max(80).optional()});
const rangeDays:Record<string,number>={'1D':1,'3D':3,'1W':7,'1M':30,'3M':90,'6M':180,'1Y':365};
const bounds=(range:string)=>{const end=new Date();const start=new Date(end.getTime()-(rangeDays[range]??30)*86400000);return {start:start.toISOString(),end:end.toISOString()};};
const fail=(res:Response,status:number,code:string,message:string)=>res.status(status).json({success:false,error:{code,message}});

async function allowedModels(userId:string):Promise<string[]> {
  const admin=getSupabaseAdmin();
  const profile=await admin.from('profiles').select('platform_role,status').eq('id',userId).maybeSingle();
  if(profile.error||profile.data?.status!=='active')return [];
  if(profile.data.platform_role==='platform_admin'){
    const all=await admin.from('models').select('id').neq('status','disabled');return all.data?.map(row=>row.id)||[];
  }
  const [memberships,agencyMemberships,assignments]=await Promise.all([
    admin.from('model_members').select('model_id').eq('user_id',userId).eq('status','active'),
    admin.from('agency_members').select('agency_id,role').eq('user_id',userId).eq('status','active'),
    admin.from('model_access_assignments').select('model_id').eq('manager_user_id',userId)
  ]);
  const ids=new Set(memberships.data?.map(row=>row.model_id)||[]);
  assignments.data?.forEach(row=>ids.add(row.model_id));
  const adminAgencies=(agencyMemberships.data||[]).filter(row=>row.role==='administrator').map(row=>row.agency_id);
  if(adminAgencies.length){const models=await admin.from('models').select('id').in('agency_id',adminAgencies).neq('status','disabled');models.data?.forEach(row=>ids.add(row.id));}
  return [...ids];
}

async function scope(req:AuthenticatedRequest,res:Response,modelId?:string){
  const ids=await allowedModels(req.userId!);
  if(!ids.length){fail(res,403,'no_model_access','No active model access was found.');return null;}
  if(modelId&&!ids.includes(modelId)){fail(res,403,'model_access_denied','You are not authorized to view this model.');return null;}
  return modelId?[modelId]:ids;
}

dashboardRouter.get('/context',async(req:AuthenticatedRequest,res:Response)=>{
  const admin=getSupabaseAdmin();
  const [profile,agencyMemberships,modelMemberships]=await Promise.all([
    admin.from('profiles').select('platform_role,status').eq('id',req.userId!).maybeSingle(),
    admin.from('agency_members').select('agency_id,role,agencies(name)').eq('user_id',req.userId!).eq('status','active'),
    admin.from('model_members').select('model_id').eq('user_id',req.userId!).eq('status','active')
  ]);
  if(profile.error||agencyMemberships.error||modelMemberships.error)return fail(res,503,'context_unavailable','Unable to load account context.');
  const modelIds=await allowedModels(req.userId!);
  const models=modelIds.length?await admin.from('models').select('id,display_name,currency,status').in('id',modelIds).eq('status','active').order('display_name'):{data:[],error:null};
  if(models.error)return fail(res,503,'context_unavailable','Unable to load account models.');
  const isAdmin=profile.data?.platform_role==='platform_admin';
  const hasAgency=(agencyMemberships.data?.length||0)>0;
  const accountType=isAdmin?'admin':hasAgency?'agency':'model';
  const agencyRow=agencyMemberships.data?.[0] as any;
  return res.json({success:true,account_type:accountType,account_label:isAdmin?'Admin account':hasAgency?(agencyRow?.agencies?.name||'Agency account'):'Model account',can_combine:accountType!=='model',models:models.data||[]});
});

dashboardRouter.get('/exchange-rate',async(req:AuthenticatedRequest,res:Response)=>{
  const currency=z.enum(['USD','AUD']).safeParse(req.query.currency);if(!currency.success)return fail(res,400,'invalid_currency','Unsupported currency.');
  if(currency.data==='USD')return res.json({success:true,currency:'USD',rate:1});
  if(audCache&&audCache.expires>Date.now())return res.json({success:true,currency:'AUD',rate:audCache.rate});
  try{const response=await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('rate unavailable');const payload=await response.json() as {rates?:{AUD?:number}};const rate=payload.rates?.AUD;if(!rate||!Number.isFinite(rate))throw new Error('invalid rate');audCache={rate,expires:Date.now()+21600000};return res.json({success:true,currency:'AUD',rate});}catch{return fail(res,503,'exchange_rate_unavailable','AUD conversion is temporarily unavailable.');}
});

dashboardRouter.get('/summary',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return fail(res,400,'invalid_query','Invalid dashboard filters.');
  const modelIds=await scope(req,res,parsed.data.modelId);if(!modelIds)return;const {start,end}=bounds(parsed.data.range);const admin=getSupabaseAdmin();
  const [tx,metrics,models]=await Promise.all([
    admin.from('transactions').select('stars,gross_amount_cents,source_buyer_id').in('model_id',modelIds).gte('occurred_at',start).lt('occurred_at',end).eq('transaction_status','completed').limit(10000),
    admin.from('daily_model_metrics').select('message_count,total_users,active_users').in('model_id',modelIds).gte('metric_date',start.slice(0,10)).lte('metric_date',end.slice(0,10)).limit(10000),
    admin.from('models').select('id,display_name,agency_id').in('id',modelIds)
  ]);
  if(tx.error||metrics.error||models.error)return fail(res,503,'summary_unavailable','Unable to load earnings summary.');
  const rows=tx.data||[],daily=metrics.data||[];const revenueCents=rows.reduce((sum,row)=>sum+Number(row.gross_amount_cents),0);const buyers=new Set(rows.map(row=>row.source_buyer_id));
  return res.json({success:true,summary:{total_stars:rows.reduce((sum,row)=>sum+Number(row.stars),0),total_revenue:revenueCents/100,total_sales:rows.length,unique_buyers:buyers.size,messages:daily.reduce((sum,row)=>sum+Number(row.message_count),0),total_users:Math.max(0,...daily.map(row=>Number(row.total_users))),active_users:Math.max(0,...daily.map(row=>Number(row.active_users))),model_count:models.data?.length||0,role:(models.data?.length||0)>1?'agency':'model',title:(models.data?.length||0)>1?'Agency earnings':'Your earnings'}});
});

dashboardRouter.get('/revenue-history',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return fail(res,400,'invalid_query','Invalid dashboard filters.');const modelIds=await scope(req,res,parsed.data.modelId);if(!modelIds)return;const {start,end}=bounds(parsed.data.range);const admin=getSupabaseAdmin();
  const {data,error}=await admin.from('transactions').select('occurred_at,gross_amount_cents,stars').in('model_id',modelIds).gte('occurred_at',start).lt('occurred_at',end).eq('transaction_status','completed').order('occurred_at').limit(10000);if(error)return fail(res,503,'history_unavailable','Unable to load revenue history.');
  const grouped=new Map<string,{metric_date:string,revenue:number,stars:number}>();for(const row of data||[]){const date=new Intl.DateTimeFormat('en-CA',{timeZone:parsed.data.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.occurred_at));const item=grouped.get(date)||{metric_date:date,revenue:0,stars:0};item.revenue+=Number(row.gross_amount_cents)/100;item.stars+=Number(row.stars);grouped.set(date,item);}return res.json({success:true,history:[...grouped.values()]});
});

dashboardRouter.get('/transactions',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return fail(res,400,'invalid_query','Invalid dashboard filters.');const modelIds=await scope(req,res,parsed.data.modelId);if(!modelIds)return;const {start,end}=bounds(parsed.data.range);const admin=getSupabaseAdmin();let query=admin.from('transactions').select('id,model_id,source_buyer_id,stars,gross_amount_cents,currency,transaction_type,occurred_at,models(display_name)').in('model_id',modelIds).gte('occurred_at',start).lt('occurred_at',end).eq('transaction_status','completed').order('occurred_at',{ascending:false}).limit(51);
  if(parsed.data.cursor)query=query.lt('occurred_at',parsed.data.cursor);if(parsed.data.type)query=query.eq('transaction_type',parsed.data.type);if(parsed.data.search)query=query.ilike('source_buyer_id',`%${parsed.data.search.replace(/[%_,]/g,'')}%`);const {data,error}=await query;if(error)return fail(res,503,'transactions_unavailable','Unable to load transactions.');const rows=data||[],visible=rows.slice(0,50);
  return res.json({success:true,transactions:visible.map((row:any)=>({id:row.id,user:row.source_buyer_id,model:row.models?.display_name??'',stars:row.stars,revenue:Number(row.gross_amount_cents)/100,currency:row.currency,type:row.transaction_type,created_at:row.occurred_at})),next_cursor:rows.length>50?visible.at(-1)?.occurred_at:null});
});

dashboardRouter.get('/sync-health',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return fail(res,400,'invalid_query','Invalid dashboard filters.');const modelIds=await scope(req,res,parsed.data.modelId);if(!modelIds)return;const admin=getSupabaseAdmin();const {data,error}=await admin.from('sync_runs').select('completed_at').in('model_id',modelIds).eq('status','succeeded').order('completed_at',{ascending:false}).limit(1).maybeSingle();if(error)return fail(res,503,'sync_health_unavailable','Unable to load synchronization status.');if(!data?.completed_at)return res.json({success:true,status:'never_synced',last_successful_sync_at:null});const minutes=Math.floor((Date.now()-new Date(data.completed_at).getTime())/60000);return res.json({success:true,last_successful_sync_at:data.completed_at,next_expected_sync_at:new Date(new Date(data.completed_at).getTime()+1800000).toISOString(),minutes_since_success:minutes,status:minutes<=45?'fresh':minutes<=60?'delayed':'stale'});
});

dashboardRouter.get('/models',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return fail(res,400,'invalid_query','Invalid dashboard filters.');const modelIds=await scope(req,res,parsed.data.modelId);if(!modelIds)return;const {start,end}=bounds(parsed.data.range);const admin=getSupabaseAdmin();const [models,tx]=await Promise.all([admin.from('models').select('id,display_name,slug,profile_image_url,currency').in('id',modelIds),admin.from('transactions').select('model_id,gross_amount_cents,stars').in('model_id',modelIds).gte('occurred_at',start).lt('occurred_at',end).eq('transaction_status','completed').limit(10000)]);if(models.error||tx.error)return fail(res,503,'models_unavailable','Unable to load models.');const totals=new Map<string,{revenue:number,stars:number}>();for(const row of tx.data||[]){const item=totals.get(row.model_id)||{revenue:0,stars:0};item.revenue+=Number(row.gross_amount_cents)/100;item.stars+=Number(row.stars);totals.set(row.model_id,item);}return res.json({success:true,models:(models.data||[]).map(model=>({...model,total_revenue:totals.get(model.id)?.revenue||0,total_stars:totals.get(model.id)?.stars||0}))});
});
