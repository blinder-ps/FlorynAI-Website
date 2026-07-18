import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { getSupabaseForToken } from '../supabase.js';

export const dashboardRouter=Router();
dashboardRouter.use(requireAuth);

const querySchema=z.object({modelId:z.string().uuid().optional(),range:z.enum(['1D','3D','1W','1M','3M','6M','1Y']).default('1M'),timezone:z.string().min(1).max(80).default('UTC'),search:z.string().max(100).optional(),cursor:z.string().datetime({offset:true}).optional(),type:z.string().max(80).optional()});
const days:Record<string,number>={D1:1,D3:3,W1:7,M1:30,M3:90,M6:180,Y1:365};
const bounds=(range:string)=>{const end=new Date();const key=`${range.slice(1)}${range[0]}`;const start=new Date(end.getTime()-(days[key]||30)*86400000);return {start:start.toISOString(),end:end.toISOString()};};
const error=(res:Response,status:number,code:string,message:string)=>res.status(status).json({success:false,error:{code,message}});

dashboardRouter.get('/summary',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return error(res,400,'invalid_query','Invalid dashboard filters.');
  const {start,end}=bounds(parsed.data.range);const client=getSupabaseForToken(req.accessToken!);
  const {data,error:dbError}=await client.rpc('dashboard_summary',{p_model_id:parsed.data.modelId??null,p_start:start,p_end:end});
  if(dbError)return error(res,503,'summary_unavailable','Unable to load earnings summary.');
  const raw=data as Record<string,unknown>;return res.json({success:true,summary:{...raw,total_revenue:Number(raw.total_revenue_cents||0)/100}});
});

dashboardRouter.get('/revenue-history',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return error(res,400,'invalid_query','Invalid dashboard filters.');
  const {start,end}=bounds(parsed.data.range);const client=getSupabaseForToken(req.accessToken!);
  const {data,error:dbError}=await client.rpc('dashboard_revenue_history',{p_model_id:parsed.data.modelId??null,p_start:start,p_end:end,p_timezone:parsed.data.timezone});
  if(dbError)return error(res,503,'history_unavailable','Unable to load revenue history.');
  return res.json({success:true,history:(data||[]).map((row:Record<string,unknown>)=>({...row,revenue:Number(row.revenue_cents||0)/100}))});
});

dashboardRouter.get('/transactions',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return error(res,400,'invalid_query','Invalid dashboard filters.');
  const {start,end}=bounds(parsed.data.range);const client=getSupabaseForToken(req.accessToken!);let query=client.from('transactions').select('id,model_id,source_transaction_id,source_buyer_id,stars,gross_amount_cents,currency,transaction_type,occurred_at,models(display_name)').gte('occurred_at',start).lt('occurred_at',end).eq('transaction_status','completed').order('occurred_at',{ascending:false}).limit(51);
  if(parsed.data.modelId)query=query.eq('model_id',parsed.data.modelId);if(parsed.data.cursor)query=query.lt('occurred_at',parsed.data.cursor);if(parsed.data.type)query=query.eq('transaction_type',parsed.data.type);if(parsed.data.search)query=query.ilike('source_buyer_id',`%${parsed.data.search.replace(/[%_,]/g,'')}%`);
  const {data,error:dbError}=await query;if(dbError)return error(res,503,'transactions_unavailable','Unable to load transactions.');
  const rows=data||[];const hasMore=rows.length>50;const visible=rows.slice(0,50);
  return res.json({success:true,transactions:visible.map((row:any)=>({id:row.id,user:row.source_buyer_id,model:row.models?.display_name??'',stars:row.stars,revenue:Number(row.gross_amount_cents)/100,currency:row.currency,type:row.transaction_type,created_at:row.occurred_at})),next_cursor:hasMore?visible.at(-1)?.occurred_at:null});
});

dashboardRouter.get('/sync-health',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return error(res,400,'invalid_query','Invalid dashboard filters.');const client=getSupabaseForToken(req.accessToken!);
  const {data,error:dbError}=await client.rpc('dashboard_sync_health',{p_model_id:parsed.data.modelId??null});if(dbError)return error(res,503,'sync_health_unavailable','Unable to load synchronization status.');return res.json({success:true,...data});
});

dashboardRouter.get('/models',async(req:AuthenticatedRequest,res:Response)=>{
  const parsed=querySchema.safeParse(req.query);if(!parsed.success)return error(res,400,'invalid_query','Invalid dashboard filters.');const {start,end}=bounds(parsed.data.range);const client=getSupabaseForToken(req.accessToken!);
  const {data,error:dbError}=await client.rpc('dashboard_models',{p_start:start,p_end:end});if(dbError)return error(res,503,'models_unavailable','Unable to load models.');return res.json({success:true,models:(data||[]).map((row:Record<string,unknown>)=>({...row,total_revenue:Number(row.total_revenue_cents||0)/100}))});
});
