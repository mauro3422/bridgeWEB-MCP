import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-v060-regression-'));
process.env.BRIDGE_MCP_CACHE_DIR = path.join(sandbox, 'cache-store');
process.env.BRIDGE_MCP_SNAPSHOT_DIR = path.join(sandbox, 'snapshot-store');

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const { writePersistentCache } = await import('../dist/tools/shared/persistent-cache.js');
const registry = createDefaultToolRegistry();
const call = (name, args = {}) => registry.call(name, args);
const root = path.join(sandbox, 'project');
fs.mkdirSync(root, {recursive:true});

try {
  if (registry.tools.length !== 82) throw new Error(`expected 82 tools, got ${registry.tools.length}`);
  if (registry.riskSummary.neutral.length !== 0) throw new Error(`neutral tools remain: ${registry.riskSummary.neutral.join(', ')}`);
  for (const moduleName of ['project','workspace','cache','workflow-guides','images','blender']) if (!registry.modules.includes(moduleName)) throw new Error(`missing module ${moduleName}`);
  for (const toolName of ['workflow_guide_recommend','workflow_guide_load','workflow_guide_create','image_asset_save','image_character_views_prepare','blender_status','blender_open','blender_scene_info','blender_viewport_screenshot','blender_execute_code','blender_batch_script','blender_setup_character_references','blender_character_loop_status']) if (!registry.has(toolName)) throw new Error(`missing workflow/image/Blender tool ${toolName}`);

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name:'fixture-project',scripts:{build:'tsc',test:'node test.js'},devDependencies:{typescript:'1.0.0'}}, null, 2));
  fs.writeFileSync(path.join(root, 'app.txt'), 'original\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=test\n');
  fs.writeFileSync(path.join(root, '.env.development'), 'SECRET=dev\n');
  execFileSync('git', ['init', '-b', 'main'], {cwd:root,stdio:'ignore'});
  execFileSync('git', ['config', 'user.email', 'bridge@example.test'], {cwd:root});
  execFileSync('git', ['config', 'user.name', 'Bridge Test'], {cwd:root});
  execFileSync('git', ['add', 'package.json', 'app.txt', '.env.development'], {cwd:root,stdio:'ignore'});
  execFileSync('git', ['commit', '-m', 'initial'], {cwd:root,stdio:'ignore'});

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
