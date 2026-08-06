import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const addonPath = path.join(root, 'integrations', 'blender', 'mauro_blender_bridge.py');
const toolsPath = path.join(root, 'src', 'tools', 'blender-tools.ts');
const imageToolPath = path.join(root, 'src', 'tools', 'image-tools.ts');
const preparePath = path.join(root, 'integrations', 'images', 'prepare_reference_pack.py');

const [addon, tools, imageTools, prepare] = await Promise.all([
  fs.readFile(addonPath, 'utf8'),
  fs.readFile(toolsPath, 'utf8'),
  fs.readFile(imageToolPath, 'utf8'),
  fs.readFile(preparePath, 'utf8'),
]);

for (const expected of [
  '"version": (0, 3, 0)',
  'last_human_or_external_update_at',
  'last_bridge_scene_update_at',
  'last_file_save_at',
  'last_scene_update_source',
  '_register_activity_handlers()',
  '_unregister_activity_handlers()',
  '_BRIDGE_MUTATION_GRACE_UNTIL',
  '"runtime": _runtime_status()',
]) assert(addon.includes(expected), `missing addon contract: ${expected}`);

for (const expected of [
  'type BlenderOperationMode = "reference-only" | "inspect" | "scene-write" | "foreground-capture"',
  'expectedBlendFile',
  'exactTargetMatch',
  'recentHumanOrExternalActivity',
  'refusing to redirect it',
  'Additional Blender processes are warnings, not auto-closed',
  '].join("\\n")',
  'Reference-only mode forbids opening, focusing, capturing, mutating, or saving',
  'Human-or-external scene activity was observed',
]) assert(tools.includes(expected), `missing Blender session guard: ${expected}`);

for (const toolName of [
  'blender_scene_info',
  'blender_viewport_screenshot',
  'blender_focus_review',
  'blender_review_bundle',
  'blender_execute_code',
]) {
  const toolIndex = tools.indexOf(`name: "${toolName}"`);
  assert(toolIndex >= 0, `missing tool ${toolName}`);
  const contractWindow = tools.slice(toolIndex, toolIndex + 2600);
  assert(contractWindow.includes('expectedBlendFile'), `${toolName} does not expose expectedBlendFile`);
}

for (const expected of [
  'operationMode: z.enum(["reference-only", "offline-preparation"])',
  'userModeling: z.boolean().default(false)',
  'targetBlendFile: z.string().optional()',
  'userModeling=true requires operationMode=reference-only',
]) assert(imageTools.includes(expected), `missing reference-only image contract: ${expected}`);

for (const expected of [
  '"blenderInteractionAllowed": False',
  '"installationDeferred": operation_mode == "reference-only"',
  '"forbiddenLiveTools"',
  'atomic_write_json(manifest_path, manifest)',
  'Reference-pack manifest readback does not match',
]) assert(prepare.includes(expected), `missing persisted preparation contract: ${expected}`);

console.log(JSON.stringify({
  ok: true,
  addonVersion: '0.3.0',
  operationModes: ['reference-only', 'inspect', 'scene-write', 'foreground-capture'],
  exactTargetGuards: true,
  humanActivityGuard: true,
  atomicReferenceManifest: true,
}, null, 2));
