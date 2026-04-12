import { Response, Request, Express } from 'express';
import { getTokenFromRequest, getUserFromToken } from './auth';

let nextClientId = 0;
const clients = new Map<number, { res: Response; userId?: string; companyId?: number }>();

const MAX_CONNECTIONS_PER_USER = 5;

function countUserConnections(userId: string): number {
    let count = 0;
    clients.forEach(c => { if (c.userId === userId) count++; });
    return count;
}

export function setupSSE(app: Express) {
    app.get('/api/sse', async (req: Request, res: Response) => {
        const token = getTokenFromRequest(req);
        if (!token) {
            return res.status(401).json({ error: 'Não autenticado' });
        }
        const result = await getUserFromToken(token);
        if (!result) {
            return res.status(401).json({ error: 'Token inválido' });
        }
        (req as any).user = result.user;
        (req as any).companyId = result.companyId;

        const userId = result.user.id;

        // Evita esgotamento de recursos por reconexões em loop
        if (countUserConnections(userId) >= MAX_CONNECTIONS_PER_USER) {
            return res.status(429).json({ error: 'Muitas conexões abertas' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const clientId = ++nextClientId;
        const companyId = result.companyId;

        clients.set(clientId, { res, userId, companyId });

        res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

        // Heartbeat a cada 30s para manter a conexão viva através de proxies
        const heartbeat = setInterval(() => {
            try {
                res.write(': ping\n\n');
            } catch {
                clearInterval(heartbeat);
                clients.delete(clientId);
            }
        }, 30_000);

        req.on('close', () => {
            clearInterval(heartbeat);
            clients.delete(clientId);
        });
    });
}

export function broadcastSSE(type: string, data: any, companyId?: number) {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

    clients.forEach((client, id) => {
        if (companyId && client.companyId !== companyId) return;
        try {
            client.res.write(message);
        } catch {
            clients.delete(id);
        }
    });
}

export function sendToUserSSE(userId: string, type: string, data: any) {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

    clients.forEach((client, id) => {
        if (client.userId !== userId) return;
        try {
            client.res.write(message);
        } catch {
            clients.delete(id);
        }
    });
}
