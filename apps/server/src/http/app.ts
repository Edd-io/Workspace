import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  commitPendingSchema,
  createDeskSchema,
  createRoomSchema,
  deskPromptSchema,
  integrationTargetSchema,
  loginSchema,
  pullRequestSchema,
  searchQuerySchema,
  statsQuerySchema,
  summaryRequestSchema,
  updateDeskSchema,
  updateNotificationSettingsSchema,
  updateRoomSchema,
} from '@workspace/shared';
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S, type AuthService } from '../auth/authService.ts';
import type { Config } from '../config.ts';
import { IntegrationError } from '../git/integration.ts';
import type { BoardStore } from '../office/boardStore.ts';
import type { IntegrationService } from '../office/integrationService.ts';
import { OfficeError, type OfficeService } from '../office/officeService.ts';
import type { RoomAwareness } from '../office/roomAwareness.ts';
import type { Insights } from '../office/stats.ts';
import type { Summarizer } from '../office/summarizer.ts';
import type { Notifier, Presence } from '../office/notifier.ts';
import type { UsageTracker } from '../office/usageTracker.ts';
import { buildTimeline } from '../office/timeline.ts';
import type { SessionManager } from '../sessions/sessionManager.ts';
import type { HookPayload } from '../sessions/stateMachine.ts';
import { toPublicDesk, type OfficeStore } from '../store/officeStore.ts';
import { listDirectories } from './directories.ts';
import { authenticateDesk, registerOfficeRoutes } from './officeRoutes.ts';
import { registerWebSocket } from './websocket.ts';

export interface AppDeps {
  config: Config;
  store: OfficeStore;
  auth: AuthService;
  office: OfficeService;
  sessions: SessionManager;
  boards: BoardStore;
  awareness: RoomAwareness;
  summarizer: Summarizer;
  integration: IntegrationService;
  usage: UsageTracker;
  notifier: Notifier;
  presence: Presence;
  insights: Insights;
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof OfficeError) {
    return reply.code(error.status).send({ error: error.code, message: error.message });
  }
  if (error instanceof IntegrationError) {
    return reply.code(409).send({ error: error.code, message: error.message, ...error.details });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'invalid_input', message: z.prettifyError(error) });
  }
  throw error;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const {
    config,
    store,
    auth,
    office,
    sessions,
    boards,
    awareness,
    summarizer,
    integration,
    usage,
    notifier,
    presence,
    insights,
  } = deps;
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1024 * 1024 });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_input', message: z.prettifyError(error) });
    }
    return reply.send(error);
  });

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  const isAuthenticated = (request: FastifyRequest): boolean =>
    auth.validate(request.cookies[SESSION_COOKIE]);

  // Every /api route except auth ones, and the WebSocket, require a logged-in session.
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    const needsSession = (path.startsWith('/api/') && !path.startsWith('/api/auth/')) || path === '/ws';
    if (needsSession && !isAuthenticated(request)) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    // Defense in depth against cross-site WebSocket hijacking (on top of the SameSite cookie).
    if (path === '/ws' && request.headers.origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(request.headers.origin).host;
      } catch {
        originHost = null;
      }
      const allowed = [request.headers.host, request.headers['x-forwarded-host']].filter(Boolean);
      if (!originHost || !allowed.includes(originHost)) {
        await reply.code(403).send({ error: 'forbidden_origin' });
      }
    }
  });

  // ---- auth -----------------------------------------------------------------------------------

  app.get('/api/auth/me', async (request) => ({
    authenticated: isAuthenticated(request),
    passwordSet: auth.isPasswordSet(),
  }));

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const result = await auth.login(parsed.data.password, request.ip);
    if ('error' in result) {
      const status = result.error === 'rate_limited' ? 429 : result.error === 'no_password' ? 409 : 401;
      return reply.code(status).send({ error: result.error });
    }
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_S,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    auth.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- office ---------------------------------------------------------------------------------

  app.get('/api/office', async () => ({
    rooms: store.listRooms(),
    desks: store.listDesks().map(toPublicDesk),
  }));

  app.get('/api/fs/directories', async (request, reply) => {
    const { path } = z.object({ path: z.string().optional() }).parse(request.query);
    try {
      return listDirectories(path);
    } catch (error) {
      return reply.code(400).send({ error: 'cannot_read_directory', message: (error as Error).message });
    }
  });

  app.post('/api/rooms', async (request, reply) => {
    try {
      return await office.createRoom(createRoomSchema.parse(request.body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/rooms/:id', async (request, reply) => {
    try {
      return office.updateRoom(request.params.id, updateRoomSchema.parse(request.body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/api/rooms/:id',
    async (request, reply) => {
      try {
        await office.deleteRoom(request.params.id, request.query.force === '1');
        return { ok: true };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post('/api/desks', async (request, reply) => {
    try {
      return toPublicDesk(await office.createDesk(createDeskSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/desks/:id', async (request, reply) => {
    try {
      return toPublicDesk(office.updateDesk(request.params.id, updateDeskSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/api/desks/:id',
    async (request, reply) => {
      try {
        await office.deleteDesk(request.params.id, request.query.force === '1');
        return { ok: true };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  const deskActions = { start: 'startDesk', stop: 'stopDesk', restart: 'restartDesk' } as const;
  app.post<{ Params: { id: string; action: string } }>('/api/desks/:id/:action', async (request, reply) => {
    const method = deskActions[request.params.action as keyof typeof deskActions];
    if (!method) return reply.code(404).send({ error: 'unknown_action' });
    try {
      await office[method](request.params.id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ---- integration of a desk's work (worktree desks) ------------------------------------------

  type DeskRoute = { Params: { id: string } };
  type TargetQuery = { Params: { id: string }; Querystring: { target?: string } };
  const handle =
    <T extends DeskRoute>(action: (request: FastifyRequest<T>) => Promise<unknown>) =>
    async (request: FastifyRequest<T>, reply: FastifyReply) => {
      try {
        return await action(request);
      } catch (error) {
        return sendError(reply, error);
      }
    };

  app.get<TargetQuery>(
    '/api/desks/:id/integration',
    handle<TargetQuery>((request) =>
      integration.status(request.params.id, request.query.target || undefined),
    ),
  );
  app.get<TargetQuery>(
    '/api/desks/:id/integration/diff',
    handle<TargetQuery>((request) =>
      integration.diff(request.params.id, integrationTargetSchema.parse(request.query).target),
    ),
  );
  app.get<DeskRoute>(
    '/api/desks/:id/integration/pull-request',
    handle((request) => integration.pullRequestInfo(request.params.id)),
  );
  app.post<DeskRoute>(
    '/api/desks/:id/integration/commit',
    handle(async (request) => {
      await integration.commit(request.params.id, commitPendingSchema.parse(request.body).message);
      return { ok: true };
    }),
  );
  app.post<DeskRoute>(
    '/api/desks/:id/integration/merge',
    handle((request) =>
      integration.merge(request.params.id, integrationTargetSchema.parse(request.body).target),
    ),
  );
  app.post<DeskRoute>(
    '/api/desks/:id/integration/update',
    handle((request) =>
      integration.updateFromTarget(request.params.id, integrationTargetSchema.parse(request.body).target),
    ),
  );
  app.post<DeskRoute>(
    '/api/desks/:id/integration/pull-request',
    handle((request) => {
      const { target, title, body } = pullRequestSchema.parse(request.body);
      return integration.createPullRequest(request.params.id, target, title, body);
    }),
  );
  app.post<DeskRoute>(
    '/api/desks/:id/prompt',
    handle(async (request) => {
      integration.sendPrompt(request.params.id, deskPromptSchema.parse(request.body).text);
      return { ok: true };
    }),
  );

  app.get<{ Querystring: { deskId?: string; since?: string; limit?: string } }>(
    '/api/events',
    async (request) =>
      store.listDeskEvents({
        deskId: request.query.deskId,
        since: request.query.since ? Number(request.query.since) : undefined,
        limit: request.query.limit ? Math.min(Number(request.query.limit), 5000) : undefined,
      }),
  );

  // ---- hooks (called by Claude Code, authenticated with the desk token) -----------------------

  app.post<{ Params: { deskId: string } }>('/internal/hooks/:deskId', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const payload = request.body as HookPayload;
    if (typeof payload?.hook_event_name !== 'string') {
      return reply.code(400).send({ error: 'invalid_payload' });
    }
    return sessions.handleHook(desk.id, payload);
  });

  registerOfficeRoutes(app, { store, boards, awareness, usage });

  app.get<{ Querystring: { hours?: string } }>('/api/timeline', async (request) => {
    const hours = Math.min(Math.max(Number(request.query.hours ?? 12) || 12, 1), 24 * 7);
    const to = Date.now();
    return buildTimeline(store, to - hours * 3600_000, to);
  });

  // ---- statistics and search ------------------------------------------------------------------

  app.get('/api/stats', async (request) => insights.stats(statsQuerySchema.parse(request.query).period));

  app.get('/api/search', async (request) => {
    const { q, roomId } = searchQuerySchema.parse(request.query);
    return insights.search(q, roomId);
  });

  // ---- summary (Haiku) ------------------------------------------------------------------------

  app.get('/api/summary', async () => summarizer.current());

  app.post('/api/summary', async (request) => {
    const { reason, language } = summaryRequestSchema.parse(request.body);
    return reason === 'visit' ? summarizer.visit(language) : summarizer.refresh(language);
  });

  // ---- phone notifications (Discord) ------------------------------------------------------------

  app.get('/api/notifications', async () => notifier.publicSettings());
  app.patch('/api/notifications', async (request) =>
    notifier.update(updateNotificationSettingsSchema.parse(request.body)),
  );
  app.post('/api/notifications/test', async (request, reply) => {
    try {
      await notifier.test();
    } catch {
      return reply.code(409).send({ error: 'no_webhook' });
    }
    return notifier.publicSettings();
  });

  // ---- realtime -------------------------------------------------------------------------------

  registerWebSocket(app, { store, sessions, boards, summarizer, usage, presence });

  // ---- web client (production build) ----------------------------------------------------------

  if (existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/internal/')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  return app;
}
