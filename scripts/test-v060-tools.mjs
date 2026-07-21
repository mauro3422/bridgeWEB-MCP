import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-v060-regression-'));
process.env.BRIDGE_MCP_CACHE_DIR = path.join(sandbox, 'cache-store');
process.env.BRIDGE_MCP_SNAPSHOT_DIR = path.join(sandbox, 'snapshot-store');
process.env.BRIDGE_MCP_BINARY_UPLOAD_DIR = path.join(sandbox, 'binary-upload-store');
const fixtureCodexHome = path.join(sandbox, 'codex-home');
process.env.CODEX_HOME = fixtureCodexHome;
const fixtureSkillRoot = path.join(fixtureCodexHome, 'skills');
const writeFixtureSkill = (name, description) => {
  const directory = path.join(fixtureSkillRoot, name);
  fs.mkdirSync(directory, {recursive:true});
  fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nFixture guidance.\n`);
};
writeFixtureSkill('roblox-mcp-skill-router', 'Route substantial Roblox work through local and live Roblox skills.');
writeFixtureSkill('roblox-safe-editing', 'Apply safe ordered Roblox mutations.');
writeFixtureSkill('roblox-connection-network-authoring', 'Create reusable port and cable networks in Roblox.');
writeFixtureSkill('roblox-playtest', 'Run focused Roblox gameplay tests.');
writeFixtureSkill('roblox-studio-qa', 'Inspect Roblox structure, visuals, and console output.');
writeFixtureSkill('roblox-save-backup-recovery', 'Save and back up local Roblox places.');
const linkedSkillSource = path.join(sandbox, 'linked-skill-source', 'linked-junction-skill');
fs.mkdirSync(linkedSkillSource, {recursive:true});
fs.writeFileSync(path.join(linkedSkillSource, 'SKILL.md'), '---\nname: linked-junction-skill\ndescription: Verify safe discovery through a directory junction.\n---\n\n# linked-junction-skill\n\nFixture guidance.\n');
fs.symlinkSync(linkedSkillSource, path.join(fixtureSkillRoot, 'linked-junction-skill'), process.platform === 'win32' ? 'junction' : 'dir');
fs.mkdirSync(path.join(fixtureSkillRoot, '_dashboard'), {recursive:true});
fs.writeFileSync(path.join(fixtureSkillRoot, '_dashboard', 'skill-routing-overrides.json'), JSON.stringify({
  schemaVersion: 1,
  skills: {
    'roblox-mcp-skill-router': {phase:'discovery',domains:['roblox'],actions:['discover','coordinate'],artifacts:['game','mcp'],needs:[],requires:[],complements:[],excludes:[],negativeIntents:[],priority:96,activation:'always'},
    'roblox-safe-editing': {phase:'safety',domains:['roblox'],actions:['create','edit'],artifacts:['game','network-system'],needs:['safe-editing'],requires:['roblox-mcp-skill-router'],complements:[],excludes:[],negativeIntents:['read-only'],priority:95,activation:'on-demand'},
    'roblox-connection-network-authoring': {phase:'implementation',domains:['roblox'],actions:['design','create','edit'],artifacts:['network-system','resource-system'],needs:['safe-editing'],requires:['roblox-safe-editing'],complements:[],excludes:[],negativeIntents:[],priority:90,activation:'on-demand'},
    'roblox-playtest': {phase:'verification',domains:['roblox'],actions:['test','debug'],artifacts:['game','network-system','resource-system'],needs:['playtest'],requires:['roblox-mcp-skill-router'],complements:[],excludes:[],negativeIntents:[],priority:91,activation:'on-demand'},
    'roblox-studio-qa': {phase:'verification',domains:['roblox'],actions:['review','test'],artifacts:['game'],needs:['visual-qa'],requires:['roblox-mcp-skill-router'],complements:[],excludes:[],negativeIntents:[],priority:89,activation:'on-demand'},
    'roblox-save-backup-recovery': {phase:'persistence',domains:['roblox'],actions:['save','recover'],artifacts:['game'],needs:['backup'],requires:[],complements:[],excludes:[],negativeIntents:['read-only'],priority:98,activation:'on-demand'},
    'linked-junction-skill': {phase:'discovery',domains:['skill-system'],actions:['discover'],artifacts:['skill'],needs:[],requires:[],complements:[],excludes:[],negativeIntents:[],priority:10,activation:'on-demand'},
  },
  workflows: [{name:'roblox-development',match:{domains:['roblox']},phases:[
    {phase:'discovery',skills:['roblox-mcp-skill-router'],required:true},
    {phase:'safety',skills:['roblox-safe-editing'],required:true,when:{risks:['write','destructive']}},
    {phase:'verification',skills:['roblox-playtest','roblox-studio-qa'],required:true,when:{actions:['create','edit','test','debug']}},
    {phase:'persistence',skills:['roblox-save-backup-recovery'],required:true,when:{risks:['write','destructive']}},
  ]}],
}, null, 2));
process.env.BRIDGE_MCP_SKILL_ROUTING_PATH = path.join(fixtureSkillRoot, '_dashboard', 'skill-routing-overrides.json');
process.env.BRIDGE_MCP_SKILL_ROUTING_FIXTURES_PATH = path.join(fixtureSkillRoot, '_dashboard', 'skill-routing-fixtures.json');

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const { writePersistentCache } = await import('../dist/tools/shared/persistent-cache.js');
const registry = createDefaultToolRegistry();
const call = (name, args = {}) => registry.call(name, args);
const root = path.join(sandbox, 'project');
fs.mkdirSync(root, {recursive:true});

try {
  if (registry.tools.length !== 105) throw new Error(`expected 105 tools, got ${registry.tools.length}`);
  if (registry.riskSummary.neutral.length !== 0) throw new Error(`neutral tools remain: ${registry.riskSummary.neutral.join(', ')}`);
  for (const moduleName of ['project','workspace','cache','workflow-guides','skill-catalog-and-roblox-proxy','roblox-studio-ops','binary-files','images','blender']) if (!registry.modules.includes(moduleName)) throw new Error(`missing module ${moduleName}`);
  for (const toolName of ['project_context_load','workflow_guide_recommend','workflow_guide_load','workflow_guide_create','skill_catalog','skill_recommend','skill_route_audit','skill_route_plan','skill_bootstrap','skill_load','roblox_mcp_status','roblox_mcp_tool_list','roblox_mcp_query','roblox_mcp_action','roblox_place_save','binary_file_info','binary_file_read_chunk','binary_file_write','binary_upload_begin','binary_upload_append','binary_upload_status','binary_upload_finish','binary_upload_abort','image_asset_save','image_character_views_prepare','blender_status','blender_open','blender_scene_info','blender_viewport_screenshot','blender_review_bundle','blender_execute_code','blender_batch_script','blender_setup_character_references','blender_character_loop_status']) if (!registry.has(toolName)) throw new Error(`missing context/workflow/skill/Roblox/binary/image/Blender tool ${toolName}`);
  if (!registry.riskSummary.destructive.includes('roblox_mcp_action') || !registry.riskSummary.destructive.includes('roblox_place_save')) throw new Error('Roblox action/save risk classification failed');
  const reviewTool = registry.tools.find((tool) => tool.name === 'blender_review_bundle');
  if (!reviewTool || !registry.riskSummary.destructive.includes('blender_review_bundle')) throw new Error('Blender review bundle classification failed');
  if (!reviewTool.inputSchema?.properties?.views || !reviewTool.inputSchema?.properties?.outputDir) throw new Error('Blender review bundle schema failed');

  const junctionCatalog = await call('skill_catalog', {sources:['codex-local'],maxResults:50});
  if (!junctionCatalog.skills.some((skill) => skill.name === 'linked-junction-skill')) throw new Error('skill catalog did not follow an allowed directory junction');

  const structuredRoute = await call('skill_route_plan', {
    task:'Diseñar máquinas conectables por puertos, transportar recursos y guardar el proyecto',
    sources:['codex-local'],
    stage:'start',
    maxSkills:8,
    intent:{
      summary:'Sistema Roblox de conexiones y recursos con cambios persistentes',
      domains:['roblox'],
      actions:['design','create','edit'],
      artifacts:['network-system','resource-system','game'],
      needs:['safe-editing','playtest','backup'],
      risk:'write',
      ambiguity:'low',
    },
  });
  if (structuredRoute.classificationMode !== 'structured-semantic') throw new Error('structured skill routing mode failed');
  for (const name of ['roblox-mcp-skill-router','roblox-safe-editing','roblox-connection-network-authoring']) {
    if (!structuredRoute.loadOrder.includes(name)) throw new Error(`structured route missing active skill ${name}`);
  }
  for (const name of ['roblox-playtest','roblox-studio-qa','roblox-save-backup-recovery']) {
    if (!structuredRoute.deferredLoadOrder.includes(name)) throw new Error(`structured route missing deferred skill ${name}`);
  }
  if (!structuredRoute.coverage.requiredPhases.includes('verification') || !structuredRoute.coverage.requiredPhases.includes('persistence')) throw new Error('structured route phase coverage failed');

  const verificationRoute = await call('skill_route_plan', {
    task:'Verificar el mismo sistema Roblox',
    sources:['codex-local'],
    stage:'verify',
    completedPhases:['discovery','safety','implementation'],
    intent:{
      summary:'Verificación del sistema Roblox ya implementado',
      domains:['roblox'],
      actions:['test','review'],
      artifacts:['network-system','resource-system','game'],
      needs:['playtest','visual-qa'],
      risk:'write',
      ambiguity:'low',
    },
  });
  for (const name of ['roblox-mcp-skill-router','roblox-playtest','roblox-studio-qa']) {
    if (!verificationRoute.loadOrder.includes(name)) throw new Error(`verification route missing ${name}`);
  }
  if (verificationRoute.loadOrder.includes('roblox-save-backup-recovery')) throw new Error('verification route loaded persistence skill too early');

  const fallbackRoute = await call('skill_route_plan', {task:'conectar cositas en roblox y probarlas',sources:['codex-local'],stage:'start'});
  if (fallbackRoute.classificationMode !== 'lexical-fallback' || fallbackRoute.intent.ambiguity !== 'high') throw new Error('lexical fallback routing failed');

  const continuationRoute = await call('skill_route_plan', {
    task:'ok, hacelo',
    context:'La propuesta aceptada fue crear en Roblox una red conectable por puertos, editarla de forma segura, probarla y guardarla.',
    sources:['codex-local'],
    stage:'start',
  });
  if (!continuationRoute.contextUsed || !continuationRoute.loadOrder.includes('roblox-connection-network-authoring')) throw new Error('conversation continuation routing failed');

  const routeAudit = await call('skill_route_audit', {sources:['codex-local']});
  if (!routeAudit.ok || routeAudit.maintenanceRequired) throw new Error(`fixture routing audit failed: ${JSON.stringify({errors:routeAudit.errors,maintenance:routeAudit.maintenanceReasons})}`);

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name:'fixture-project',scripts:{build:'tsc',test:'node test.js'},devDependencies:{typescript:'1.0.0'}}, null, 2));
  fs.writeFileSync(path.join(root, 'app.txt'), 'original\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=test\n');
  fs.writeFileSync(path.join(root, '.env.development'), 'SECRET=dev\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Fixture agents\n\n- Verify project rules.\n');
  fs.mkdirSync(path.join(root, '.bridge'), {recursive:true});
  fs.writeFileSync(path.join(root, '.bridge', 'PROJECT_CONTEXT.md'), '# Fixture context\n\nProject-specific durable context.\n');
  fs.writeFileSync(path.join(root, '.bridge', 'PROJECT_STATE.md'), '# Fixture state\n\nCurrent milestone.\n');
  execFileSync('git', ['init', '-b', 'main'], {cwd:root,stdio:'ignore'});
  execFileSync('git', ['config', 'user.email', 'bridge@example.test'], {cwd:root});
  execFileSync('git', ['config', 'user.name', 'Bridge Test'], {cwd:root});
  execFileSync('git', ['add', 'package.json', 'app.txt', '.env.development'], {cwd:root,stdio:'ignore'});
  execFileSync('git', ['commit', '-m', 'initial'], {cwd:root,stdio:'ignore'});

  const projectContext = await call('project_context_load', {
    projectRoot:root,
    task:'Crear un personaje low poly y preparar las vistas para Blender',
  });
  if (projectContext.documents.length !== 3 || !projectContext.documents.some((item) => item.kind === 'agents') || !projectContext.documents.some((item) => item.kind === 'project-context') || !projectContext.documents.some((item) => item.kind === 'project-state')) throw new Error('project context documents failed');
  if (!projectContext.guides.some((item) => item.name === 'character-concept-blender') || projectContext.recommendation?.recommendation?.action !== 'load_existing') throw new Error('project context guide recommendation failed');

  const characterRecommendation = await call('workflow_guide_recommend', {
    task:'Cada vez que creemos un personaje furry low poly quiero generar frente costado espalda y pasarlo a Blender',
    projectRoot:root,
  });
  if (characterRecommendation.recommendation.action !== 'load_existing' || characterRecommendation.recommendation.guide !== 'character-concept-blender') throw new Error('character guide recommendation failed');
  const genericRecommendation = await call('workflow_guide_recommend', {
    task:'A futuro, cada vez que hagamos una migracion quiero un pipeline reutilizable con pruebas y rollback',
    projectRoot:root,
  });
  if (genericRecommendation.recommendation.action !== 'propose_new' || genericRecommendation.recommendation.builderGuide !== 'workflow-guide-builder') throw new Error('new guide recommendation failed');
  const createdGuide = await call('workflow_guide_create', {
    scope:'project',
    projectRoot:root,
    name:'fixture-release-check',
    title:'Fixture Release Check',
    description:'Reusable fixture release verification.',
    keywords:['release fixture','deploy fixture'],
    triggerPhrases:['verify fixture release'],
    negativeKeywords:['unrelated'],
    examples:['Verify the fixture release every time.'],
    phases:[{name:'verify',goal:'Verify the fixture release.',instructions:'Inspect, test, and record the result.'}],
    recommendedTools:['project_profile'],
  });
  if (!createdGuide.created || !fs.existsSync(createdGuide.manifestPath)) throw new Error('workflow guide creation failed');
  const projectRecommendation = await call('workflow_guide_recommend', {task:'Please verify fixture release',projectRoot:root});
  if (projectRecommendation.recommendation.guide !== 'fixture-release-check' || projectRecommendation.matches[0].scope !== 'project') throw new Error('project guide recommendation failed');
  const loadedGuide = await call('workflow_guide_load', {name:'fixture-release-check',phase:'verify',projectRoot:root});
  if (loadedGuide.guide !== 'fixture-release-check' || loadedGuide.phaseDocument?.phase !== 'verify' || !loadedGuide.entrypoint.text.includes('Fixture Release Check')) throw new Error('workflow guide loading failed');

  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg==';
  const singleImage = await call('image_asset_save', {
    items:[{outputPath:path.join(root,'images','single.png'),base64:tinyPng,role:'single',prompt:'fixture single'}],
  });
  if (singleImage.mode !== 'single' || singleImage.itemCount !== 1 || singleImage.saved[0].width !== 2 || !fs.existsSync(path.join(root,'images','single.png'))) throw new Error('single image save failed');
  const imageManifest = path.join(root,'images','batch.json');
  const batchImages = await call('image_asset_save', {
    collectionName:'fixture turnaround',
    manifestPath:imageManifest,
    items:[
      {outputPath:path.join(root,'images','front.png'),base64:tinyPng,role:'front'},
      {outputPath:path.join(root,'images','side.png'),base64:tinyPng,role:'side'},
    ],
  });
  const parsedImageManifest = JSON.parse(fs.readFileSync(imageManifest,'utf8'));
  if (batchImages.mode !== 'batch' || batchImages.itemCount !== 2 || parsedImageManifest.itemCount !== 2 || !fs.existsSync(path.join(root,'images','side.png'))) throw new Error('batch image save failed');
  await call('image_asset_save', {
    items:[
      {outputPath:path.join(root,'images','back.png'),base64:tinyPng,role:'back'},
      {outputPath:path.join(root,'images','three-quarter.png'),base64:tinyPng,role:'three-quarter'},
    ],
  });
  const preparedDir = path.join(root,'images','prepared');
  const preparedManifest = path.join(preparedDir,'fixture_prepared-manifest.json');
  const preparedViews = await call('image_character_views_prepare', {
    baseName:'fixture',
    items:[
      {role:'front',inputPath:path.join(root,'images','front.png')},
      {role:'side',inputPath:path.join(root,'images','side.png')},
      {role:'back',inputPath:path.join(root,'images','back.png')},
      {role:'three-quarter',inputPath:path.join(root,'images','three-quarter.png')},
    ],
    outputDir:preparedDir,
    manifestPath:preparedManifest,
    targetWidth:256,
    targetHeight:320,
  });
  if (preparedViews.stage !== 'views_normalized' || !fs.existsSync(preparedManifest) || !fs.existsSync(path.join(preparedDir,'fixture_front.jpg')) || preparedViews.manifest.items.length !== 4) throw new Error('character view preparation failed');

  const directBytes = Buffer.from('binary-direct-\u0000-data', 'utf8');
  const directSha256 = crypto.createHash('sha256').update(directBytes).digest('hex');
  const directPath = path.join(root, 'binary', 'direct.bin');
  const directWrite = await call('binary_file_write', {
    outputPath:directPath,
    data:directBytes.toString('base64url'),
    encoding:'base64url',
    expectedBytes:directBytes.length,
    expectedSha256:directSha256,
  });
  if (directWrite.bytes !== directBytes.length || directWrite.sha256 !== directSha256 || !fs.readFileSync(directPath).equals(directBytes)) throw new Error('direct binary write failed');
  let malformedBase64Rejected = false;
  try { await call('binary_file_write', {outputPath:path.join(root,'binary','invalid.bin'),data:'AB==',encoding:'base64'}); } catch (error) { malformedBase64Rejected = /truncated|non-canonical|invalid/i.test(String(error)); }
  if (!malformedBase64Rejected) throw new Error('malformed base64 was not rejected');
  const directInfo = await call('binary_file_info', {path:directPath});
  if (directInfo.bytes !== directBytes.length || directInfo.sha256 !== directSha256 || directInfo.mime !== 'application/octet-stream') throw new Error('binary file info failed');
  const directChunk = await call('binary_file_read_chunk', {path:directPath,offset:2,maxBytes:7,encoding:'hex'});
  if (directChunk.bytesRead !== 7 || directChunk.nextOffset !== 9 || Buffer.from(directChunk.data,'hex').toString('utf8') !== directBytes.subarray(2,9).toString('utf8')) throw new Error('binary chunk read failed');

  const uploadBytes = Buffer.alloc(50000);
  for (let index = 0; index < uploadBytes.length; index += 1) uploadBytes[index] = index % 251;
  const uploadSha256 = crypto.createHash('sha256').update(uploadBytes).digest('hex');
  const uploadPath = path.join(root, 'binary', 'resumable.bin');
  const upload = await call('binary_upload_begin', {
    outputPath:uploadPath,
    encoding:'base64',
    expectedBytes:uploadBytes.length,
    expectedSha256:uploadSha256,
  });
  const uploadText = uploadBytes.toString('base64');
  let sequence = 0;
  for (let offset = 0; offset < uploadText.length; offset += 4096) {
    const appended = await call('binary_upload_append', {uploadId:upload.uploadId,sequence,chunk:uploadText.slice(offset,offset+4096)});
    sequence += 1;
    if (appended.nextSequence !== sequence) throw new Error('binary upload sequence did not advance');
  }
  const uploadStatus = await call('binary_upload_status', {uploadId:upload.uploadId});
  if (uploadStatus.nextSequence !== sequence || uploadStatus.encodedChars !== uploadText.length) throw new Error('binary upload status failed');
  const uploadFinished = await call('binary_upload_finish', {uploadId:upload.uploadId});
  if (uploadFinished.sha256 !== uploadSha256 || !fs.readFileSync(uploadPath).equals(uploadBytes)) throw new Error('resumable binary upload failed');

  const abortUpload = await call('binary_upload_begin', {outputPath:path.join(root,'binary','abort.bin'),encoding:'hex'});
  let sequenceRejected = false;
  try { await call('binary_upload_append', {uploadId:abortUpload.uploadId,sequence:1,chunk:'00'}); } catch (error) { sequenceRejected = /sequence mismatch/i.test(String(error)); }
  if (!sequenceRejected) throw new Error('binary upload sequence guard failed');
  const aborted = await call('binary_upload_abort', {uploadId:abortUpload.uploadId});
  if (!aborted.aborted || fs.existsSync(path.join(root,'binary','abort.bin'))) throw new Error('binary upload abort failed');

  for (const sensitiveName of ['.env', '.env.development']) {
    let denied = false;
    try { await call('read_text_file', {path:path.join(root,sensitiveName)}); } catch (error) { denied = /denied|sensitive/i.test(String(error)); }
    if (!denied) throw new Error(`sensitive path policy did not reject ${sensitiveName}`);
  }

  const profile = await call('project_profile', {projectRoot:root});
  if (profile.name !== 'fixture-project' || profile.packageManager !== 'npm' || !profile.languages.includes('JavaScript')) throw new Error('project profile detection failed');
  await call('project_profile_save', {projectRoot:root,overrides:{notes:'fixture',schemaVersion:999}});
  const savedProfile = JSON.parse(fs.readFileSync(path.join(root,'.bridge-project.json'),'utf8'));
  if (savedProfile.schemaVersion !== 1 || savedProfile.overrides?.notes !== 'fixture' || savedProfile.overrides?.schemaVersion !== 999) throw new Error('profile save integrity failed');

  fs.writeFileSync(path.join(root,'app.txt'), 'changed\n');
  fs.writeFileSync(path.join(root,'.env.development'), 'SECRET=changed\n');
  const diff = await call('git_diff', {cwd:root});
  if (diff.code !== 0 || !String(diff.stdout).includes('changed') || String(diff.stdout).includes('SECRET=changed') || !diff.deniedPaths.some((item) => item.path === '.env.development')) throw new Error('git diff sensitive filtering failed');
  if ((await call('git_log',{cwd:root,limit:5})).code !== 0) throw new Error('git log failed');
  const shown = await call('git_show_commit',{cwd:root,ref:'HEAD',includePatch:true});
  if (shown.code !== 0 || String(shown.stdout).includes('SECRET=dev') || !shown.deniedPaths.some((item) => item.path === '.env.development')) throw new Error('git show sensitive filtering failed');
  const commitRejected = await call('git_commit_all',{cwd:root,message:'should not commit secrets'});
  if (commitRejected.committed || !/sensitive paths/i.test(String(commitRejected.reason)) || commitRejected.deniedPaths.length < 1) throw new Error('git commit sensitive preflight failed');
  const branch = await call('git_create_branch',{cwd:root,name:'fixture-branch',checkout:false});
  if (!branch.created) throw new Error('git branch creation failed');
  const compare = await call('git_compare_branches',{cwd:root,base:'main',head:'fixture-branch'});
  if (compare.diff.code !== 0 || compare.commits.code !== 0) throw new Error('git compare failed');
  const restored = await call('git_restore_file',{cwd:root,path:'app.txt'});
  const restoredText = fs.readFileSync(path.join(root,'app.txt'),'utf8').replace(/\r\n/g,'\n');
  if (!restored.restored || restoredText !== 'original\n') throw new Error('git restore failed');

  const snap = await call('workspace_snapshot',{projectRoot:root,label:'integration fixture'});
  fs.writeFileSync(path.join(root,'app.txt'), 'after snapshot\n');
  fs.writeFileSync(path.join(root,'added.txt'), 'added\n');
  const snapshotDiff = await call('workspace_diff',{snapshotId:snap.snapshot.id,projectRoot:root});
  if (!snapshotDiff.changed || snapshotDiff.totalChanges < 2) throw new Error('workspace diff failed');
  let confirmationRejected = false;
  try { await call('workspace_rollback',{snapshotId:snap.snapshot.id,confirmSnapshotId:'wrong-id',projectRoot:root}); } catch { confirmationRejected = true; }
  if (!confirmationRejected) throw new Error('workspace rollback confirmation was not enforced');
  const rollback = await call('workspace_rollback',{snapshotId:snap.snapshot.id,confirmSnapshotId:snap.snapshot.id,projectRoot:root,removeAddedFiles:true});
  const rollbackText = fs.readFileSync(path.join(root,'app.txt'),'utf8').replace(/\r\n/g,'\n');
  if (!rollback.rolledBack || fs.existsSync(path.join(root,'added.txt')) || rollbackText !== 'original\n') throw new Error('workspace rollback failed');
  const list = await call('workspace_snapshot_list',{limit:20});
  if (!list.snapshots.some((item) => item.id === snap.snapshot.id && item.label === 'integration fixture')) throw new Error('snapshot list failed');

  const truncatedSnap = await call('workspace_snapshot',{projectRoot:root,maxFiles:1,label:'truncated fixture'});
  if (!truncatedSnap.snapshot.truncated) throw new Error('expected bounded snapshot to be truncated');
  let truncatedRollbackRejected = false;
  try { await call('workspace_rollback',{snapshotId:truncatedSnap.snapshot.id,confirmSnapshotId:truncatedSnap.snapshot.id,projectRoot:root}); } catch (error) { truncatedRollbackRejected = /truncated snapshot/i.test(String(error)); }
  if (!truncatedRollbackRejected) throw new Error('truncated snapshot rollback was not rejected');

  const tamperSnap = await call('workspace_snapshot',{projectRoot:root,label:'tamper fixture'});
  const tamperManifestPath = path.join(tamperSnap.storagePath,'manifest.json');
  const tamperManifest = JSON.parse(fs.readFileSync(tamperManifestPath,'utf8'));
  tamperManifest.files[0].path = '../escape.txt';
  fs.writeFileSync(tamperManifestPath,JSON.stringify(tamperManifest,null,2));
  let traversalRejected = false;
  try { await call('workspace_diff',{snapshotId:tamperSnap.snapshot.id,projectRoot:root}); } catch (error) { traversalRejected = /invalid snapshot|relative path|escaped/i.test(String(error)); }
  if (!traversalRejected) throw new Error('tampered snapshot traversal was not rejected');

  writePersistentCache('fixture','one',{value:1});
  writePersistentCache('fixture','two',{value:2});
  writePersistentCache('fixture','three',{value:3});
  const cacheBefore = await call('cache_status',{});
  if (cacheBefore.entries !== 3) throw new Error(`expected 3 cache entries, got ${cacheBefore.entries}`);
  const dryRun = await call('cache_prune',{maxEntries:1,dryRun:true});
  if (!dryRun.dryRun || dryRun.removedEntries !== 2) throw new Error('cache dry-run failed');
  const pruned = await call('cache_prune',{maxEntries:1,dryRun:false});
  const cacheAfter = await call('cache_status',{});
  if (pruned.removedEntries !== 2 || cacheAfter.entries !== 1) throw new Error('cache prune failed');

  console.log(JSON.stringify({ok:true,tools:registry.tools.length,profile:profile.name,snapshotChanges:snapshotDiff.totalChanges,cacheEntries:cacheAfter.entries},null,2));
} finally {
  fs.rmSync(sandbox,{recursive:true,force:true});
}
