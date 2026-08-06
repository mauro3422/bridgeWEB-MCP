import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { imageToolModule } from '../dist/tools/image-tools.js';
import { blenderToolModule } from '../dist/tools/blender-tools.js';

const root = path.join(process.cwd(), '.tmp', 'blender-reference-pipeline-test');
const sourceDir = path.join(root, 'source');
const preparedDir = path.join(root, 'prepared');
const manifestPath = path.join(preparedDir, 'workbench_reference-pack.json');
const blendPath = path.join(root, 'workbench_references.blend');

await fs.rm(root, {recursive:true, force:true});
await fs.mkdir(sourceDir, {recursive:true});

const python = String.raw`
from PIL import Image, ImageDraw
from pathlib import Path
import sys
root = Path(sys.argv[1])
roles = ['front','rear','left','right','top','front_right_3q']
for index, role in enumerate(roles):
    image = Image.new('RGB', (900, 900), 'white')
    draw = ImageDraw.Draw(image)
    x0 = 145 + index * 7
    y0 = 180 + index * 5
    x1 = 755 - index * 6
    y1 = 720 - index * 4
    draw.rounded_rectangle((x0,y0,x1,y1), radius=35 + index, fill=(40 + index*22, 80 + index*15, 120 + index*10), outline='black', width=9)
    draw.rectangle((x0 + 80 + index*3, y1 - 85, x1 - 70, y1 - 35), fill=(220-index*8, 150+index*5, 70+index*9))
    draw.text((30,30), role, fill='black')
    image.save(root / f'{role}.png')
`;
execFileSync('python', ['-c', python, sourceDir], {stdio:'inherit'});

const roles = ['front','rear','left','right','top','front_right_3q'];
const prep = await imageToolModule.handlers.image_reference_pack_prepare({
  baseName:'workbench',
  assetKind:'prop',
  items: roles.map((role) => ({
    role,
    inputPath:path.join(sourceDir, `${role}.png`),
    usage: role.endsWith('_3q') ? 'design' : 'construction',
    projection: role.endsWith('_3q') ? 'perspective' : 'orthographic',
    semanticQa:{status:'pass',notes:['fixture visually classified']},
    landmarks: role === 'front' ? {ground:{x:0.5,y:0.8},top:{x:0.5,y:0.2}} : {},
  })),
  masters:{geometry:'front',design:'front_right_3q'},
  operationMode:'reference-only',
  userModeling:true,
  targetBlendFile:blendPath,
  outputDir:preparedDir,
  manifestPath,
  targetWidth:1000,
  targetHeight:1000,
  alignment:'center',
  outputFormat:'png',
  overwrite:false,
});
assert.equal(prep.stage, 'prepared');
assert.equal(prep.manifest.items.length, 6);
assert.equal(prep.manifest.kind, 'blender-reference-pack');
assert.equal(prep.manifest.coordination.operationMode, 'reference-only');
assert.equal(prep.manifest.coordination.userModeling, true);
assert.equal(prep.manifest.coordination.blenderInteractionAllowed, false);
assert.equal(prep.manifest.coordination.installationDeferred, true);
assert.equal(prep.manifest.coordination.targetBlendFile, path.resolve(blendPath));
assert(prep.manifest.coordination.forbiddenLiveTools.includes('blender_viewport_screenshot'));

const validation = await blenderToolModule.handlers.blender_validate_reference_pack({
  manifestPath,
  requiredRoles:['front','rear','left','right','top'],
  requireSemanticQa:true,
  strictWarnings:false,
});
assert.equal(validation.valid, true, JSON.stringify(validation.errors));
assert.equal(validation.items.length, 6);

const originalManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const blockedManifest = structuredClone(originalManifest);
blockedManifest.items.find((item) => item.role === 'rear').semanticQa.status = 'pending';
await fs.writeFile(manifestPath, JSON.stringify(blockedManifest, null, 2));
const blocked = await blenderToolModule.handlers.blender_validate_reference_pack({
  manifestPath,
  requiredRoles:['front','rear'],
  requireSemanticQa:true,
  strictWarnings:false,
});
assert.equal(blocked.valid, false);
assert(blocked.errors.includes('semantic_qa_pending:rear'));
await fs.writeFile(manifestPath, JSON.stringify(originalManifest, null, 2));

const installed = await blenderToolModule.handlers.blender_install_reference_pack({
  manifestPath,
  outputBlend:blendPath,
  layout:'axis_aligned',
  displaySize:2,
  opacity:0.45,
  requiredRoles:['front','rear','left','right','top'],
  requireSemanticQa:true,
  strictWarnings:false,
  overwrite:false,
  openAfter:false,
  timeoutMs:240000,
});
assert.equal(installed.stage, 'blend_created');
const installManifest = JSON.parse(await fs.readFile(installed.installManifestPath, 'utf8'));
const objects = new Map(installManifest.objects.map((item) => [item.role, item]));
assert.equal(objects.size, 6);
for (const role of ['front','rear','left','right','top']) {
  const item = objects.get(role);
  assert(item, `missing installed role ${role}`);
  assert.equal(item.imageDepth, 'BACK');
  assert.equal(item.hideSelect, true);
  assert.equal(item.hideRender, true);
  assert.equal(item.showInFront, false);
  assert.equal(item.supportedProperties.axisAlignedOnly, true);
  assert.equal(item.supportedProperties.orthographicVisible, true);
  assert.equal(item.supportedProperties.perspectiveHidden, true);
}
assert.equal(objects.get('front').imageSide, 'FRONT');
assert.equal(objects.get('rear').imageSide, 'BACK');
assert.equal(objects.get('right').imageSide, 'FRONT');
assert.equal(objects.get('left').imageSide, 'BACK');
assert.equal(objects.get('front_right_3q').hidden, true);

console.log(JSON.stringify({
  ok:true,
  manifestPath,
  outputBlend:blendPath,
  installManifestPath:installed.installManifestPath,
  roles:[...objects.keys()],
  blockingQaVerified:true,
}, null, 2));

if (process.env.KEEP_BLENDER_REFERENCE_TEST !== '1') await fs.rm(root, {recursive:true, force:true});
