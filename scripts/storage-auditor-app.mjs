import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fsp } from 'node:fs';
import { spawn } from 'node:child_process';
import { createDefaultToolRegistry } from '../dist/tool-registry.js';
import { closeStorageGrowthWatchersForTests } from '../dist/tools/storage-growth-tools.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

const registry = createDefaultToolRegistry();
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.slice('--port='.length) || 3047);
const openBrowser = process.argv.includes('--open');
const roots = {
  dev: process.env.STORAGE_AUDITOR_DEV_ROOT || 'D:\\Dev',
  drive: process.env.STORAGE_AUDITOR_DRIVE_ROOT || 'D:\\',
};

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function driveSpace(root) {
  try {
    const stat = await fsp.statfs(root);
    const totalBytes = stat.blocks * stat.bsize;
    const freeBytes = stat.bavail * stat.bsize;
    return {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes,
      freeRatio: totalBytes > 0 ? freeBytes / totalBytes : null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function windowsExecutablePaths() {
  if (process.platform !== 'win32') return [];
  const script = "$ErrorActionPreference='SilentlyContinue'; @(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath} | Select-Object -ExpandProperty ExecutablePath) | ConvertTo-Json -Compress";
  return await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim() || '[]');
        resolve((Array.isArray(parsed) ? parsed : [parsed]).filter((item) => typeof item === 'string'));
      } catch {
        resolve([]);
      }
    });
  });
}

function annotateHotspots(root, report, executablePaths) {
  const executables = executablePaths.map((item) => path.resolve(item).toLowerCase());
  return (report?.audit?.hotspots || []).map((item) => {
    const absolute = path.resolve(root, item.directory);
    const normalized = absolute.toLowerCase();
    const prefix = normalized.endsWith(path.sep) ? normalized : `${normalized}${path.sep}`;
    const activeExecutables = executables.filter((exe) => exe === normalized || exe.startsWith(prefix));
    return {
      ...item,
      absolute,
      activeProcessExecutableCount: activeExecutables.length,
      activeProcessExecutables: activeExecutables.slice(0, 6),
    };
  });
}

async function runAudit(scope, mode) {
  const root = roots[scope] || roots.dev;
  const maxEntries = scope === 'drive' ? 1_000_000 : 750_000;
  const [report, space, executablePaths] = await Promise.all([
    registry.call('storage_growth_scan', {
      path: root,
      mode,
      top: 40,
      groupDepth: 3,
      maxEntries,
    }),
    driveSpace(root),
    windowsExecutablePaths(),
  ]);

  const capturedMs = Date.parse(report?.capturedAt || '');
  const watcherStartedMs = Date.parse(report?.coverage?.watcherStartedAt || '');
  const continuousSinceSnapshot = Number.isFinite(capturedMs)
    && Number.isFinite(watcherStartedMs)
    && watcherStartedMs <= capturedMs
    && report?.coverage?.watcherActive === true;
  return {
    scope,
    root,
    generatedAt: new Date().toISOString(),
    system: {
      driveSpace: space,
      processExecutableCount: executablePaths.length,
      snapshotTrust: {
        continuousSinceSnapshot,
        requiresReconcile: report?.baselineAvailable === true && !continuousSinceSnapshot,
      },
    },
    ...report,
    audit: report.audit ? {
      ...report.audit,
      hotspots: annotateHotspots(root, report, executablePaths),
    } : report.audit,
  };
}

const page = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Storage Auditor</title>
<style>
:root{color-scheme:dark;--bg:#0c1017;--panel:#151b25;--panel2:#10161f;--line:#2a3443;--text:#e8edf5;--muted:#98a5b8;--good:#67d68a;--warn:#f2c66d;--keep:#79b8ff;--bad:#ff8c8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,Segoe UI,sans-serif}.wrap{max-width:1500px;margin:auto;padding:22px}.head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.title{font-size:26px;font-weight:750}.muted{color:var(--muted)}.toolbar{display:flex;flex-wrap:wrap;gap:8px}.btn{background:#1b2431;border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:9px;cursor:pointer}.btn:hover{background:#222d3c}.btn.active{outline:2px solid #6da9ff}.btn.dangerish{border-color:#735a35}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:14px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px}.card b{display:block;font-size:19px;margin-top:3px}.section{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:12px 0;overflow:hidden}.section h2{font-size:15px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #222b38;vertical-align:top}th{color:var(--muted);font-weight:600;background:var(--panel2);position:sticky;top:0}.scroll{max-height:410px;overflow:auto}.badge{display:inline-block;padding:2px 7px;border-radius:99px;border:1px solid currentColor;font-size:12px}.safe-regenerable{color:var(--good)}.review{color:var(--warn)}.preserve{color:var(--keep)}.project-data{color:var(--muted)}.active{color:var(--bad);font-weight:700}.status{padding:10px 12px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);margin-bottom:12px}.empty{padding:16px;color:var(--muted)}code{color:#c9d7ea} .reason{max-width:520px;color:var(--muted)}
</style>
</head>
<body><div class="wrap">
<div class="head"><div><div class="title">Storage Auditor</div><div class="muted">Baseline persistido + watcher incremental. Diagnóstico solamente: nunca borra archivos.</div></div><div class="toolbar">
<button class="btn active" data-scope="dev">D:\\Dev</button><button class="btn" data-scope="drive">D:\\</button>
<button class="btn" id="statusBtn">Estado</button><button class="btn" id="scanBtn">Analizar cambios</button><button class="btn dangerish" id="baselineBtn">Recrear baseline</button>
</div></div>
<div id="status" class="status">Cargando estado…</div><div id="cards" class="cards"></div>
<div class="section"><h2>Crecimiento desde el baseline anterior</h2><div class="scroll"><table><thead><tr><th>Ruta</th><th>Δ</th><th>Clase</th><th>Motivo</th></tr></thead><tbody id="growth"></tbody></table></div></div>
<div class="section"><h2>Hotspots auditables actuales</h2><div class="scroll"><table><thead><tr><th>Zona</th><th>Tamaño</th><th>Archivos</th><th>Clase</th><th>Actividad</th><th>Motivo</th></tr></thead><tbody id="hotspots"></tbody></table></div></div>
<div class="section"><h2>Categorías del árbol</h2><div class="scroll"><table><thead><tr><th>Categoría</th><th>Tamaño</th><th>Archivos</th><th>Δ</th></tr></thead><tbody id="categories"></tbody></table></div></div>
</div>
<script>
let scope='dev';
const $=id=>document.getElementById(id);
const fmt=b=>{if(b==null)return '—';const a=Math.abs(b),u=a>=1073741824?'GiB':a>=1048576?'MiB':a>=1024?'KiB':'B',d=u==='GiB'?1073741824:u==='MiB'?1048576:u==='KiB'?1024:1;return (b<0?'-':'')+(a/d).toFixed(a/d>=100?0:a/d>=10?1:2)+' '+u};
const badge=x=>'<span class="badge '+x+'">'+x+'</span>';
function render(data){
 const baseline=data.baselineAvailable!==false; const c=data.coverage||{}; const t=data.totals||{}; const sp=data.system?.driveSpace||{}; const trust=data.system?.snapshotTrust||{};
 $('status').innerHTML='<b>'+data.root+'</b> · estrategia <code>'+String(data.strategy||'sin baseline')+'</code> · watcher '+(c.watcherActive?'activo':'no activo')+(c.snapshotComplete===false?' · <span class="active">snapshot incompleto</span>':'')+(trust.requiresReconcile?' · <span class="active">snapshot anterior al watcher: ejecutá Analizar cambios para reconciliar</span>':'');
 $('cards').innerHTML=[['Rastreado',fmt(t.bytes)],['Cambio',fmt(t.deltaBytes)],['Libre en disco',fmt(sp.freeBytes)],['Archivos',t.files??'—'],['Dirs leídos ahora',t.scannedDirectoriesThisPass??0],['Dirty paths',c.dirtyPathsProcessed??0]].map(([a,b])=>'<div class="card"><span class="muted">'+a+'</span><b>'+b+'</b></div>').join('');
 const growth=data.growth||[]; $('growth').innerHTML=growth.length?growth.map(x=>'<tr><td><code>'+x.path+'</code></td><td>'+fmt(x.deltaBytes)+'</td><td>'+badge(x.disposition||'project-data')+'</td><td class="reason">'+(x.reason||'')+'</td></tr>').join(''):'<tr><td colspan="4" class="empty">'+(baseline?'Sin crecimiento detectado en esta pasada.':'Todavía no hay baseline. Crealo una vez y las siguientes pasadas serán incrementales cuando el watcher mantenga cobertura.')+'</td></tr>';
 const hs=data.audit?.hotspots||[]; $('hotspots').innerHTML=hs.length?hs.map(x=>'<tr><td><code>'+x.directory+'</code></td><td>'+fmt(x.bytes)+'</td><td>'+x.files+'</td><td>'+badge(x.disposition)+'</td><td>'+(x.activeProcessExecutableCount?'<span class="active">'+x.activeProcessExecutableCount+' proceso(s)</span>':'sin exe dentro')+'</td><td class="reason">'+x.reason+'</td></tr>').join(''):'<tr><td colspan="6" class="empty">Sin hotspots clasificados.</td></tr>';
 const cats=data.categories||[]; $('categories').innerHTML=cats.map(x=>'<tr><td>'+x.category+'</td><td>'+fmt(x.bytes)+'</td><td>'+x.files+'</td><td>'+fmt(x.deltaBytes)+'</td></tr>').join('');
}
async function run(mode){$('status').textContent='Analizando…'; try{const r=await fetch('/api/scan?scope='+scope+'&mode='+mode);const j=await r.json();if(!r.ok)throw new Error(j.error||'error');render(j)}catch(e){$('status').innerHTML='<span class="active">Error:</span> '+e.message}}
document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-scope]').forEach(x=>x.classList.remove('active'));b.classList.add('active');scope=b.dataset.scope;run('status')});
$('statusBtn').onclick=()=>run('status'); $('scanBtn').onclick=()=>run('auto'); $('baselineBtn').onclick=()=>{if(confirm('Esto no borra nada, pero vuelve a recorrer todo el scope para crear un baseline nuevo. ¿Continuar?'))run('baseline')};
run('status');
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
    return;
  }
  if (url.pathname === '/api/scan') {
    const scope = roots[url.searchParams.get('scope')] ? url.searchParams.get('scope') : 'dev';
    const requestedMode = url.searchParams.get('mode') || 'status';
    const mode = ['status', 'auto', 'baseline'].includes(requestedMode) ? requestedMode : 'status';
    try {
      json(res, 200, await runAudit(scope, mode));
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Storage Auditor: ${url}`);
  console.log('Ctrl+C para cerrar. No realiza borrados automáticos.');
  if (openBrowser && process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }
});

function shutdown() {
  closeStorageGrowthWatchersForTests();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
