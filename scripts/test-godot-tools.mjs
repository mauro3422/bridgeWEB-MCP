import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const tempRoot = path.join(repoRoot, '.tmp', 'godot-tools-test');
const tokenFile = path.join(tempRoot, 'token');
const capturePath = path.join(tempRoot, 'capture.png');
const token = 'godot-test-token-0123456789abcdefghijklmnopqrstuvwxyz';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2xkAAAAAASUVORK5CYII=', 'base64');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.writeFile(tokenFile, `${token}\n`, 'utf8');
process.env.GODOT_MCP_TOKEN_FILE = tokenFile;

const safeTools = [
  { name: 'read_scene', description: 'Read a Godot scene.', inputSchema: { type: 'object' } },
  { name: 'take_screenshot', description: 'Capture the game viewport.', inputSchema: { type: 'object' } },
];
const advertisedMutation = { name: 'create_scene', description: 'Create a scene.', inputSchema: { type: 'object' } };

const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers['x-mauroprime-token'] !== token) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ server: 'godot-mcp-server', version: 'test', tool_count: 5 }));
    return;
  }
  if (req.method === 'GET' && req.url === '/tools') {
    res.end(JSON.stringify({ tools: [...safeTools, advertisedMutation] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/tool') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    let payload;
    if (body.name === 'get_godot_status') {
      payload = {
        connected: true,
        tool_mode: 'observe',
        project_path: 'C:/Dev/godot-test/',
        project_id: '0123456789abcdef',
        project_name: 'Godot Test',
        editor_instance_id: 'editor-test',
        runtime_instance_id: 'runtime-test',
      };
    } else if (body.name === 'read_scene') {
      payload = { scene_path: 'res://main.tscn', root: { name: 'Root', type: 'Node3D', children: [] } };
    } else if (body.name === 'take_screenshot') {
      await fs.writeFile(capturePath, png);
      payload = { absolute_path: capturePath, width: 1, height: 1 };
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Unknown tool' }));
      return;
    }
    res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const port = address.port;

try {
  const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
  const registry = createDefaultToolRegistry();

  const status = await registry.call('godot_mcp_status', { port });
  assert.equal(status.available, true);
  assert.equal(status.status.projectId ?? status.status.project_id, '0123456789abcdef');

  const catalog = await registry.call('godot_mcp_tool_list', { port, includeSchemas: false });
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), ['read_scene', 'take_screenshot']);
  assert.equal(catalog.safeCount, 2);

  const instances = await registry.call('godot_mcp_instance_list', { port });
  assert.equal(instances.instances[0].editorInstanceId, 'editor-test');
  assert.equal(instances.instances[0].runtimeConnected, true);

  const scene = await registry.call('godot_mcp_query', {
    port,
    toolName: 'read_scene',
    arguments: { scene_path: 'res://main.tscn' },
  });
  assert.equal(scene.result.root.name, 'Root');

  await assert.rejects(
    registry.call('godot_mcp_query', {
      port,
      toolName: 'create_scene',
      arguments: { scene_path: 'res://blocked.tscn' },
    }),
    /not in the MauroPrime read-only allowlist/,
  );

  const capture = await registry.call('godot_screen_capture_save', {
    port,
    resourcePath: 'res://capture.png',
  });
  assert.equal(capture.width, 1);
  assert.equal(capture.height, 1);
  assert.equal(capture.bytes, png.length);
  assert.match(capture.sha256, /^[0-9a-f]{64}$/);
  assert.equal(capture.__bridgeImages.length, 1);

  console.log(JSON.stringify({
    ok: true,
    status: 'authenticated',
    safeTools: catalog.tools.map((tool) => tool.name),
    mutationBlocked: true,
    capture: { bytes: capture.bytes, sha256: capture.sha256 },
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}
