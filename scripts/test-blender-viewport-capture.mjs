import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { blenderToolModule } from '../dist/tools/blender-tools.js';

const tool = blenderToolModule.tools.find((candidate) => candidate.name === 'blender_viewport_screenshot');
assert(tool, 'blender_viewport_screenshot must remain registered');
assert.match(tool.description, /exact connected Blender 3D viewport/i, 'tool description must promise the exact connected viewport');
assert.match(tool.description, /temporarily focus Blender/i, 'tool description must disclose the focus side effect');
assert.match(tool.description, /reviewing the saved pixels/i, 'tool description must not treat metadata as semantic proof');

const settleSchema = tool.inputSchema?.properties?.settleMs;
assert(settleSchema, 'settleMs schema is required');
assert.equal(settleSchema.default, 650);
assert.equal(settleSchema.minimum, 100);
assert.equal(settleSchema.maximum, 5000);

const addonPath = path.join(process.cwd(), 'integrations', 'blender', 'mauro_blender_bridge.py');
const addon = await fs.readFile(addonPath, 'utf8');
assert.match(addon, /def _viewport_capture_context\(\):/, 'addon must expose capture context instead of screenshot pixels');
assert.match(addon, /"pid": os\.getpid\(\)/, 'capture context must identify the exact Blender process');
assert.match(addon, /"region": \{/, 'capture context must expose exact viewport region bounds');
assert.match(addon, /"rotation": \[float\(value\) for value in region_3d\.view_rotation\]/, 'capture context must expose observed orientation');
assert.match(addon, /elif command_type == "get_viewport_capture_context":/, 'capture-context command must be dispatched');
assert.match(addon, /Direct Blender framebuffer screenshots are freshness-unsafe/, 'legacy direct framebuffer command must fail explicitly');
assert.doesNotMatch(addon, /bpy\.ops\.screen\.screenshot_area/, 'freshness-unsafe screenshot_area backend must not remain');

const handlerSource = await fs.readFile(path.join(process.cwd(), 'src', 'tools', 'blender-tools.ts'), 'utf8');
assert.match(handlerSource, /sendBlenderCommand\("get_viewport_capture_context"/, 'TypeScript handler must obtain exact live capture context');
assert.match(handlerSource, /blender-viewport-window-capture\.ps1/, 'TypeScript handler must invoke the exact-window capture helper');
assert.match(handlerSource, /-TargetProcessId/, 'TypeScript handler must pin capture to the Blender PID');
assert.match(handlerSource, /-ViewportX/, 'TypeScript handler must forward viewport bounds');
assert.match(handlerSource, /-MaxSize/, 'TypeScript handler must forward output size bounds');

const helper = await fs.readFile(path.join(process.cwd(), 'scripts', 'blender-viewport-window-capture.ps1'), 'utf8');
assert.match(helper, /GetClientRect/, 'window helper must resolve Blender client bounds');
assert.match(helper, /ClientToScreen/, 'window helper must map Blender client coordinates to screen coordinates');
assert.match(helper, /GetForegroundWindow\(\) -ne \$handle/, 'window helper must refuse unverified focus');
assert.match(helper, /CopyFromScreen\(/, 'window helper must capture presented pixels instead of stale bpy framebuffer memory');
assert.match(helper, /exact-Blender-client-viewport/, 'window helper must report its capture backend');

console.log(JSON.stringify({
  ok: true,
  tool: tool.name,
  settleMs: settleSchema.default,
  contract: 'exact-foreground-blender-client-viewport',
}, null, 2));
