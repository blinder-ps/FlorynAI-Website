import { z } from 'zod';

const transaction = z.object({
  source_transaction_id: z.string().min(1).max(300), source_buyer_id: z.string().min(1).max(300), telegram_user_id: z.string().max(300).optional(),
  stars: z.number().int(), gross_amount_cents: z.number().int().safe(), currency: z.string().regex(/^[A-Z]{3}$/), conversion_rate_micros: z.number().int().nonnegative().nullable().optional(),
  transaction_type: z.string().min(1).max(80), transaction_status: z.string().min(1).max(80), occurred_at: z.string().datetime({offset:true})
}).superRefine((value,ctx)=>{if((value.stars<0||value.gross_amount_cents<0)&&!['refund','reversal'].includes(value.transaction_type))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Negative values require a refund or reversal transaction type.'});});
const dailyMetric=z.object({metric_date:z.string().date(),message_count:z.number().int().nonnegative(),total_users:z.number().int().nonnegative(),active_users:z.number().int().nonnegative()});
export const earningsSyncSchema=z.object({schema_version:z.literal('1.0'),sync_id:z.string().uuid(),sent_at:z.string().datetime({offset:true}),workflow_name:z.string().min(1).max(150),model:z.object({source_system:z.string().min(1).max(80),source_model_key:z.string().min(1).max(300)}),transactions:z.array(transaction).max(10000),daily_metrics:z.array(dailyMetric).max(366)}).strict();
export type EarningsSyncPayload=z.infer<typeof earningsSyncSchema>;
