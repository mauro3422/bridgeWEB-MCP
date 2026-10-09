import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const toolsPath = path.join(root, 'src', 'tools', 'blender-tools.ts');
const registryPath = path.join(root, 'src', 'tool-registry.ts');
const reviewPath = path.join(root, 'integrations', 'blender', 'create_animation_review.py');

const [toolsSource, registrySource, reviewSource] = await Promise.all([
  fs.readFile(toolsPath, 'utf8'),
  fs.readFile(registryPath, 'utf8'),
  fs.readFile(reviewPath, 'utf8'),
]);

for (const expected of [
  'name: "blender_rig_inspect"',
  'async function inspectBlenderRig',
  "hasattr(action, 'layers')",
  "hasattr(strip, 'channelbags')",
  'animated_bones',
  'nla_tracks',
  'expectedBlendFile',
]) {
  assert(toolsSource.includes(expected), `missing rig-inspection contract: ${expected}`);
}

for (const expected of [
  'name: "blender_animation_review"',
  'async function createAnimationReview',
  'frames must not contain duplicates',
  'create_animation_review.py',
  'transport: "use-image_file_attach"',
  'operationMode: "scene-write"',
]) {
  assert(toolsSource.includes(expected), `missing animation-review tool contract: ${expected}`);
}

for (const expected of [
  'name: "blender_ik_keyframe"',
  'async function keyframeBlenderIk',
  'clamp_to_reach',
  'allowed_reach',
  'actual_error',
  "constraints.new('IK')",
  "constraints.new('DAMPED_TRACK')",
  "key.interpolation = 'BEZIER'",
  'operationMode: "scene-write"',
]) {
  assert(toolsSource.includes(expected), `missing IK-keyframe tool contract: ${expected}`);
}

for (const expected of [
  '"blender_rig_inspect"',
  '"blender_animation_review"',
  '"blender_ik_keyframe"',
]) {
  assert(registrySource.includes(expected), `missing risk classification entry: ${expected}`);
}
assert(
  registrySource.indexOf('"blender_rig_inspect"') < registrySource.indexOf('const destructiveToolNames'),
  'blender_rig_inspect must remain read-only',
);
assert(
  registrySource.indexOf('"blender_animation_review"') > registrySource.indexOf('const destructiveToolNames'),
  'blender_animation_review must remain destructive',
);
assert(
  registrySource.indexOf('"blender_ik_keyframe"') > registrySource.indexOf('const destructiveToolNames'),
  'blender_ik_keyframe must remain destructive',
);

for (const expected of [
  '"mode": "fixed-across-frames"',
  'union_points',
  'configure_camera(camera, union_center, union_points, view, margin)',
  'scene.frame_set(saved_scene["frame"])',
  'saved_hide_render',
  'saved_shading',
  'contact_sheet',
  'animation_review_created',
]) {
  assert(reviewSource.includes(expected), `missing animation-review runtime contract: ${expected}`);
}

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const registry = createDefaultToolRegistry();
const rigTool = registry.tools.find((tool) => tool.name === 'blender_rig_inspect');
const reviewTool = registry.tools.find((tool) => tool.name === 'blender_animation_review');
const ikTool = registry.tools.find((tool) => tool.name === 'blender_ik_keyframe');
assert(rigTool, 'blender_rig_inspect missing from built registry');
assert(reviewTool, 'blender_animation_review missing from built registry');
assert(ikTool, 'blender_ik_keyframe missing from built registry');
assert.equal(rigTool.annotations?.readOnlyHint, true, 'rig inspector must be read-only');
assert.equal(rigTool.annotations?.destructiveHint, false, 'rig inspector must not be destructive');
assert.equal(reviewTool.annotations?.readOnlyHint, false, 'animation review writes artifacts');
assert.equal(reviewTool.annotations?.destructiveHint, true, 'animation review must be destructive');
assert.equal(ikTool.annotations?.readOnlyHint, false, 'IK keyframe mutates animation data');
assert.equal(ikTool.annotations?.destructiveHint, true, 'IK keyframe must be destructive');
assert.deepEqual(rigTool.inputSchema?.required, ['expectedBlendFile']);
assert.deepEqual(reviewTool.inputSchema?.required, ['expectedBlendFile', 'outputDir', 'frames']);
assert.deepEqual(ikTool.inputSchema?.required, ['expectedBlendFile', 'armatureName', 'endBone', 'target', 'frame']);

console.log(JSON.stringify({
  ok: true,
  tools: ['blender_rig_inspect', 'blender_animation_review', 'blender_ik_keyframe'],
  blender5ActionApiCompatibility: true,
  fixedCameraAcrossFrames: true,
  encodedImageTransport: false,
}, null, 2));
