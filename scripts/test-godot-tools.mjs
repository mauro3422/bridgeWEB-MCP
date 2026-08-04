import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const tempRoot = path.join(repoRoot, '.tmp', 'godot-tools-test');
const capturePath = path.join(tempRoot, 'capture.png');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2xkAAAAAASUVORK5CYII=', 'base64');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const advertisedTools = [
  { name: 'read_scene', description: 'Read a Godot scene.', inputSchema: { type: 'object' } },
  { name: 'take_screenshot', description: 'Capture the game viewport.', inputSchema: { type: 'object' } },
  { name: 'create_scene', description: 'Create a scene.', inputSchema: { type: 'object' } },
];
const observedCalls = [];

const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ server: 'godot-mcp-server', version: 'test', tool_count: advertisedTools.length + 2 }));
    return;
  }
  if (req.method === 'GET' && req.url === '/tools') {
    res.end(JSON.stringify({ tools: advertisedTools }));
    return;
  }
  if (req.method === 'POST' && req.url === '/tool') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    observedCalls.push(body);
    let payload;
    if (body.name === 'get_godot_status') {
      payload = {
        connected: true,
        tool_mode: 'full',
        project_path: 'C:/Dev/godot-test/',
        project_id: '0123456789abcdef',
        project_name: 'Godot Test',
        editor_instance_id: 'editor-test',
        runtime_instance_id: 'runtime-test',
      };
    } else if (body.name === 'read_scene') {
      payload = { scene_path: 'res://main.tscn', root: { name: 'Root', type: 'Node3D', children: [] } };
    } else if (body.name === 'create_scene') {
      payload = { created: true, scene_path: body.args.scene_path, node_count: 1 };
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
  assert.equal(status.status.tool_mode, 'full');

  const catalog = await registry.call('godot_mcp_tool_list', { port, includeSchemas: false });
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), ['create_scene', 'read_scene', 'take_screenshot']);
  assert.equal(catalog.providerCount, 3);
  assert.equal(catalog.toolCount, 3);
  assert.equal(catalog.readOnlyCount, 2);
  assert.equal(catalog.actionCount, 1);
  assert.equal(catalog.tools.find((tool) => tool.name === 'create_scene').classification, 'action');

  const instances = await registry.call('godot_mcp_instance_list', { port });
  assert.equal(instances.instances[0].editorInstanceId, 'editor-test');
  assert.equal(instances.instances[0].runtimeConnected, true);
  assert.equal(instances.instances[0].mode, 'full');

  const scene = await registry.call('godot_mcp_query', {
    port,
    toolName: 'read_scene',
    arguments: { scene_path: 'res://main.tscn' },
  });
  assert.equal(scene.classification, 'read-only');
  assert.equal(scene.result.root.name, 'Root');

  await assert.rejects(
    registry.call('godot_mcp_query', {
      port,
      toolName: 'create_scene',
      arguments: { scene_path: 'res://wrong-route.tscn' },
    }),
    /not classified read-only; use godot_mcp_action/,
  );

  await assert.rejects(
    registry.call('godot_mcp_action', {
      port,
      toolName: 'read_scene',
      arguments: { scene_path: 'res://main.tscn' },
    }),
    /classified read-only; use godot_mcp_query/,
  );

  const created = await registry.call('godot_mcp_action', {
    port,
    toolName: 'create_scene',
    arguments: { scene_path: 'res://created-by-action.tscn', root_type: 'Node3D' },
  });
  assert.equal(created.classification, 'action');
  assert.equal(created.result.created, true);
  assert.equal(created.result.scene_path, 'res://created-by-action.tscn');
  const createCall = observedCalls.find((call) => call.name === 'create_scene');
  assert.equal(createCall.args.root_type, 'Node3D');

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
    status: 'localhost-only-full',
    catalog: {
      tools: catalog.toolCount,
      readOnly: catalog.readOnlyCount,
      actions: catalog.actionCount,
    },
    actionDispatched: created.result.scene_path,
    routeSeparationVerified: true,
    capture: { bytes: capture.bytes, sha256: capture.sha256 },
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}
