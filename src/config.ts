import { z } from 'zod';

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  N8N_WEBHOOK_SECRET: z.string().min(32),
  APP_URL: z.string().url()
});

export type ServerConfig = z.infer<typeof serverEnvSchema>;
export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return serverEnvSchema.parse(env);
}
