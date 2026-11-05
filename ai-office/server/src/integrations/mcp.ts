import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { vault } from '../core/vault.js';
import type { McpServerConfig } from '../llm/index.js';

/** Remote MCP servers made available to the Researcher through Claude's MCP connector. */
export function listMcpServers(): McpServerConfig[] {
  const raw = vault.get('mcp.servers');
  return raw ? JSON.parse(raw) : [];
}

export function saveMcpServers(list: McpServerConfig[], by: string) {
  vault.set('mcp.servers', JSON.stringify(list), by);
}

export async function probeMcpServer(s: McpServerConfig) {
  const client = new Client({ name: 'ai-office', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(s.url), {
    requestInit: s.token ? { headers: { Authorization: `Bearer ${s.token}` } } : undefined,
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? '' }));
  } finally {
    await client.close();
  }
}
