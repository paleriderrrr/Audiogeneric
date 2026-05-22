import type { LlmBehaviorProvider } from './factory.js';
import type { BehaviorTimeline } from './types.js';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProxyBehaviorProviderOptions {
  endpoint?: string;
  fetchImpl?: FetchImpl;
}

export function createProxyBehaviorProvider(options: ProxyBehaviorProviderOptions = {}): LlmBehaviorProvider {
  const endpoint = options.endpoint ?? '/api/behavior-timeline';
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generate(input) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`大模型代理请求失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
      }

      return await response.json() as BehaviorTimeline;
    }
  };
}
