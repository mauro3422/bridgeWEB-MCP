import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-v060-regression-'));
process.env.BRIDGE_MCP_CACHE_DIR = path.join(sandbox, 'cache-store');
process.env.BRIDGE_MCP_SNAPSHOT_DIR = path.join(sandbox, 'snapshot-store');
process.env.BRIDGE_MCP_BINARY_UPLOAD_DIR = path.join(sandbox, 'binary-upload-store');
process.env.BRIDGE_MCP_METRICS_DIR = path.join(sandbox, 'metrics-store');
process.env.BRIDGE_MCP_LOG_DIR = path.join(sandbox, 'log-store');
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
writeFixtureSkill('skill-maintenance-loop', 'Audit long iterations, record observable incidents, bugs and friction, and update the owning skill, routing, tool or lifecycle contract.');
fs.mkdirSync(linkedSkillSource, {recursive:true});
fs.writeFileSync(path.join(linkedSkillSource, 'SKILL.md'), '---\nname: linked-junction-skill\ndescription: Verify safe discovery through a directory junction.\n---\n\n# linked-junction-skill\n\nFixture guidance.\n');
fs.symlinkSync(linkedSkillSource, path.join(fixtureSkillRoot, 'linked-junction-skill'), process.platform === 'win32' ? 'junction' : 'dir');
const fixturePluginSkill = path.join(fixtureCodexHome, 'plugins', 'cache', 'fixture-vendor', 'fixture-plugin', '1.0.0', 'skills', 'fixture-plugin-skill');
fs.mkdirSync(fixturePluginSkill, {recursive:true});
fs.writeFileSync(path.join(fixturePluginSkill, 'SKILL.md'), '---\nname: fixture-plugin-skill\ndescription: Verify read-only discovery from the managed Codex plugin cache.\n---\n\n# Fixture plugin skill\n\nFixture guidance.\n');
// Deliberately exclude plugins/cache from the general Bridge path policy. Skill
// discovery must use its narrower read-only cache boundary instead.
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [fixtureSkillRoot, linkedSkillSource, path.join(sandbox, 'project'), process.cwd()].join(path.delimiter);
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
    'skill-maintenance-loop': {phase:'maintenance',domains:['skill-system'],actions:['maintain','document'],artifacts:['skill','project'],needs:['integrity-verification'],signals:['error-observed','repeated-friction','manual-workaround','skill-gap','reusable-pattern'],requireSignalMatch:true,requires:[],complements:[],excludes:[],negativeIntents:[],priority:92,activation:'on-demand'},
    'linked-junction-skill': {phase:'discovery',domains:['skill-system'],actions:['discover'],artifacts:['skill'],needs:[],requires:[],complements:[],excludes:[],negativeIntents:[],priority:10,activation:'on-demand'},
  },
  workflows: [{name:'roblox-development',match:{domains:['roblox']},phases:[
    {phase:'discovery',skills:['roblox-mcp-skill-router'],required:true},
    {phase:'safety',skills:['roblox-safe-editing'],required:true,when:{risks:['write','destructive']}},
    {phase:'verification',skills:['roblox-playtest','roblox-studio-qa'],required:true,when:{actions:['create','edit','test','debug']}},
    {phase:'persistence',skills:['roblox-save-backup-recovery'],required:true,when:{risks:['write','destructive']}},
  ]}],
}, null, 2));
const fixtureOwnedSkills = [
  'roblox-mcp-skill-router',
  'roblox-safe-editing',
  'roblox-connection-network-authoring',
  'roblox-playtest',
  'roblox-studio-qa',
  'roblox-save-backup-recovery',
  'skill-maintenance-loop',
  'linked-junction-skill',
];
fs.writeFileSync(path.join(fixtureSkillRoot, '_dashboard', 'skill-routing-fixtures.json'), JSON.stringify({
  schemaVersion: 1,
  cases: fixtureOwnedSkills.flatMap((name) => [
    {
      name: `fixture-positive-${name}`,
      task: `Activate ${name} in the isolated Bridge routing fixture.`,
      stage: 'start',
      expect: {activeIncludes: [name]},
    },
    {
      name: `fixture-negative-${name}`,
      task: `Exclude ${name} from a nearby isolated Bridge routing fixture.`,
      stage: 'start',
      expect: {activeExcludes: [name], deferredExcludes: [name]},
    },
  ]),
}, null, 2));
process.env.BRIDGE_MCP_SKILL_ROUTING_PATH = path.join(fixtureSkillRoot, '_dashboard', 'skill-routing-overrides.json');
process.env.BRIDGE_MCP_SKILL_ROUTING_FIXTURES_PATH = path.join(fixtureSkillRoot, '_dashboard', 'skill-routing-fixtures.json');

const { createDefaultToolRegistry } = await import('../dist/tool-registry.js');
const { writePersistentCache } = await import('../dist/tools/shared/persistent-cache.js');
const { asRobloxMcpDiscoveryHealth, classifyRobloxMcpToolCatalog, getRobloxMcpToolRequestOptions, parseRobloxStudios } = await import('../dist/integrations/roblox-mcp-client.js');
const { extractRobloxMcpImage, validateRobloxCaptureImage } = await import('../dist/tools/roblox-studio-tools.js');
const { clearBridgeNotices, drainBridgeNotices, emitBridgeNotice, getBridgeNoticeStatus, peekBridgeNoticeHistory } = await import('../dist/notices.js');
const { closeMssrObservatoryForTests, getMssrTraceEvidence, queryMssrObservatory, recordMssrCheckpoint, recordMssrRoute } = await import('../dist/mssr-observatory.js');
const { buildToolAudit } = await import('../dist/tool-audit.js');
const { beginToolMetric, classifyToolAuditError, closeMetricsForTests, extractToolResultMetric, finishToolMetric, getRecentMetrics, getToolAuditMetrics } = await import('../dist/metrics.js');
const { RUNTIME_BOOT_ID, resolveMetricTaskKey, resolveMetricWorkflowKey } = await import('../dist/runtime-identity.js');
const { createMssrTraceSessionCoordinator } = await import('../dist/mssr-trace-context.js');
const registry = createDefaultToolRegistry();
const call = (name, args = {}) => registry.call(name, args);
const root = path.join(sandbox, 'project');
fs.mkdirSync(root, {recursive:true});

try {
  const liveRobloxCatalog = classifyRobloxMcpToolCatalog({
    liveTools: [{name:'skill'}],
    attempts: 1,
    durationMs: 25,
  });
  if (liveRobloxCatalog.status !== 'healthy' || liveRobloxCatalog.liveToolCount !== 1 || liveRobloxCatalog.usingCachedTools) throw new Error('healthy Roblox tool catalog classification failed');
  const cachedRobloxCatalog = classifyRobloxMcpToolCatalog({
    liveTools: [],
    cachedTools: [{name:'skill'}],
    cacheCapturedAt: '2026-07-23T00:00:00.000Z',
    attempts: 2,
    durationMs: 20_000,
    errors: ['tools/list returned zero tools'],
  });
  if (cachedRobloxCatalog.status !== 'degraded' || cachedRobloxCatalog.liveToolCount !== 0 || cachedRobloxCatalog.effectiveToolCount !== 1 || !cachedRobloxCatalog.usingCachedTools || !cachedRobloxCatalog.warning?.includes('last-known')) throw new Error('degraded Roblox tool cache classification failed');
  const discoveryRobloxCatalog = asRobloxMcpDiscoveryHealth(cachedRobloxCatalog);
  if (discoveryRobloxCatalog.status !== 'cached' || discoveryRobloxCatalog.warning !== undefined || !discoveryRobloxCatalog.usingCachedTools) throw new Error('cached Roblox discovery classification failed');
  const unavailableRobloxCatalog = classifyRobloxMcpToolCatalog({
    liveTools: [],
    attempts: 2,
    durationMs: 20_000,
    errors: ['tools/list returned zero tools'],
  });
  if (unavailableRobloxCatalog.status !== 'unavailable' || unavailableRobloxCatalog.effectiveToolCount !== 0 || !unavailableRobloxCatalog.warning?.includes('No last-known tool cache')) throw new Error('unavailable Roblox tool catalog classification failed');
  const parsedStudios = parseRobloxStudios({
    content: [{type:'text',text:JSON.stringify({studios:[
      {id:'studio-a',name:'A.rbxl',active:true},
      {id:'studio-b',name:'B.rbxl',active:false},
    ]})}],
  });
  if (parsedStudios.length !== 2 || parsedStudios[0].id !== 'studio-a' || !parsedStudios[0].active || parsedStudios[1].active) throw new Error('Roblox Studio instance parsing failed');
  if (parseRobloxStudios({content:[{type:'text',text:'not-json'}]}).length !== 0) throw new Error('malformed Roblox Studio listing was not rejected');

  const defaultRobloxCallOptions = getRobloxMcpToolRequestOptions('get_studio_state');
  const longRobloxCallOptions = getRobloxMcpToolRequestOptions('execute_luau');
  if (defaultRobloxCallOptions.timeout !== 60_000 || defaultRobloxCallOptions.maxTotalTimeout !== 60_000 || !defaultRobloxCallOptions.resetTimeoutOnProgress) throw new Error('default Roblox MCP request options are invalid');
  if (longRobloxCallOptions.timeout < 300_000 || (longRobloxCallOptions.maxTotalTimeout ?? 0) < longRobloxCallOptions.timeout || !longRobloxCallOptions.resetTimeoutOnProgress) throw new Error('long-running Roblox MCP request options are invalid');
  const nestedRobloxImage = extractRobloxMcpImage({result:{content:[{type:'text',text:'ok'},{type:'image',data:'aGVsbG8=',mimeType:'image/png'}]}});
  if (!nestedRobloxImage || nestedRobloxImage.data !== 'aGVsbG8=' || nestedRobloxImage.mimeType !== 'image/png') throw new Error('nested Roblox MCP image extraction failed');
  if (extractRobloxMcpImage({content:[{type:'text',text:'no image'}]}) !== null) throw new Error('Roblox MCP image extraction accepted a missing image');
  const pngFixture = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const jpegFixture = Buffer.from('ffd8ffe000104a4649460001', 'hex');
  const webpFixture = Buffer.from('524946460400000057454250', 'hex');
  if (validateRobloxCaptureImage('capture.png', {data:pngFixture.toString('base64'),mimeType:'image/png'}).mimeType !== 'image/png') throw new Error('PNG capture validation failed');
  if (validateRobloxCaptureImage('capture.jpg', {data:jpegFixture.toString('base64'),mimeType:'image/jpeg'}).mimeType !== 'image/jpeg') throw new Error('JPEG capture validation failed');
  if (validateRobloxCaptureImage('capture.webp', {data:webpFixture.toString('base64'),mimeType:'image/webp'}).mimeType !== 'image/webp') throw new Error('WebP capture validation failed');
  assert.throws(() => validateRobloxCaptureImage('capture.png', {data:jpegFixture.toString('base64'),mimeType:'image/jpeg'}), /extension \.png expects image\/png, but screen_capture returned image\/jpeg/);
  assert.throws(() => validateRobloxCaptureImage('capture.jpg', {data:jpegFixture.toString('base64'),mimeType:'image/png'}), /declared image\/png but the image signature is image\/jpeg/);
  assert.throws(() => validateRobloxCaptureImage('capture.gif', {data:pngFixture.toString('base64'),mimeType:'image/png'}), /must use \.png, \.jpg, \.jpeg, or \.webp/);


  clearBridgeNotices();
  emitBridgeNotice({severity:'warning',code:'fixture-warning',source:'fixture',message:'Fixture notice',actions:[{label:'List sessions',toolName:'terminal_list',instruction:'Resolve a live session before retrying.'}]});
  emitBridgeNotice({severity:'warning',code:'fixture-warning',source:'fixture',message:'Fixture notice',actions:[{label:'List sessions',toolName:'terminal_list',instruction:'Resolve a live session before retrying.'}]});
  const noticeStatus = getBridgeNoticeStatus();
  if (noticeStatus.pendingCount !== 1 || noticeStatus.notices[0].occurrences !== 2 || noticeStatus.notices[0].actions?.[0]?.toolName !== 'terminal_list') throw new Error('Bridge notice dedupe/status/action failed');
  const drainedNotices = drainBridgeNotices();
  const noticeHistory = peekBridgeNoticeHistory(5);
  if (drainedNotices.length !== 1 || getBridgeNoticeStatus().pendingCount !== 0) throw new Error('Bridge notice one-shot drain failed');
  if (!noticeHistory.some((item) => item.code === 'fixture-warning' && item.actions?.[0]?.toolName === 'terminal_list')) throw new Error('Bridge notice history did not retain actionable reminder after drain');

  if (registry.tools.length !== 141) throw new Error(`expected 141 tools, got ${registry.tools.length}`);
  const catalogComparison = await call('bridge_connector_catalog_compare', {
    exposedToolNames: ['skill_catalog', 'skill_recommend', 'skill_load', 'host_private_tool'],
  });
  if (catalogComparison.runtime.count !== 141 || catalogComparison.mssr.runtime !== 11) throw new Error('connector catalog comparison runtime baseline failed');
  if (catalogComparison.mssr.directCoveragePercent !== 27.27) throw new Error(`unexpected MSSR direct coverage: ${catalogComparison.mssr.directCoveragePercent}`);
  if (!catalogComparison.mssr.delegatedViaQuery.includes('skill_bootstrap') || !catalogComparison.mssr.delegatedViaAction.includes('mssr_trace_record')) throw new Error('connector catalog wrapper classification failed');
  if (!catalogComparison.connectorObservation.unrecognized.includes('host_private_tool') || catalogComparison.interpretation.wrapperReachabilityIsDirectExposure !== false) throw new Error('connector catalog boundary classification failed');
  const delegatedQueryTool = registry.tools.find((tool) => tool.name === 'bridge_tool_query');
  const delegatedActionTool = registry.tools.find((tool) => tool.name === 'bridge_tool_action');
  if (!delegatedQueryTool?.description?.includes('use them without another discovery call')) throw new Error('bridge_tool_query must support route-provided immediate fallback');
  if (!delegatedActionTool?.description?.includes('use them without another discovery call')) throw new Error('bridge_tool_action must support route-provided immediate fallback');
  if (!delegatedQueryTool?.inputSchema?.properties?.traceId || !delegatedActionTool?.inputSchema?.properties?.traceId) throw new Error('delegated wrappers must expose optional MSSR trace control');
  const expectedNeutral = ['whiteboard_capture_pc_view', 'whiteboard_add_text', 'whiteboard_add_svg', 'whiteboard_add_diagram', 'whiteboard_insert_image', 'mssr_trace_record', 'mssr_observatory_epoch_start'];
  if (registry.riskSummary.neutral.length !== expectedNeutral.length || expectedNeutral.some((name) => !registry.riskSummary.neutral.includes(name))) throw new Error(`unexpected neutral tools: ${registry.riskSummary.neutral.join(', ')}`);
  if (!registry.riskSummary.destructive.includes('project_context_update')) throw new Error('project_context_update must be classified as a write/destructive Bridge tool');
  for (const moduleName of ['project','project-context','workspace','cache','workflow-guides','skill-catalog-and-roblox-proxy','git-publication','roblox-studio-ops','roblox-assets','roblox-photo-capture','notices','mssr-observatory','binary-files','images','blender','godot','tablet-whiteboard']) if (!registry.modules.includes(moduleName)) throw new Error(`missing module ${moduleName}`);
  for (const toolName of ['project_context_load','project_context_update','workflow_guide_recommend','workflow_guide_load','workflow_guide_create','bridge_connector_catalog_compare','bridge_tool_schema','bridge_tool_audit','git_multi_repo_publish','skill_catalog','skill_recommend','skill_route_audit','skill_route_vocabulary','skill_route_plan','skill_bootstrap','skill_load','mssr_observatory_query','mssr_trace_evidence','mssr_trace_record','mssr_observatory_epoch_start','bridge_notice_status','bridge_notice_drain','roblox_mcp_status','roblox_mcp_tool_list','roblox_mcp_studio_list','roblox_mcp_query','roblox_mcp_action','roblox_asset_upload','roblox_studio_window_capture_save','roblox_screen_capture_save','roblox_photo_capture_job','roblox_place_save','binary_file_info','binary_file_read_chunk','binary_file_write','binary_upload_begin','binary_upload_append','binary_upload_status','binary_upload_finish','binary_upload_abort','image_file_attach','image_asset_save','image_asset_import_files','image_character_views_prepare','image_reference_pack_prepare','blender_status','blender_open','blender_scene_info','blender_viewport_screenshot','blender_focus_review','blender_review_bundle','blender_execute_code','blender_batch_script','blender_validate_reference_pack','blender_install_reference_pack','blender_setup_character_references','blender_character_loop_status','godot_mcp_status','godot_mcp_tool_list','godot_mcp_instance_list','godot_mcp_query','godot_screen_capture_save','whiteboard_capture_pc_view','whiteboard_latest_capture','whiteboard_capture_list','whiteboard_add_text','whiteboard_add_svg','whiteboard_add_diagram','whiteboard_insert_image']) if (!registry.has(toolName)) throw new Error(`missing context/workflow/skill/Roblox/binary/image/Blender/whiteboard tool ${toolName}`);
  if (!registry.riskSummary.destructive.includes('roblox_mcp_action') || !registry.riskSummary.destructive.includes('roblox_studio_window_capture_save') || !registry.riskSummary.destructive.includes('roblox_screen_capture_save') || !registry.riskSummary.destructive.includes('roblox_photo_capture_job') || !registry.riskSummary.destructive.includes('roblox_place_save')) throw new Error('Roblox action/capture/save risk classification failed');
  for (const name of ['godot_mcp_status','godot_mcp_tool_list','godot_mcp_instance_list','godot_mcp_query']) if (!registry.riskSummary.readOnly.includes(name)) throw new Error(`Godot query tool ${name} must be read-only`);
  if (!registry.riskSummary.destructive.includes('godot_screen_capture_save')) throw new Error('Godot capture must be classified as a filesystem-writing action');
  for (const name of ['godot_mcp_status','godot_mcp_tool_list','godot_mcp_instance_list','godot_mcp_query']) {
    const tool = registry.tools.find((candidate) => candidate.name === name);
    if (tool?.metadata?.role !== 'provider-proxy' || tool.metadata.family !== 'godot') throw new Error(`Godot provider metadata failed for ${name}`);
  }
  const robloxAssetUploadTool = registry.tools.find((tool) => tool.name === 'roblox_asset_upload');
  if (!robloxAssetUploadTool || !registry.riskSummary.destructive.includes('roblox_asset_upload')) throw new Error('roblox_asset_upload risk classification failed');
  if (!robloxAssetUploadTool.inputSchema?.properties?.items || !robloxAssetUploadTool.inputSchema?.properties?.confirmCreatorId || !robloxAssetUploadTool.inputSchema?.properties?.confirmUpload) throw new Error('roblox_asset_upload schema failed');
  if (JSON.stringify(robloxAssetUploadTool.inputSchema).includes('apiKey"')) throw new Error('roblox_asset_upload must not accept a raw API key argument');
  await assert.rejects(
    () => call('roblox_asset_upload', {
      items: [{filePath:path.join(root, 'missing.glb'),expectedSha256:'0'.repeat(64),displayName:'Fixture',description:'Fixture'}],
      creatorType:'user',
      creatorId:'1',
      confirmCreatorId:'1',
      confirmUpload:true,
      apiKeyEnv:'ROBLOX_OPEN_CLOUD_API_KEY_TEST_MISSING',
    }),
    /ROBLOX_OPEN_CLOUD_API_KEY_TEST_MISSING/,
  );
  if (!registry.riskSummary.readOnly.includes('bridge_notice_status') || !registry.riskSummary.readOnly.includes('bridge_notice_drain')) throw new Error('Bridge notice risk classification failed');
  const reviewTool = registry.tools.find((tool) => tool.name === 'blender_review_bundle');
  if (!reviewTool || !registry.riskSummary.destructive.includes('blender_review_bundle')) throw new Error('Blender review bundle classification failed');
  if (!reviewTool.inputSchema?.properties?.views || !reviewTool.inputSchema?.properties?.outputDir) throw new Error('Blender review bundle schema failed');
  const focusReviewTool = registry.tools.find((tool) => tool.name === 'blender_focus_review');
  if (!focusReviewTool || !registry.riskSummary.destructive.includes('blender_focus_review')) throw new Error('Blender focus review classification failed');
  if (!focusReviewTool.inputSchema?.properties?.focusMode || !focusReviewTool.inputSchema?.properties?.outputDir || !focusReviewTool.description?.includes('current viewport')) throw new Error('Blender focus review schema/description failed');
  const referencePrepareTool = registry.tools.find((tool) => tool.name === 'image_reference_pack_prepare');
  const referenceValidateTool = registry.tools.find((tool) => tool.name === 'blender_validate_reference_pack');
  const referenceInstallTool = registry.tools.find((tool) => tool.name === 'blender_install_reference_pack');
  if (!referencePrepareTool || !registry.riskSummary.destructive.includes('image_reference_pack_prepare')) throw new Error('Generic reference-pack preparation classification failed');
  if (!referencePrepareTool.inputSchema?.properties?.items || !referencePrepareTool.inputSchema?.properties?.masters || !referencePrepareTool.inputSchema?.properties?.alignment) throw new Error('Generic reference-pack preparation schema failed');
  if (!referenceValidateTool || !registry.riskSummary.readOnly.includes('blender_validate_reference_pack')) throw new Error('Reference-pack validation classification failed');
  if (!referenceValidateTool.inputSchema?.properties?.requiredRoles || !referenceValidateTool.inputSchema?.properties?.requireSemanticQa) throw new Error('Reference-pack validation schema failed');
  if (!referenceInstallTool || !registry.riskSummary.destructive.includes('blender_install_reference_pack')) throw new Error('Reference-pack installation classification failed');
  if (!referenceInstallTool.inputSchema?.properties?.layout || !referenceInstallTool.inputSchema?.properties?.outputBlend) throw new Error('Reference-pack installation schema failed');


  const imageAttachTool = registry.tools.find((tool) => tool.name === 'image_file_attach');
  if (!imageAttachTool || !registry.riskSummary.readOnly.includes('image_file_attach')) throw new Error('Local image attachment classification failed');
  if (!imageAttachTool.inputSchema?.properties?.items) throw new Error('Local image attachment schema failed');
  const imageImportTool = registry.tools.find((tool) => tool.name === 'image_asset_import_files');
  const imageImportFileDef = imageImportTool?.inputSchema?.$defs?.OpenAIFile;
  if (!imageImportTool || !registry.riskSummary.destructive.includes('image_asset_import_files')) throw new Error('Authorized image-file import classification failed');
  if (!imageImportTool.inputSchema?.properties?.files || !imageImportTool.inputSchema?.properties?.targets) throw new Error('Authorized image-file import schema failed');
  if (JSON.stringify(imageImportTool._meta?.['openai/fileParams']) !== JSON.stringify(['files'])) throw new Error('Authorized image-file import fileParams metadata failed');
  if (!imageImportFileDef?.properties?.download_url || !imageImportFileDef?.properties?.file_id || !imageImportFileDef?.properties?.mime_type || !imageImportFileDef?.properties?.file_name) throw new Error('Authorized image-file import file schema properties failed');
  if (JSON.stringify(imageImportFileDef.required) !== JSON.stringify(['download_url','file_id'])) throw new Error('Authorized image-file import file schema required fields failed');
  const workOnceTool = registry.tools.find((tool) => tool.name === 'work_once');
  const auditTool = registry.tools.find((tool) => tool.name === 'bridge_tool_audit');
  if (workOnceTool?.metadata?.role !== 'alias' || workOnceTool.metadata.aliasOf !== 'run_command' || workOnceTool.metadata.family !== 'process') throw new Error('tool alias metadata failed');
  const evidenceTool = registry.tools.find((tool) => tool.name === 'mssr_trace_evidence');
  if (!evidenceTool || !registry.riskSummary.readOnly.includes('mssr_trace_evidence') || evidenceTool.metadata?.lifecycle !== 'protected') throw new Error('mssr_trace_evidence metadata/risk failed');
  if (!/^[0-9a-f-]{36}$/.test(RUNTIME_BOOT_ID)) throw new Error('runtime boot identity must be a UUID');
  const workflowCoordinatorA = createMssrTraceSessionCoordinator(registry.tools);
  const unscopedRouteArgs = {task:'Unscoped task A',caller:'chatgpt-web'};
  workflowCoordinatorA.prepare('skill_route_plan', unscopedRouteArgs, {caller:'chatgpt-web',sessionKey:'session-shared-workflow',project:'bridge-mcp'});
  workflowCoordinatorA.observe('skill_route_plan', unscopedRouteArgs, {traceId:'__test_workflow_trace_a',stage:'start',workflowKey:null,activeSkills:[]});
  const unscopedSnapshot = workflowCoordinatorA.snapshot();
  if (unscopedSnapshot.workflowKey !== 'unscoped') throw new Error('unscoped trace did not retain an explicit unscoped workflow identity');

  const workflowCoordinatorB = createMssrTraceSessionCoordinator(registry.tools);
  const scopedRouteArgs = {task:'Scoped task B',caller:'chatgpt-web',workflowKey:'workflow-b'};
  workflowCoordinatorB.prepare('skill_route_plan', scopedRouteArgs, {caller:'chatgpt-web',sessionKey:'session-shared-workflow',project:'bridge-mcp'});
  workflowCoordinatorB.observe('skill_route_plan', scopedRouteArgs, {traceId:'__test_workflow_trace_b',stage:'start',workflowKey:'workflow-b',activeSkills:[]});
  const scopedSnapshot = workflowCoordinatorB.snapshot();
  if (scopedSnapshot.workflowKey !== 'workflow-b') throw new Error('scoped trace workflow was not captured by the coordinator');

  const isolatedUnscoped = resolveMetricWorkflowKey({
    startsNewRoute:false,
    traceId:unscopedSnapshot.traceId,
    traceWorkflowKey:unscopedSnapshot.workflowKey,
    explicitWorkflowKey:'workflow-b',
    sessionWorkflowKey:'workflow-b',
    localWorkflowKey:'workflow-b',
  });
  if (isolatedUnscoped !== 'unscoped') throw new Error('an existing unscoped trace inherited another workflow from the shared session');
  const isolatedScoped = resolveMetricWorkflowKey({
    startsNewRoute:false,
    traceId:scopedSnapshot.traceId,
    traceWorkflowKey:scopedSnapshot.workflowKey,
    explicitWorkflowKey:'workflow-c',
    sessionWorkflowKey:'workflow-c',
  });
  if (isolatedScoped !== 'workflow-b') throw new Error('an existing scoped trace was reassigned by later session metadata');
  const newRouteWorkflow = resolveMetricWorkflowKey({startsNewRoute:true,explicitWorkflowKey:'workflow-c',sessionWorkflowKey:'workflow-b'});
  if (newRouteWorkflow !== 'workflow-c') throw new Error('a new route did not prefer its explicit workflow');
  const stalePendingWorkflow = resolveMetricWorkflowKey({startsNewRoute:true,sessionWorkflowKey:'workflow-b',localWorkflowKey:'workflow-b'});
  if (stalePendingWorkflow !== undefined) throw new Error('a new route inherited a stale pending workflow without an explicit workflowKey');

  const traceTaskHash = 'a'.repeat(64);
  const isolatedTraceTask = resolveMetricTaskKey({
    startsNewRoute:false,
    traceId:'__test_workflow_trace_a',
    traceTaskHash,
    explicitTaskKey:'task_bbbbbbbbbbbbbbbb',
    sessionTaskKey:'task_cccccccccccccccc',
  });
  if (isolatedTraceTask !== 'task_aaaaaaaaaaaaaaaa') throw new Error('an existing trace inherited another task key from the shared session');
  const explicitNewTask = resolveMetricTaskKey({
    startsNewRoute:true,
    explicitTaskKey:'task_bbbbbbbbbbbbbbbb',
    sessionTaskKey:'task_cccccccccccccccc',
  });
  if (explicitNewTask !== 'task_bbbbbbbbbbbbbbbb') throw new Error('a new route did not prefer its explicit task key');
  const stalePendingTask = resolveMetricTaskKey({startsNewRoute:true,sessionTaskKey:'task_cccccccccccccccc',localTaskKey:'task_cccccccccccccccc'});
  if (stalePendingTask !== undefined) throw new Error('a new route inherited a stale pending task key without explicit task text');

  const identityTraceId = '__test_identity_trace';
  recordMssrRoute({
    traceId: identityTraceId,
    action: 'plan',
    task: 'Maintain the MauroPrime system loop',
    route: {
      caller: 'chatgpt-web',
      stage: 'start',
      classificationMode: 'structured-semantic',
      workflowKey: 'mauroprime-system-loop',
      agentProfile: {model:'gpt-test',reasoningEffort:'unknown'},
      contextUsed: true,
      contextCharacters: 32,
      workflows: [],
      activeSkills: [],
      deferredSkills: [],
      loadOrder: [],
      deferredLoadOrder: [],
      intent: {signals:['reusable-pattern'],ambiguity:'low'},
      coverage: {requiredPhases:[],completedPhases:[],missingRequiredPhases:[]},
    },
  });
  const identityMetric = beginToolMetric('__test_identity_tool', {}, {
    traceId: identityTraceId,
    workflowKey: 'mauroprime-system-loop',
    taskKey: 'task_fixture',
    caller: 'chatgpt-web',
    clientName: 'openai-mcp',
    sessionKey: 'session-fixture',
    project: 'bridge-mcp',
  });
  finishToolMetric(identityMetric, true, 12);
  const openEvidence = getMssrTraceEvidence(identityTraceId, 50);
  if (!openEvidence.workflowKeys.includes('mauroprime-system-loop') || openEvidence.runtime.currentBootId !== RUNTIME_BOOT_ID || openEvidence.runtime.toolRuntimeGenerations[0]?.runtimeBootId !== RUNTIME_BOOT_ID) throw new Error('trace identity correlation failed');
  if (openEvidence.lifecycle.status !== 'open-active' || openEvidence.tools.summary.calls !== 1 || openEvidence.identity.taskKeys[0] !== 'task_fixture') throw new Error('open trace evidence projection failed');
  recordMssrCheckpoint({traceId:identityTraceId,eventType:'outcome',primarySkill:'mssr-observability-maintenance',status:'success',accepted:true,verificationPassed:true,persisted:true,summary:'Fixture outcome'});
  const closedEvidence = await call('mssr_trace_evidence', {traceId:identityTraceId,limit:50});
  if (closedEvidence.lifecycle?.status !== 'closed-success' || closedEvidence.privacy?.rawPromptsStored !== false || closedEvidence.privacy?.transcriptsStored !== false) throw new Error('closed trace evidence/privacy failed');

  const executionTraceId = 'fixture-observable-execution';
  recordMssrRoute({
    traceId: executionTraceId,
    action: 'plan',
    task: 'Measure direct and delegated execution',
    route: {
      caller: 'chatgpt-web',
      stage: 'start',
      classificationMode: 'structured-semantic',
      workflowKey: 'fixture-observability',
      agentProfile: {model:'gpt-observability',reasoningEffort:'high'},
      contextUsed: true,
      contextCharacters: 24,
      workflows: [],
      activeSkills: [],
      deferredSkills: [],
      loadOrder: [],
      deferredLoadOrder: [],
      intent: {signals:['tool-chain-needed'],ambiguity:'low'},
      coverage: {requiredPhases:[],completedPhases:[],missingRequiredPhases:[]},
    },
  });
  const observableProfile = {traceId:executionTraceId,workflowKey:'fixture-observability',caller:'chatgpt-web',model:'gpt-observability',reasoningEffort:'high',sessionKey:'fixture-observable-session',project:'bridge-mcp'};
  finishToolMetric(beginToolMetric('skill_route_plan', {}, observableProfile), true, 12);
  finishToolMetric(beginToolMetric('bridge_tool_query', {toolName:'skill_bootstrap'}, observableProfile), true, 12);
  finishToolMetric(beginToolMetric('read_file_lines', {}, observableProfile), true, 12);
  finishToolMetric(beginToolMetric('bridge_tool_action', {toolName:'write_text_file'}, observableProfile), true, 12);
  const executionSummary = queryMssrObservatory({kind:'benchmark',scope:'active',days:30});
  const executionProfile = executionSummary.agentProfiles.find((profile) => profile.model === 'gpt-observability');
  if (!executionProfile) throw new Error('observable execution profile missing');
  if (executionProfile.directToolCalls !== 2 || executionProfile.delegatedQueryCalls !== 1 || executionProfile.delegatedActionCalls !== 1 || executionProfile.delegatedCallRate !== 50) throw new Error(`direct/delegated execution projection failed: ${JSON.stringify(executionProfile)}`);
  if (executionProfile.discoveryDetours < 2 || executionProfile.tracesWithFirstAction !== 1 || executionProfile.averageToolSpanMs === null) throw new Error(`execution timing/detour projection failed: ${JSON.stringify(executionProfile)}`);


  if (auditTool?.metadata?.lifecycle !== 'protected' || auditTool.metadata.family !== 'tool-dispatch' || !registry.riskSummary.readOnly.includes('bridge_tool_audit')) throw new Error('bridge_tool_audit metadata/risk failed');
  const auditSchema = await call('bridge_tool_schema', {toolName:'bridge_tool_audit'});
  if (auditSchema.tool?.metadata?.lifecycle !== 'protected' || !auditSchema.tool?.inputSchema?.properties?.view) throw new Error('bridge_tool_schema did not expose audit metadata');
  const terminalReadSchema = await call('bridge_tool_schema', {toolName:'terminal_read'});
  if (!terminalReadSchema.tool?.metadata?.usage?.preflightTools?.includes('terminal_list')) throw new Error('terminal_read usage preflight metadata failed');
  const skillLoadSchema = await call('bridge_tool_schema', {toolName:'skill_load'});
  if (!skillLoadSchema.tool?.metadata?.usage?.recovery?.some((rule) => rule.code === 'mssr-orphan-skill-load' && rule.toolName === 'skill_bootstrap')) throw new Error('skill_load MSSR recovery metadata failed');
  const aliasAudit = await call('bridge_tool_audit', {view:'aliases',scope:'active',days:30,limit:20});
  if (aliasAudit.summary?.registeredTools !== 141 || !aliasAudit.items?.some((item) => item.tool === 'work_once' && item.status === 'clarify')) throw new Error('live registry alias audit failed');
  const delegatedMetric = beginToolMetric('bridge_tool_query', {toolName:'bridge_tool_audit',arguments:{view:'all'}}, {caller:'chatgpt-web',sessionKey:'fixture-session',project:'fixture-project'});
  finishToolMetric(delegatedMetric, true, 128);
  const delegatedSnapshot = getToolAuditMetrics(30, 'active');
  const wrapperEvidence = delegatedSnapshot.rows.find((row) => row.tool === 'bridge_tool_query');
  const targetEvidence = delegatedSnapshot.rows.find((row) => row.tool === 'bridge_tool_audit');
  if (!wrapperEvidence || wrapperEvidence.calls < 1) throw new Error('delegated wrapper audit evidence missing');
  if (!targetEvidence || targetEvidence.calls < 1 || targetEvidence.okCalls < 1) throw new Error('delegated target audit evidence missing');
  const processOkMetric = beginToolMetric('work_once', {}, {caller:'chatgpt-web',sessionKey:'fixture-session',project:'fixture-project'});
  finishToolMetric(processOkMetric, true, 16, undefined, extractToolResultMetric('work_once', {code:0,timedOut:false}));
  const processFailMetric = beginToolMetric('work_once', {}, {caller:'chatgpt-web',sessionKey:'fixture-session',project:'fixture-project'});
  finishToolMetric(processFailMetric, true, 16, undefined, extractToolResultMetric('work_once', {code:7,timedOut:false}));
  const delegatedProcess = extractToolResultMetric('bridge_tool_query', {delegatedTool:'work_once',result:{code:9,timedOut:false}});
  if (delegatedProcess.resultOk !== false || delegatedProcess.resultCode !== 9 || delegatedProcess.resultStatus !== 'failed') throw new Error('delegated process result extraction failed');
  const recentProcess = getRecentMetrics(10, 'active').recent.filter((row) => row.tool === 'work_once').slice(0, 2);
  if (!recentProcess.some((row) => row.ok === 1 && row.result_ok === 0 && row.result_code === 7 && row.result_status === 'failed')) throw new Error('failed child process metric projection missing');
  if (!recentProcess.some((row) => row.ok === 1 && row.result_ok === 1 && row.result_code === 0 && row.result_status === 'success')) throw new Error('successful child process metric projection missing');
  const processAudit = getToolAuditMetrics(30, 'active').rows.find((row) => row.tool === 'work_once');
  if (!processAudit || processAudit.errorCalls < 1 || !processAudit.errorCategories.some((entry) => entry.name === 'process-exit')) throw new Error('process result audit classification failed');

  if (classifyToolAuditError('Expected 1 replacement(s), found 0.') !== 'patch-conflict') throw new Error('patch conflict classification failed');
  if (classifyToolAuditError('confirmToolName must exactly match target') !== 'permission-or-risk-mismatch') throw new Error('risk mismatch classification failed');
  if (classifyToolAuditError('Unknown terminal session: missing-session') !== 'target-not-found') throw new Error('missing target classification failed');
  const syntheticAudit = buildToolAudit([
    {name:'schema_fail_tool',description:'fixture',inputSchema:{},annotations:{readOnlyHint:true},metadata:{role:'dedicated',family:'fixture',lifecycle:'stable'}},
    {name:'fallback_tool',description:'fixture',inputSchema:{},annotations:{readOnlyHint:true},metadata:{role:'fallback',family:'fixture',lifecycle:'stable'}},
    {name:'unused_tool',description:'fixture',inputSchema:{},annotations:{readOnlyHint:true},metadata:{role:'dedicated',family:'fixture',lifecycle:'stable'}},
    {name:'low_sample_tool',description:'fixture',inputSchema:{},annotations:{readOnlyHint:true},metadata:{role:'dedicated',family:'fixture',lifecycle:'stable'}},
    {name:'missing_target_tool',description:'fixture',inputSchema:{},annotations:{readOnlyHint:true},metadata:{role:'dedicated',family:'fixture',lifecycle:'stable'}},
  ], {
    enabled:true,
    sqliteAvailable:true,
    scope:'active',
    days:30,
    since:'2026-07-01T00:00:00.000Z',
    rows:[
      {tool:'schema_fail_tool',calls:5,okCalls:1,errorCalls:4,avgDurationMs:10,maxDurationMs:20,lastStartedAt:'2026-07-26T00:00:00.000Z',lastSuccessAt:'2026-07-25T00:00:00.000Z',lastErrorAt:'2026-07-26T00:00:00.000Z',uniqueSessions:2,uniqueProjects:1,errorCategories:[{name:'schema-validation',count:4}]},
      {tool:'fallback_tool',calls:4,okCalls:4,errorCalls:0,avgDurationMs:5,maxDurationMs:8,lastStartedAt:'2026-07-26T00:00:00.000Z',lastSuccessAt:'2026-07-26T00:00:00.000Z',lastErrorAt:null,uniqueSessions:1,uniqueProjects:1,errorCategories:[]},
      {tool:'low_sample_tool',calls:2,okCalls:0,errorCalls:2,avgDurationMs:4,maxDurationMs:6,lastStartedAt:'2026-07-26T00:00:00.000Z',lastSuccessAt:null,lastErrorAt:'2026-07-26T00:00:00.000Z',uniqueSessions:1,uniqueProjects:1,errorCategories:[{name:'runtime-internal',count:2}]},
      {tool:'missing_target_tool',calls:4,okCalls:0,errorCalls:4,avgDurationMs:3,maxDurationMs:5,lastStartedAt:'2026-07-26T00:00:00.000Z',lastSuccessAt:null,lastErrorAt:'2026-07-26T00:00:00.000Z',uniqueSessions:1,uniqueProjects:1,errorCategories:[{name:'target-not-found',count:4}]},
    ],
  }, {view:'needs-attention',limit:20});
  if (!syntheticAudit.items.some((item) => item.tool === 'schema_fail_tool' && item.status === 'fix-ux-schema')) throw new Error('schema recommendation failed');
  if (!syntheticAudit.items.some((item) => item.tool === 'fallback_tool' && item.status === 'prefer-dedicated')) throw new Error('fallback recommendation failed');
  if (!syntheticAudit.items.some((item) => item.tool === 'unused_tool' && item.status === 'no-evidence')) throw new Error('missing-evidence recommendation failed');
  if (!syntheticAudit.items.some((item) => item.tool === 'low_sample_tool' && item.status === 'no-evidence' && item.reason.includes('sample is too small'))) throw new Error('low-sample recommendation failed');
  if (!syntheticAudit.items.some((item) => item.tool === 'missing_target_tool' && item.status === 'fix-ux-schema' && item.recommendation.includes('target discovery'))) throw new Error('missing-target UX recommendation failed');

  const junctionCatalog = await call('skill_catalog', {sources:['codex-local'],maxResults:50});
  if (!junctionCatalog.skills.some((skill) => skill.name === 'linked-junction-skill')) throw new Error('skill catalog did not follow an allowed directory junction');
  const linkedSkill = junctionCatalog.skills.find((skill) => skill.name === 'linked-junction-skill');
  if (!linkedSkill?.description?.includes('directory junction')) throw new Error(`skill catalog lost plain-scalar frontmatter description: ${JSON.stringify(linkedSkill)}`);
  const pluginCatalog = await call('skill_catalog', {sources:['codex-plugin'],maxResults:50});
  if (!pluginCatalog.skills.some((skill) => skill.name === 'fixture-plugin-skill')) throw new Error(`skill catalog did not discover the managed plugin cache: ${JSON.stringify(pluginCatalog.warnings)}`);

  const structuredRoute = await call('skill_route_plan', {
    task:'DiseÃƒÂ±ar mÃƒÂ¡quinas conectables por puertos, transportar recursos y guardar el proyecto',
    sources:['codex-local'],
    stage:'start',
    maxSkills:8,
    traceId:'__test_route_trace',
    workflowKey:'roblox-network-authoring',
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
  if (structuredRoute.classificationMode !== 'structured-semantic' || structuredRoute.traceId !== '__test_route_trace' || structuredRoute.workflowKey !== 'roblox-network-authoring') throw new Error('structured skill routing mode/trace/workflow failed');
  if (structuredRoute.nextAction?.toolName !== 'skill_bootstrap' || structuredRoute.nextAction?.arguments?.traceId !== structuredRoute.traceId || structuredRoute.nextAction?.arguments?.workflowKey !== structuredRoute.workflowKey) throw new Error('skill_route_plan did not expose an actionable bootstrap continuation');
  if (structuredRoute.nextAction?.fallback?.toolName !== 'bridge_tool_query' || structuredRoute.nextAction?.fallback?.arguments?.toolName !== 'skill_bootstrap' || structuredRoute.nextAction?.fallback?.arguments?.traceId !== structuredRoute.traceId) throw new Error('skill_route_plan did not expose an immediate delegated bootstrap fallback');
  if (structuredRoute.connectorExecution?.policy !== 'direct-then-delegated') throw new Error('compact route omitted connector execution policy');
  for (const name of ['roblox-mcp-skill-router','roblox-safe-editing','roblox-connection-network-authoring']) {
    if (!structuredRoute.loadOrder.includes(name)) throw new Error(`structured route missing active skill ${name}`);
  }
  for (const name of ['roblox-playtest','roblox-studio-qa','roblox-save-backup-recovery']) {
    if (!structuredRoute.deferredLoadOrder.includes(name)) throw new Error(`structured route missing deferred skill ${name}`);
  }
  if (!structuredRoute.coverage.requiredPhases.includes('verification') || !structuredRoute.coverage.requiredPhases.includes('persistence')) throw new Error('structured route phase coverage failed');
  const nonRobloxRoute = await call('skill_route_plan', {
    task:'Publicar un repositorio TypeScript',
    stage:'verify',
    traceId:'__test_non_roblox_route',
    intent:{domains:['git','coding'],actions:['verify','publish'],artifacts:['repository'],needs:['version-control'],signals:['nominal'],risk:'external-side-effect',ambiguity:'low'},
  });
  if (nonRobloxRoute.sourceHealth?.roblox !== undefined) throw new Error('non-Roblox structured route inspected optional Roblox source');
  if (nonRobloxRoute.warnings?.some((warning) => /Roblox/i.test(warning))) throw new Error('non-Roblox structured route leaked Roblox health warning');
  const recommendedRoute = await call('skill_recommend', {
    task:'DiseÃƒÂ±ar mÃƒÂ¡quinas conectables por puertos',
    sources:['codex-local'],
    caller:'chatgpt-web',
    stage:'start',
    traceId:'__test_recommend_trace',
    intent:{domains:['roblox'],actions:['design','create'],artifacts:['network-system'],needs:['safe-editing'],signals:['nominal'],risk:'write',ambiguity:'low'},
  });
  if (recommendedRoute.classificationMode !== 'structured-semantic' || recommendedRoute.traceId !== '__test_recommend_trace' || !recommendedRoute.matches.some((skill) => skill.name === 'roblox-connection-network-authoring')) throw new Error('skill_recommend did not use structured MSSR routing');
  const loadedTraceSkill = await call('skill_load', {name:'roblox-mcp-skill-router',source:'codex',traceId:structuredRoute.traceId,stage:'start',required:true});
  if (loadedTraceSkill.traceId !== structuredRoute.traceId || !loadedTraceSkill.content?.includes('Fixture guidance')) throw new Error('traced skill load failed');
  const neutralDispatch = await call('bridge_tool_action', {toolName:'mssr_trace_record',confirmToolName:'mssr_trace_record',arguments:{traceId:structuredRoute.traceId,eventType:'verification',caller:'chatgpt-web',stage:'verify',status:'success',completedPhases:['discovery','safety','implementation','verification'],contextSources:['current-conversation','project-context'],verificationPassed:true,summary:'Fixture route verified.'}});
  if (neutralDispatch.classification !== 'neutral' || neutralDispatch.delegatedTool !== 'mssr_trace_record' || !neutralDispatch.result?.recorded) throw new Error('neutral fallback dispatch failed');
  const traceResult = await call('mssr_observatory_query', {kind:'trace',traceId:structuredRoute.traceId,limit:30});
  if (!traceResult.trace.some((event) => event.eventType === 'route_planned') || !traceResult.trace.some((event) => event.eventType === 'skill_loaded' && event.ok === true) || !traceResult.trace.some((event) => event.eventType === 'verification')) throw new Error('MSSR observatory trace correlation failed');
  const observatoryStatus = await call('mssr_observatory_query', {kind:'status'});
  if (!observatoryStatus.enabled || !observatoryStatus.privacy || observatoryStatus.privacy.rawPromptsStored !== false) throw new Error('MSSR observatory privacy/status failed');

  await call('mssr_trace_record', {traceId:'fixture-outcome-trace',eventType:'outcome',caller:'chatgpt-web',stage:'close',primarySkill:'roblox-photo-rig-capture',supportingSkills:['systematic-debugging','mssr-agent-routing'],status:'failed',metricName:'artifact-acceptance',score:0.2,accepted:false,evidenceKind:'manifest',evidenceRef:'fixture/results.json',summary:'Initial capture rejected.'});
  await call('mssr_trace_record', {traceId:'fixture-outcome-trace',eventType:'outcome',caller:'chatgpt-web',stage:'close',primarySkill:'roblox-photo-rig-capture',supportingSkills:['systematic-debugging'],status:'success',metricName:'artifact-acceptance',score:0.9,accepted:true,evidenceKind:'mixed',evidenceRef:'fixture/results.json',summary:'Verified capture accepted.'});
  const outcomeTrace = await call('mssr_observatory_query', {kind:'trace',traceId:'fixture-outcome-trace',limit:10});
  const latestOutcome = outcomeTrace.trace.at(-1);
  if (latestOutcome?.skillName !== 'roblox-photo-rig-capture' || latestOutcome?.details?.accepted !== true || latestOutcome?.details?.score !== 0.9) throw new Error('MSSR primary outcome attribution failed');
  const outcomeSummary = await call('mssr_observatory_query', {kind:'summary',days:30});
  const photoOutcome = outcomeSummary.top?.skillOutcomes?.find((item) => item.name === 'roblox-photo-rig-capture');
  if (!photoOutcome || photoOutcome.outcomes !== 1 || photoOutcome.successRate !== 100 || photoOutcome.acceptanceRate !== 100 || photoOutcome.averageScore !== 0.9) throw new Error('MSSR per-skill outcome metrics or latest-outcome dedupe failed');
  if (!outcomeSummary.top?.outcomeSupportingSkills?.some((item) => item.name === 'systematic-debugging' && item.count === 1)) throw new Error('MSSR supporting-skill contribution metric failed');

  const callerRoute = await call('skill_route_plan', {
    task:'Revisar un proyecto local desde Codex',
    caller:'codex-local',
    sources:['codex-local'],
    intent:{domains:['filesystem'],actions:['review'],artifacts:['project'],needs:[],risk:'read-only',ambiguity:'low'},
  });
  if (callerRoute.caller !== 'codex-local' || callerRoute.classifier?.producer !== 'calling-agent' || callerRoute.classifier?.modelCallInsideRouter !== false) throw new Error('skill route caller/classifier metadata failed');
  if (!callerRoute.executionGuidance.some((item) => item.includes('direct local filesystem'))) throw new Error('Codex local execution guidance failed');

  const verificationRoute = await call('skill_route_plan', {
    task:'Verificar el mismo sistema Roblox',
    sources:['codex-local'],
    stage:'verify',
    completedPhases:['discovery','safety','implementation'],
    intent:{
      summary:'VerificaciÃƒÂ³n del sistema Roblox ya implementado',
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
  const routeVocabulary = await call('skill_route_vocabulary');
  if (!routeVocabulary.actions.includes('publish') || routeVocabulary.actions.includes('commit') || !routeVocabulary.signals.includes('reusable-pattern')) throw new Error('skill route vocabulary failed');

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

  const invalidGuideRoot = path.join(root, '.bridge', 'workflow-guides');
  const oversizedPhrasesDir = path.join(invalidGuideRoot, 'oversized-phrases');
  const oversizedPhasesDir = path.join(invalidGuideRoot, 'oversized-phases');
  fs.mkdirSync(oversizedPhrasesDir, {recursive:true});
  fs.mkdirSync(oversizedPhasesDir, {recursive:true});
  const invalidGuideBase = {
    schemaVersion:1,
    title:'Invalid fixture guide',
    description:'This fixture must be isolated without blocking project context.',
    activation:{keywords:[],negativeKeywords:[],examples:[]},
    entrypoint:'GUIDE.md',
    recommendedTools:[],
  };
  fs.writeFileSync(path.join(oversizedPhrasesDir, 'guide.json'), JSON.stringify({
    ...invalidGuideBase,
    name:'oversized-phrases',
    activation:{...invalidGuideBase.activation,phrases:Array.from({length:41},(_,index)=>`phrase ${index}`)},
    phases:{},
  }, null, 2));
  fs.writeFileSync(path.join(oversizedPhasesDir, 'guide.json'), JSON.stringify({
    ...invalidGuideBase,
    name:'oversized-phases',
    activation:{...invalidGuideBase.activation,phrases:[]},
    phases:Object.fromEntries(Array.from({length:25},(_,index)=>[`phase-${String(index).padStart(2,'0')}`,`phases/phase-${index}.md`])),
  }, null, 2));

  const projectContext = await call('project_context_load', {
    projectRoot:root,
    task:'Crear un personaje low poly y preparar las vistas para Blender',
  });
  if (projectContext.documents.length !== 3 || !projectContext.documents.some((item) => item.kind === 'agents') || !projectContext.documents.some((item) => item.kind === 'project-context') || !projectContext.documents.some((item) => item.kind === 'project-state')) throw new Error('project context documents failed');
  if (!projectContext.guides.some((item) => item.name === 'character-concept-blender') || projectContext.recommendation?.recommendation?.action !== 'load_existing') throw new Error('project context guide recommendation failed');
  if (projectContext.guideWarnings?.length !== 2 || !projectContext.guideWarnings.some((item) => item.guideName === 'oversized-phrases' && item.message.includes('at most 40 element')) || !projectContext.guideWarnings.some((item) => item.guideName === 'oversized-phases' && item.message.includes('at most 24 entries'))) throw new Error(`invalid guide isolation failed: ${JSON.stringify(projectContext.guideWarnings)}`);
  if (projectContext.recommendation?.guideWarnings?.length !== 2) throw new Error('project context recommendation did not preserve guide warnings');

  const characterRecommendation = await call('workflow_guide_recommend', {
    task:'Cada vez que creemos un personaje furry low poly quiero generar frente costado espalda y pasarlo a Blender',
    projectRoot:root,
  });
  if (characterRecommendation.recommendation.action !== 'load_existing' || characterRecommendation.recommendation.guide !== 'character-concept-blender') throw new Error('character guide recommendation failed');
  if (characterRecommendation.guideWarnings?.length !== 2) throw new Error('workflow guide recommendation did not isolate invalid guides');
  let invalidGuideLoadRejected = false;
  try {
    await call('workflow_guide_load', {name:'oversized-phrases',projectRoot:root});
  } catch (error) {
    invalidGuideLoadRejected = String(error).includes("Workflow guide 'oversized-phrases' is invalid") && String(error).includes('at most 40 element');
  }
  if (!invalidGuideLoadRejected) throw new Error('explicit invalid workflow guide load was not rejected clearly');

  const genericRecommendation = await call('workflow_guide_recommend', {
    task:'A futuro, cada vez que hagamos una migracion quiero un pipeline reutilizable con pruebas y rollback',
    projectRoot:root,
  });
  if (genericRecommendation.recommendation.action !== 'propose_new' || genericRecommendation.recommendation.builderGuide !== 'workflow-guide-builder') throw new Error('new guide recommendation failed');
  const ownedBySkillRecommendation = await call('workflow_guide_recommend', {
    task:'Cuando terminemos una iteracion larga registra los incidentes, bugs y friccion y arregla la skill propietaria',
    projectRoot:root,
  });
  if (ownedBySkillRecommendation.recommendation.action !== 'use_existing_skill' || ownedBySkillRecommendation.recommendation.skill !== 'skill-maintenance-loop') throw new Error(`existing skill coverage failed: ${JSON.stringify(ownedBySkillRecommendation.recommendation)}`);
  if (!ownedBySkillRecommendation.existingSkillCoverage?.covered) throw new Error('existing skill coverage evidence missing');

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
  const savedSinglePath = path.join(root,'images','single.png');
  const savedSingleBytes = fs.readFileSync(savedSinglePath);
  const savedSingleSha256 = crypto.createHash('sha256').update(savedSingleBytes).digest('hex');
  const attachedImage = await call('image_file_attach', {
    items:[{path:savedSinglePath,label:'fixture-front',expectedSha256:savedSingleSha256}],
  });
  if (attachedImage.mode !== 'single' || attachedImage.itemCount !== 1 || attachedImage.totalBytes !== savedSingleBytes.length || !attachedImage.originalBytesPreserved) throw new Error('local image attachment metadata failed');
  if (attachedImage.attached[0].width !== 2 || attachedImage.attached[0].height !== 2 || attachedImage.attached[0].sha256 !== savedSingleSha256 || attachedImage.attached[0].transformed) throw new Error('local image attachment inspection failed');
  if (!Array.isArray(attachedImage.__bridgeImages) || attachedImage.__bridgeImages.length !== 1 || Buffer.from(attachedImage.__bridgeImages[0].data,'base64').compare(savedSingleBytes) !== 0) throw new Error('local image attachment did not preserve the original image bytes');
  let imageHashRejected = false;
  try {
    await call('image_file_attach', {items:[{path:savedSinglePath,expectedSha256:'0'.repeat(64)}]});
  } catch (error) {
    imageHashRejected = String(error).includes('SHA-256 mismatch');
  }
  if (!imageHashRejected) throw new Error('local image attachment accepted an incorrect expected hash');
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
  const restoreTool = registry.tools.find((tool) => tool.name === 'git_restore_file');
  if (!restoreTool?.inputSchema?.not) throw new Error('git restore schema must reject staged=false + worktree=false');
  const restored = await call('git_restore_file',{cwd:root,path:'app.txt'});
  const restoredText = fs.readFileSync(path.join(root,'app.txt'),'utf8').replace(/\r\n/g,'\n');
  if (!restored.restored || restoredText !== 'original\n') throw new Error('git restore failed');

  const largeGitRoot = path.join(root, 'large-path-repo');
  fs.mkdirSync(largeGitRoot, {recursive:true});
  execFileSync('git',['init','-b','main'],{cwd:largeGitRoot,stdio:'pipe'});
  execFileSync('git',['config','user.name','Bridge Regression'],{cwd:largeGitRoot,stdio:'pipe'});
  execFileSync('git',['config','user.email','bridge-regression@example.invalid'],{cwd:largeGitRoot,stdio:'pipe'});
  for (let index = 0; index < 320; index += 1) {
    const directory = path.join(largeGitRoot, `group-${String(index % 20).padStart(2,'0')}`);
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(path.join(directory, `artifact-${String(index).padStart(4,'0')}-${'long-name-'.repeat(12)}.txt`), `row ${index}\n`);
  }
  const largeCommit = await call('git_commit_all',{cwd:largeGitRoot,message:'test: large path set'});
  if (!largeCommit.committed) throw new Error(`large-path git commit failed: ${JSON.stringify(largeCommit)}`);
  const largeShow = await call('git_show_commit',{cwd:largeGitRoot,ref:'HEAD',includePatch:false,maxChars:20000});
  if (largeShow.code !== 0 || largeShow.error) throw new Error(`large-path git show failed: ${JSON.stringify(largeShow)}`);
  execFileSync('git',['switch','-c','comparison'],{cwd:largeGitRoot,stdio:'pipe'});
  fs.writeFileSync(path.join(largeGitRoot,'comparison.txt'),'comparison\n');
  execFileSync('git',['add','comparison.txt'],{cwd:largeGitRoot,stdio:'pipe'});
  execFileSync('git',['commit','-m','test: comparison'],{cwd:largeGitRoot,stdio:'pipe'});
  const largeCompare = await call('git_compare_branches',{cwd:largeGitRoot,base:'main',head:'comparison',maxChars:20000});
  if (largeCompare.diff.code !== 0 || largeCompare.diff.error) throw new Error(`large-path git compare failed: ${JSON.stringify(largeCompare)}`);

  const snap = await call('workspace_snapshot',{projectRoot:root,label:'integration fixture'});
  if (!snap.verified || !snap.manifestPath || !fs.existsSync(snap.manifestPath)) throw new Error('workspace snapshot manifest readback failed');
  const immediateSnapshotDiff = await call('workspace_diff',{snapshotId:snap.snapshot.id,projectRoot:root});
  if (immediateSnapshotDiff.changed) throw new Error('fresh workspace snapshot was not immediately readable/stable');
  let legacySnapshotRejected = false;
  try { await call('workspace_diff',{snapshotId:'snapshot_1785002749168_19',projectRoot:root}); } catch (error) { legacySnapshotRejected = /legacy snapshot|older live Bridge|fresh workspace_snapshot/i.test(String(error)); }
  if (!legacySnapshotRejected) throw new Error('legacy snapshot id did not return actionable lifecycle guidance');

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

  const staleCacheDir = path.join(process.env.BRIDGE_MCP_CACHE_DIR, 'stale-fixture');
  fs.mkdirSync(staleCacheDir, {recursive:true});
  const staleCachePath = path.join(staleCacheDir, 'stale.json');
  fs.writeFileSync(staleCachePath, JSON.stringify({version:2,namespace:'stale-fixture',key:'stale',value:{old:true}}));
  const staleCacheTime = new Date(Date.now() - 8 * 24 * 60 * 60_000);
  fs.utimesSync(staleCachePath, staleCacheTime, staleCacheTime);

  writePersistentCache('fixture','one',{value:1});
  if (fs.existsSync(staleCachePath)) throw new Error('first persistent cache write did not prune stale entries');
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
  closeMssrObservatoryForTests();
  closeMetricsForTests();
  fs.rmSync(sandbox,{recursive:true,force:true});
}
