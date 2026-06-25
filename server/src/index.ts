import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { chatRoutes } from './routes/chat.js';
import { agentRoutes } from './routes/agent.js';
import { briefRoutes } from './routes/briefs.js';
import { cbaRoutes } from './routes/cba.js';
import { contextGraphRoutes } from './routes/context_graph.js';
import { monitorRoutes } from './routes/monitors.js';
import { nbaRoutes } from './routes/nba.js';
import { nflRoutes } from './routes/nfl.js';
import { projectRoutes } from './routes/projects.js';
import { startMonitorScheduler } from './scheduler/monitors.js';

const app = new Hono();
const corsOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5176',
  'http://localhost:5177',
  'http://127.0.0.1:5177',
  'http://localhost:5178',
  'http://127.0.0.1:5178',
  process.env.CLIENT_ORIGIN,
].filter((origin): origin is string => Boolean(origin));

app.use('*', logger());
app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.get('/health', (c) => {
  return c.json({
    ok: true,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    supabase: !!process.env.SUPABASE_URL,
  });
});

app.route('/chat', chatRoutes);
app.route('/agent', agentRoutes);
app.route('/briefs', briefRoutes);
app.route('/cba', cbaRoutes);
app.route('/monitors', monitorRoutes);
app.route('/context-graph', contextGraphRoutes);
app.route('/nba', nbaRoutes);
app.route('/nfl', nflRoutes);
app.route('/projects', projectRoutes);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`▶ gambit server listening on http://localhost:${info.port}`);
  startMonitorScheduler();
  console.log('▶ monitor scheduler running (1 min tick)');
});
