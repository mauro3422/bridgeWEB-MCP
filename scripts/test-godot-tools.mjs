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
  { name: 'scene_tree_dump', description: 'Read the active edited scene.', inputSchema: { type: 'object' } },
  { name: 'get_editor_scene_state', description: 'Read all open editor scenes.', inputSchema: { type: 'object' } },
  { name: 'take_screenshot', description: 'Capture the game viewport.', inputSchema: { type: 'object' } },
  { name: 'create_scene', description: 'Create a scene.', inputSchema: { type: 'object' } },
  { name: 'open_in_godot', description: 'Open a resource in the connected Godot editor.', inputSchema: { type: 'object' } },
  { name: 'set_open_scenes', description: 'Replace the exact editor scene set.', inputSchema: { type: 'object' } },
];
const observedCalls = [];
let openScenePaths = ['res://demo/instance_host.tscn', 'res://demo/instanced_component.tscn'];
let unsavedScenePaths = [];
let activeScenePath = 'res://demo/instance_host.tscn';

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
      const targetPath = body.target?.projectPath ?? 'C:/Dev/godot-test/';
      const selected = targetPath.includes('other')
        ? { project_path: 'C:/Dev/other/', project_id: 'fedcba9876543210', project_name: 'Other Godot', editor_instance_id: 'editor-other' }
        : { project_path: 'C:/Dev/godot-test/', project_id: '0123456789abcdef', project_name: 'Godot Test', editor_instance_id: 'editor-test' };
      payload = {
        connected: true,
        tool_mode: 'full',
        ...selected,
        runtime_instance_id: 'runtime-test',
        editor_count: 2,
        instances: [
          { project_path: 'C:/Dev/godot-test/', project_id: '0123456789abcdef', project_name: 'Godot Test', editor_instance_id: 'editor-test', connected_at: '2026-08-14T00:00:00.000Z' },
          { project_path: 'C:/Dev/other/', project_id: 'fedcba9876543210', project_name: 'Other Godot', editor_instance_id: 'editor-other', connected_at: '2026-08-14T00:00:01.000Z' },
        ],
      };
    } else if (body.name === 'read_scene') {
      payload = { scene_path: body.args.scene_path, root: { name: 'Root', type: 'Node3D', children: [] } };
    } else if (body.name === 'scene_tree_dump') {
      payload = { ok: true, scene_path: activeScenePath, tree: 'Root (Node3D)' };
    } else if (body.name === 'get_editor_scene_state') {
      payload = {
        ok: true,
        open_scenes: [...openScenePaths],
        unsaved_scenes: [...unsavedScenePaths],
        active_scene: activeScenePath,
      };
    } else if (body.name === 'create_scene') {
      payload = { created: true, scene_path: body.args.scene_path, node_count: 1 };
    } else if (body.name === 'open_in_godot') {
      activeScenePath = body.args.path;
      if (!openScenePaths.includes(activeScenePath)) openScenePaths.push(activeScenePath);
      payload = { ok: true, message: `Opened ${body.args.path}` };
    } else if (body.name === 'set_open_scenes') {
      if (unsavedScenePaths.length) {
        payload = { ok: false, error: 'Refusing to replace the open scene set while unsaved scenes exist', open_scenes: [...openScenePaths], unsaved_scenes: [...unsavedScenePaths] };
      } else {
        openScenePaths = [...body.args.scene_paths];
        activeScenePath = body.args.active_scene_path ?? openScenePaths.at(-1);
        payload = { ok: true, verified: true, open_scenes: [...openScenePaths], unsaved_scenes: [], active_scene: activeScenePath };
      }
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
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), ['create_scene', 'get_editor_scene_state', 'open_in_godot', 'read_scene', 'scene_tree_dump', 'set_open_scenes', 'take_screenshot']);
  assert.equal(catalog.providerCount, 7);
  assert.equal(catalog.toolCount, 7);
  assert.equal(catalog.readOnlyCount, 4);
  assert.equal(catalog.actionCount, 3);
  assert.equal(catalog.tools.find((tool) => tool.name === 'create_scene').classification, 'action');

  const instances = await registry.call('godot_mcp_instance_list', { port });
  assert.equal(instances.instances.length, 2);
  assert.equal(instances.instances[0].editorInstanceId, 'editor-test');
  assert.equal(instances.instances[0].runtimeConnected, true);
  assert.equal(instances.instances[0].mode, 'full');
  assert.equal(instances.instances[1].editorInstanceId, 'editor-other');

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

  await assert.rejects(
    registry.call('godot_scene_open', { port, scenePaths: ['res://fixtures/a.tscn'] }),
    /Multiple Godot editors are connected/,
  );

  const openedScenes = await registry.call('godot_scene_open', {
    port,
    projectPath: 'C:/Dev/godot-test/',
    scenePaths: ['res://fixtures/a.tscn', 'res://fixtures/b.tscn'],
    activeScenePath: 'res://fixtures/a.tscn',
  });
  assert.equal(openedScenes.uiAutomation, false);
  assert.equal(openedScenes.verified, true);
  assert.equal(openedScenes.opened.length, 2);
  assert.equal(openedScenes.activeScenePath, 'res://fixtures/a.tscn');
  assert.equal(openedScenes.opened[0].readback.scenePath, 'res://fixtures/a.tscn');
  assert.equal(openedScenes.sceneSetMode, 'merge');
  assert.equal(openedScenes.requestedSetVerified, true);
  assert.equal(openedScenes.exactSetVerified, false);
  assert.deepEqual(openedScenes.unexpectedOpenScenes, ['res://demo/instance_host.tscn', 'res://demo/instanced_component.tscn']);
  assert.equal(activeScenePath, 'res://fixtures/a.tscn');
  assert(observedCalls.some((call) => call.name === 'open_in_godot' && call.args.path === 'res://fixtures/b.tscn'));
  assert(observedCalls.some((call) => call.name === 'scene_tree_dump'));
  assert(observedCalls.some((call) => call.name === 'get_editor_scene_state'));

  const exactScenes = await registry.call('godot_scene_open', {
    port,
    projectPath: 'C:/Dev/godot-test/',
    scenePaths: ['res://fixtures/a.tscn', 'res://fixtures/b.tscn'],
    activeScenePath: 'res://fixtures/a.tscn',
    sceneSetMode: 'exact',
  });
  assert.equal(exactScenes.verified, true);
  assert.equal(exactScenes.exactSetVerified, true);
  assert.deepEqual(exactScenes.openScenes, ['res://fixtures/a.tscn', 'res://fixtures/b.tscn']);
  assert.deepEqual(exactScenes.unexpectedOpenScenes, []);
  assert.equal(exactScenes.nativeProviderOperation, 'set_open_scenes');
  assert(observedCalls.some((call) => call.name === 'set_open_scenes'));

  unsavedScenePaths = ['res://fixtures/a.tscn'];
  await assert.rejects(
    registry.call('godot_scene_open', {
      port,
      projectPath: 'C:/Dev/godot-test/',
      scenePaths: ['res://fixtures/a.tscn'],
      sceneSetMode: 'exact',
    }),
    /Refusing to replace the open scene set while unsaved scenes exist/,
  );
  assert.deepEqual(openScenePaths, ['res://fixtures/a.tscn', 'res://fixtures/b.tscn']);
  unsavedScenePaths = [];

  await assert.rejects(
    registry.call('godot_scene_open', { port, scenePaths: ['C:/wrong.tscn'] }),
    /must start with res:\/\//,
  );
  await assert.rejects(
    registry.call('godot_scene_open', { port, scenePaths: ['res://not-a-scene.txt'] }),
    /must end in \.tscn or \.scn/,
  );
  await assert.rejects(
    registry.call('godot_scene_open', {
      port,
      scenePaths: ['res://fixtures/a.tscn'],
      activeScenePath: 'res://fixtures/b.tscn',
    }),
    /must also appear in scenePaths/,
  );

  const dedicatedCreated = await registry.call('godot_scene_create', {
    port,
    projectPath: 'C:/Dev/godot-test/',
    scenePath: 'res://fixtures/dedicated-created.tscn',
    rootNodeType: 'Node3D',
    rootNodeName: 'DedicatedCreated',
    nodes: [{ name: 'Child', type: 'Node' }],
    openInEditor: true,
  });
  assert.equal(dedicatedCreated.created, true);
  assert.equal(dedicatedCreated.verified, true);
  assert.equal(dedicatedCreated.uiAutomation, false);
  assert.equal(dedicatedCreated.openedInEditor, true);
  assert.equal(dedicatedCreated.activeScenePath, 'res://fixtures/dedicated-created.tscn');
  const dedicatedCreateCall = observedCalls.filter((call) => call.name === 'create_scene').at(-1);
  assert.equal(dedicatedCreateCall.args.scene_path, 'res://fixtures/dedicated-created.tscn');
  assert.equal(dedicatedCreateCall.args.root_node_type, 'Node3D');
  assert.equal(dedicatedCreateCall.args.root_node_name, 'DedicatedCreated');
  assert.deepEqual(dedicatedCreateCall.args.nodes, [{ name: 'Child', type: 'Node' }]);

  const noOpenCreateCallsBefore = observedCalls.filter((call) => call.name === 'open_in_godot').length;
  const dedicatedCreatedWithoutOpen = await registry.call('godot_scene_create', {
    port,
    projectPath: 'C:/Dev/godot-test/',
    scenePath: 'res://fixtures/persist-only.tscn',
    rootNodeType: 'Node2D',
    openInEditor: false,
  });
  assert.equal(dedicatedCreatedWithoutOpen.verified, true);
  assert.equal(dedicatedCreatedWithoutOpen.openedInEditor, false);
  assert.equal(observedCalls.filter((call) => call.name === 'open_in_godot').length, noOpenCreateCallsBefore);

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
