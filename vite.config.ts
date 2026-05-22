import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import { createMimoBehaviorProviderFromEnv } from './src/behavior/mimo-provider.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      host: '127.0.0.1'
    },
    plugins: [
      {
        name: 'audiogenic-mimo-proxy',
        configureServer(server) {
          server.middlewares.use('/api/behavior-timeline', async (request, response) => {
            if (!isLoopbackRequest(request)) {
              sendText(response, 403, 'Local MiMo proxy only accepts loopback requests');
              return;
            }

            if (request.method !== 'POST') {
              sendText(response, 405, 'Method Not Allowed');
              return;
            }

            const provider = createMimoBehaviorProviderFromEnv(env);
            if (!provider) {
              sendText(response, 503, 'Missing MIMO_API_KEY');
              return;
            }

            try {
              const input = JSON.parse(await readRequestBody(request));
              const timeline = await provider.generate(input);
              sendJson(response, 200, timeline);
            } catch (error) {
              sendText(response, 502, error instanceof Error ? error.message : String(error));
            }
          });
        }
      }
    ]
  };
});

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address === undefined;
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}
