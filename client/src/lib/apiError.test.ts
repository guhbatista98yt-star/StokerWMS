import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiRequest } from './queryClient';

global.fetch = vi.fn();

function createResponse(status: number, body: any, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 500 ? 'Internal Server Error' : 'Error',
        headers: {
            get: (key: string) => headers[key.toLowerCase()] || null,
        },
        json: async () => body,
        text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    } as unknown as Response;
}

describe('apiRequest Error Handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not throw on success (200)', async () => {
        (global.fetch as any).mockResolvedValue(createResponse(200, { data: 'ok' }));

        const res = await apiRequest('GET', '/api/test');
        expect(res.ok).toBe(true);
    });

    it('should throw simple message from { message: "msg" }', async () => {
        (global.fetch as any).mockResolvedValue(createResponse(400, { message: 'Simple error' }, { 'content-type': 'application/json' }));

        await expect(apiRequest('GET', '/api/test')).rejects.toThrow('Simple error');
    });

    it('should throw simple message from { error: "msg" }', async () => {
        (global.fetch as any).mockResolvedValue(createResponse(400, { error: 'Another error' }, { 'content-type': 'application/json' }));

        await expect(apiRequest('GET', '/api/test')).rejects.toThrow('Another error');
    });

    it('should throw detailed message from { error: "Title", details: "Desc" }', async () => {
        (global.fetch as any).mockResolvedValue(createResponse(400, { error: 'Validation', details: 'Field X is missing' }, { 'content-type': 'application/json' }));

        await expect(apiRequest('GET', '/api/test')).rejects.toThrow('Validation: Field X is missing');
    });

    it('should fallback to statusText if JSON is empty/unknown', async () => {
        (global.fetch as any).mockResolvedValue(createResponse(400, {}, { 'content-type': 'application/json' }));
        await expect(apiRequest('GET', '/api/test')).rejects.toThrow('Error');
    });

    it('should fallback to text if content-type is not JSON', async () => {
        (global.fetch as any).mockResolvedValue(createResponse(400, 'Raw text error', { 'content-type': 'text/plain' }));

        await expect(apiRequest('GET', '/api/test')).rejects.toThrow('Raw text error');
    });

    it('should fallback to text if JSON parsing fails', async () => {
        const badJsonRes = createResponse(400, 'Invalid JSON', { 'content-type': 'application/json' });
        badJsonRes.json = async () => { throw new SyntaxError('Unexpected token'); };
        (global.fetch as any).mockResolvedValue(badJsonRes);

        await expect(apiRequest('GET', '/api/test')).rejects.toThrow('Invalid JSON');
    });
});
