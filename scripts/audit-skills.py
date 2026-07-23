from __future__ import annotations

import hashlib
import html
import json
import math
import os
import re
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

BRIDGE_ROOT = Path(os.environ.get("BRIDGE_MCP_PROJECT_ROOT", Path(__file__).resolve().parents[1]))
CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
CODEX_SKILLS_ROOT = CODEX_HOME / "skills"
DEFAULT_SKILL_REPO_ROOT = Path(r"C:\Dev\mauroprime-skills\skills")
LOCAL_ROOT = Path(os.environ.get("MAUROPRIME_SKILL_REPO_ROOT", DEFAULT_SKILL_REPO_ROOT if DEFAULT_SKILL_REPO_ROOT.exists() else CODEX_SKILLS_ROOT))
SYSTEM_ROOT = CODEX_SKILLS_ROOT / ".system"
PLUGIN_ROOT = CODEX_HOME / "plugins" / "cache"
OUTPUT_ROOT = CODEX_SKILLS_ROOT / "_dashboard"
ROUTING_ROOT = BRIDGE_ROOT / "config" / "skill-routing"
ROUTING_PATH = Path(os.environ.get("BRIDGE_MCP_SKILL_ROUTING_PATH", ROUTING_ROOT / "skill-routing-overrides.json"))
ROUTING_SCHEMA_PATH = ROUTING_ROOT / "skill-routing.schema.json"
ROUTING_FIXTURES_PATH = ROUTING_ROOT / "skill-routing-fixtures.json"
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

REMOTE_ROBLOX = [
    {
        "name": "rbx-create-skill",
        "description": "Crea o modifica skills personales de Roblox Studio; reserva el prefijo rbx- para Roblox.",
        "summary": "Guía un proceso corto de requisitos, nombre, descripción, cuerpo, creación/edición y prueba. Recomienda skills específicas, concisas y menores a 500 líneas.",
        "category": "Roblox oficial",
    },
    {
        "name": "rbx-device-simulator-lua",
        "description": "Prueba UI de Roblox en teléfonos, tabletas, consolas, VR y orientaciones mediante Device Simulator.",
        "summary": "Combina estructura StarterGui, configuración de safe areas, cambio dinámico de dispositivo, capturas, consola y mediciones exactas. Revierte siempre el simulador al finalizar.",
        "category": "Roblox oficial",
    },
    {
        "name": "rbx-docs-search",
        "description": "Consulta documentación oficial de Roblox con páginas Markdown e índices llms.txt.",
        "summary": "Confirma APIs y guías sin adivinar nombres; usa búsquedas acotadas por query y sigue enlaces entre referencia de Engine y guías del Creator Hub.",
        "category": "Roblox oficial",
    },
    {
        "name": "rbx-perf-profiling",
        "description": "Analiza MicroProfiler con LibMP: CPU, GPU, frames, scopes, contadores y asignaciones.",
        "summary": "Separa picos de estado estable, respeta límites de frame, snapshots, hilos y cruces de scopes entre frames. Exige liberar sesiones, iteradores y arrays.",
        "category": "Roblox oficial",
    },
    {
        "name": "rbx-scene-analysis",
        "description": "Analiza composición, render, memoria, assets e instancias no parentadas con SceneAnalysisService.",
        "summary": "Ejecuta análisis en Play, diferencia cliente/servidor, excluye sombras de presupuestos controlables y ofrece loops para salud, render, memoria y limpieza.",
        "category": "Roblox oficial",
    },
    {
        "name": "rbx-unit-test",
        "description": "Diseña, ejecuta y depura pruebas unitarias Luau para ModuleScripts.",
        "summary": "Detecta Jest-Lua/TestEZ antes de crear harness propio, prueba contratos y no implementaciones, aísla dependencias y separa unit tests de playtesting visual.",
        "category": "Roblox oficial",
    },
]

STOPWORDS = {
    "the", "and", "for", "with", "from", "this", "that", "when", "use", "using", "into", "your", "user",
    "una", "uno", "unos", "unas", "para", "como", "con", "desde", "este", "esta", "esto", "cuando", "usar",
    "skill", "skills", "roblox", "codex", "studio", "mcp", "tool", "tools", "workflow", "project", "agent",
}


def load_routing() -> dict:
    try:
        data = json.loads(ROUTING_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"schemaVersion": 1, "skills": {}, "workflows": [], "warning": f"No se pudo leer {ROUTING_PATH}"}
    data.setdefault("skills", {})
    data.setdefault("workflows", [])
    return data


@dataclass
class SkillFile:
    name: str
    description: str
    source: str
    category: str
    path: str
    version: str
    sha256: str
    chars: int
    lines: int
    headings: list[str]
    text: str
    frontmatter_ok: bool
    writable: bool


def parse_frontmatter(text: str) -> tuple[str, str, bool]:
    if not text.startswith("---"):
        return "", "", False
    match = re.match(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", text, re.S)
    if not match:
        return "", "", False
    block = match.group(1)
    values: dict[str, str] = {}
    lines = block.splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", lines[i])
        if not m:
            i += 1
            continue
        key, value = m.group(1).lower(), m.group(2).strip()
        if value in {">", ">-", "|", "|-"}:
            collected: list[str] = []
            i += 1
            while i < len(lines) and (lines[i].startswith(" ") or lines[i].startswith("\t")):
                collected.append(lines[i].strip())
                i += 1
            values[key] = ("\n" if value.startswith("|") else " ").join(collected)
            continue
        values[key] = value.strip("\"'")
        i += 1
    return values.get("name", ""), values.get("description", ""), True


def category_for(name: str, path: Path, source: str) -> str:
    n = name.lower()
    p = str(path).lower()
    if source == "codex-system":
        return "Codex sistema"
    if source == "codex-local":
        if n.startswith("roblox-"):
            return "Roblox propio"
        if n.startswith("blender-"):
            return "Blender propio"
        if n.startswith("opencode-"):
            return "OpenCode propio"
        return "Gobernanza y coordinación"
    if "openai-templates" in p or n.startswith("artifact-template-"):
        return "Plantillas de artefactos"
    if "figma" in p or n.startswith("figma-"):
        return "Figma"
    if "canva" in p or n.startswith("canva-"):
        return "Canva"
    if "github" in p or n in {"github", "yeet"} or n.startswith("gh-"):
        return "GitHub"
    if "google-drive" in p or n.startswith("google-"):
        return "Google Workspace"
    if "openai-developers" in p or n.startswith("openai-") or n in {"agents-sdk", "build-chatgpt-app", "chatgpt-app-submission"}:
        return "OpenAI desarrollo"
    if n in {"documents", "pdf", "presentations", "spreadsheets", "excel-live-control", "template-creator"}:
        return "Artefactos runtime"
    if n in {"computer-use", "control-chrome", "control-in-app-browser", "sites-building", "sites-hosting", "visualize"}:
        return "Control y sitios"
    return "Plugin diverso"


def source_for(path: Path) -> str:
    low = [part.lower() for part in path.parts]
    if ".system" in low:
        return "codex-system"
    if PLUGIN_ROOT in path.parents:
        return "codex-plugin"
    return "codex-local"


def plugin_version(path: Path) -> str:
    if PLUGIN_ROOT not in path.parents:
        return "local"
    parts = path.parts
    try:
        cache_index = [p.lower() for p in parts].index("cache")
    except ValueError:
        return "plugin"
    suffix = list(parts[cache_index + 1 :])
    for item in suffix:
        if re.search(r"\d", item) and item.lower() not in {"skills"}:
            return item
    return "plugin"


def read_skill(path: Path) -> SkillFile | None:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return None
    name, description, ok = parse_frontmatter(text)
    name = name or path.parent.name
    headings = [m.group(2).strip() for m in re.finditer(r"^(#{1,4})\s+(.+?)\s*$", text, re.M)]
    source = source_for(path)
    return SkillFile(
        name=name,
        description=description,
        source=source,
        category=category_for(name, path, source),
        path=str(path),
        version=plugin_version(path),
        sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        chars=len(text),
        lines=len(text.splitlines()),
        headings=headings,
        text=text,
        frontmatter_ok=ok,
        writable=source in {"codex-local", "codex-system"},
    )


def discover() -> list[SkillFile]:
    paths: list[Path] = []
    if LOCAL_ROOT.exists():
        paths.extend(LOCAL_ROOT.rglob("SKILL.md"))
    if SYSTEM_ROOT.exists() and SYSTEM_ROOT.resolve() != LOCAL_ROOT.resolve():
        paths.extend(SYSTEM_ROOT.rglob("SKILL.md"))
    if PLUGIN_ROOT.exists():
        paths.extend(PLUGIN_ROOT.rglob("SKILL.md"))
    unique_paths = sorted({path.resolve() for path in paths})
    skills = [s for path in unique_paths if (s := read_skill(path))]
    return sorted(skills, key=lambda s: (s.source, s.name.lower(), s.path.lower()))


def norm_tokens(text: str) -> set[str]:
    words = re.findall(r"[a-záéíóúüñ0-9_-]{3,}", text.lower())
    return {w for w in words if w not in STOPWORDS}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def dependency_graph(skills: list[SkillFile], routing: dict) -> tuple[dict[str, set[str]], list[dict], list[list[str]]]:
    local = [s for s in skills if s.source in {"codex-local", "codex-system"}]
    names = sorted({s.name for s in local}, key=len, reverse=True)
    edges: dict[str, set[str]] = defaultdict(set)
    for skill in local:
        lowered = skill.text.lower()
        for target in names:
            if target == skill.name:
                continue
            if re.search(rf"(?<![a-z0-9_-]){re.escape(target.lower())}(?![a-z0-9_-])", lowered):
                edges[skill.name].add(target)
    inbound = Counter(t for targets in edges.values() for t in targets)
    nodes = sorted({s.name for s in local})
    orphan = [
        {"name": n, "outgoing": len(edges.get(n, set())), "incoming": inbound[n]}
        for n in nodes
        if not edges.get(n) and inbound[n] == 0
    ]

    # Textual mentions are useful dashboard references, but only explicit
    # `requires` edges are mandatory dependencies. Complements and prose may
    # legitimately point both ways and must not be reported as dependency cycles.
    required_edges: dict[str, set[str]] = defaultdict(set)
    routing_skills = routing.get("skills", {}) if isinstance(routing, dict) else {}
    for name, metadata in routing_skills.items():
        if not isinstance(metadata, dict):
            continue
        for target in metadata.get("requires", []):
            if isinstance(target, str):
                required_edges[name].add(target)

    cycles: list[list[str]] = []
    state: dict[str, int] = {}
    stack: list[str] = []
    index: dict[str, int] = {}

    def visit(node: str) -> None:
        state[node] = 1
        index[node] = len(stack)
        stack.append(node)
        for nxt in sorted(required_edges.get(node, set())):
            if state.get(nxt, 0) == 0:
                visit(nxt)
            elif state.get(nxt) == 1:
                cycle = stack[index[nxt] :] + [nxt]
                canonical = min((cycle[i:-1] + cycle[:i] + [cycle[i]]) for i in range(len(cycle)-1))
                if canonical not in cycles:
                    cycles.append(canonical)
        stack.pop()
        index.pop(node, None)
        state[node] = 2

    for node in nodes:
        if state.get(node, 0) == 0:
            visit(node)
    return edges, orphan, cycles


def analyze(skills: list[SkillFile], routing: dict) -> dict:
    by_name: dict[str, list[SkillFile]] = defaultdict(list)
    for s in skills:
        by_name[s.name].append(s)

    exact_duplicate_groups = []
    divergent_groups = []
    for name, entries in sorted(by_name.items()):
        if len(entries) < 2:
            continue
        hashes = {e.sha256 for e in entries}
        item = {
            "name": name,
            "copies": len(entries),
            "versions": [e.version for e in entries],
            "paths": [e.path for e in entries],
        }
        (exact_duplicate_groups if len(hashes) == 1 else divergent_groups).append(item)

    local = [s for s in skills if s.source == "codex-local"]
    system = [s for s in skills if s.source == "codex-system"]
    plugin = [s for s in skills if s.source == "codex-plugin"]

    overlap_pairs = []
    for i, a in enumerate(local):
        ta = norm_tokens(a.description + " " + " ".join(a.headings))
        for b in local[i + 1 :]:
            tb = norm_tokens(b.description + " " + " ".join(b.headings))
            score = jaccard(ta, tb)
            if score >= 0.16:
                overlap_pairs.append({"a": a.name, "b": b.name, "score": round(score, 3)})
    overlap_pairs.sort(key=lambda x: x["score"], reverse=True)

    edges, orphan, cycles = dependency_graph(skills, routing)
    inbound = Counter(t for targets in edges.values() for t in targets)
    dependency_rows = [
        {
            "name": name,
            "outgoing": sorted(targets),
            "incoming": inbound[name],
        }
        for name, targets in sorted(edges.items())
    ]

    warnings = []
    for s in local + system:
        if not s.frontmatter_ok:
            warnings.append({"skill": s.name, "type": "frontmatter", "detail": "Frontmatter ausente o inválido"})
        if not s.description.strip():
            warnings.append({"skill": s.name, "type": "description", "detail": "Descripción vacía"})
        if s.lines > 500:
            warnings.append({"skill": s.name, "type": "length", "detail": f"{s.lines} líneas; considerar separar referencias largas"})

    # Architectural findings are intentionally explicit and reproducible.
    findings = [
        {
            "priority": "alta",
            "title": "Separar router, bootstrap y mantenimiento",
            "detail": "roblox-mcp-skill-router decide rutas de Roblox; skill_bootstrap descubre/carga; skill-maintenance-loop aprende al cierre. Deben referenciarse entre sí sin copiar contenido.",
            "skills": ["roblox-mcp-skill-router", "shared-skill-governance", "skill-maintenance-loop", "mauroprime-bridge-collaboration"],
        },
        {
            "priority": "alta",
            "title": "Crear un loop compuesto para cambios persistentes en Roblox",
            "detail": "La secuencia reusable es safe-editing → dominio específico → studio-qa/playtest/unit-test según corresponda → save-backup-recovery → maintenance-loop.",
            "skills": ["roblox-safe-editing", "roblox-studio-qa", "roblox-playtest", "roblox-save-backup-recovery", "skill-maintenance-loop"],
        },
        {
            "priority": "media",
            "title": "Unificar revisiones visuales mediante una base común",
            "detail": "animation-frame, locomotion-camera y model-turnaround comparten captura determinista, múltiples ángulos, mediciones y before/after. Conviene una skill base visual-evidence-review y dejar especializaciones finas.",
            "skills": ["roblox-animation-frame-review", "roblox-locomotion-camera-review", "roblox-model-turnaround-review", "roblox-studio-qa"],
        },
        {
            "priority": "media",
            "title": "Encadenar placement authoring con UI review",
            "detail": "placement-system-authoring gobierna arquitectura/autoridad; placement-ui-review gobierna composición visual. Deben declararse mutuamente como complementarias, no competir por activación.",
            "skills": ["roblox-placement-system-authoring", "roblox-placement-ui-review", "roblox-ui-ux"],
        },
        {
            "priority": "media",
            "title": "Conectar redes de recursos con pruebas unitarias y performance",
            "detail": "resource-network-test debe cargar rbx-unit-test para módulos puros y activar scene/perf sólo cuando tamaño o frame-time lo justifiquen.",
            "skills": ["roblox-resource-network-test", "roblox-connection-network-authoring", "rbx-unit-test", "rbx-scene-analysis", "rbx-perf-profiling"],
        },
        {
            "priority": "baja",
            "title": "Deduplicar el catálogo de plugins por precedencia",
            "detail": "Varias skills de Figma, GitHub, Google y Canva aparecen en cache local y remote. El dashboard debe elegir una versión preferida y mostrar las demás como alternativas, sin editar caches administrados.",
            "skills": [],
        },
    ]

    return {
        "generatedAt": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
        "roots": {"local": str(LOCAL_ROOT), "plugins": str(PLUGIN_ROOT)},
        "counts": {
            "physicalFiles": len(skills),
            "uniqueFileNames": len(by_name),
            "local": len(local),
            "system": len(system),
            "plugin": len(plugin),
            "robloxRemote": len(REMOTE_ROBLOX),
            "uniqueIncludingRemote": len(set(by_name) | {x["name"] for x in REMOTE_ROBLOX}),
            "exactDuplicateGroups": len(exact_duplicate_groups),
            "divergentDuplicateGroups": len(divergent_groups),
        },
        "categories": dict(sorted(Counter(s.category for s in skills).items())),
        "skills": [
            {
                **{k: v for k, v in asdict(s).items() if k != "text"},
                "preview": re.sub(r"\s+", " ", s.text)[:240],
            }
            for s in skills
        ],
        "remoteRoblox": REMOTE_ROBLOX,
        "duplicatesExact": exact_duplicate_groups,
        "duplicatesDivergent": divergent_groups,
        "overlapsLocal": overlap_pairs[:30],
        "dependencies": dependency_rows,
        "orphans": orphan,
        "cycles": cycles,
        "warnings": warnings,
        "findings": findings,
    }


def preferred_entries(report: dict, routing: dict) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for item in report["skills"]:
        groups[item["name"]].append(item)
    preferred = []
    source_rank = {"codex-local": 0, "codex-system": 1, "codex-plugin": 2}
    for name, entries in groups.items():
        entries.sort(key=lambda e: (source_rank.get(e["source"], 9), "remote" not in e["path"].lower(), e["path"]))
        chosen = dict(entries[0])
        chosen["copies"] = len(entries)
        chosen["alternatePaths"] = [e["path"] for e in entries[1:]]
        chosen["routing"] = routing.get("skills", {}).get(name, {})
        preferred.append(chosen)
    preferred.extend({
        "name": x["name"], "description": x["description"], "source": "roblox", "category": x["category"],
        "path": "Roblox Studio MCP (live)", "version": "live", "sha256": "", "chars": 0, "lines": 0,
        "headings": [], "frontmatter_ok": True, "writable": False, "preview": x["summary"], "copies": 1,
        "alternatePaths": [], "routing": routing.get("skills", {}).get(x["name"], {}),
    } for x in report["remoteRoblox"])
    return sorted(preferred, key=lambda e: (e["category"], e["name"].lower()))


def render_html(report: dict, routing: dict) -> str:
    preferred = preferred_entries(report, routing)
    data_json = json.dumps({"skills": preferred, "report": report, "routing": routing}, ensure_ascii=False).replace("</", "<\\/")
    cards = "".join(
        f'<div class="metric"><strong>{value}</strong><span>{label}</span></div>'
        for label, value in [
            ("Entradas físicas", report["counts"]["physicalFiles"]),
            ("Skills únicas", report["counts"]["uniqueIncludingRemote"]),
            ("Skills propias", report["counts"]["local"]),
            ("Roblox oficiales", report["counts"]["robloxRemote"]),
            ("Grupos duplicados", report["counts"]["exactDuplicateGroups"] + report["counts"]["divergentDuplicateGroups"]),
        ]
    )
    findings_html = "".join(
        f'<article class="finding {html.escape(f["priority"])}"><div><b>{html.escape(f["title"])}</b><small>{html.escape(f["priority"])}</small></div><p>{html.escape(f["detail"])}</p><code>{html.escape(" · ".join(f["skills"]))}</code></article>'
        for f in report["findings"]
    )
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard de Skills — MauroPrime</title>
<style>
:root{{--bg:#0d1117;--panel:#161b22;--panel2:#21262d;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--good:#3fb950;--warn:#d29922;--bad:#f85149}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,Segoe UI,Arial,sans-serif}}header{{position:sticky;top:0;z-index:5;background:rgba(13,17,23,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:18px 24px}}h1{{margin:0 0 4px;font-size:22px}}header p{{margin:0;color:var(--muted)}}main{{max-width:1500px;margin:auto;padding:22px}}.metrics{{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:12px;margin-bottom:18px}}.metric,.panel,.skill,.finding{{background:var(--panel);border:1px solid var(--line);border-radius:12px}}.metric{{padding:16px}}.metric strong{{display:block;font-size:25px}}.metric span{{color:var(--muted)}}.controls{{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;margin:14px 0}}input,select,button{{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px}}button{{cursor:pointer}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}}.skill{{padding:15px;display:flex;flex-direction:column;gap:8px}}.skill h3{{margin:0;font-size:16px}}.badges{{display:flex;gap:6px;flex-wrap:wrap}}.badge{{padding:2px 7px;border-radius:99px;background:var(--panel2);color:var(--muted);font-size:11px}}.source-roblox{{color:#ff7ac6}}.source-codex-local{{color:var(--good)}}.source-codex-system{{color:var(--warn)}}.skill p{{margin:0;color:#c9d1d9}}.meta{{font-size:11px;color:var(--muted);word-break:break-all}}details{{border-top:1px solid var(--line);padding-top:8px}}summary{{cursor:pointer;color:var(--accent)}}.tabs{{display:flex;gap:8px;margin:25px 0 12px}}.tab{{border-color:var(--line)}}.tab.active{{border-color:var(--accent);color:var(--accent)}}.panel{{padding:18px}}.finding{{padding:14px;margin:9px 0}}.finding>div{{display:flex;justify-content:space-between;gap:12px}}.finding small{{text-transform:uppercase;color:var(--muted)}}.finding p{{margin:7px 0}}.finding code{{white-space:normal;color:var(--accent)}}table{{width:100%;border-collapse:collapse}}th,td{{border-bottom:1px solid var(--line);padding:9px;text-align:left;vertical-align:top}}th{{color:var(--muted)}}.hidden{{display:none!important}}.empty{{padding:30px;text-align:center;color:var(--muted)}}@media(max-width:800px){{.metrics{{grid-template-columns:repeat(2,1fr)}}.controls{{grid-template-columns:1fr}}}}
</style></head>
<body><header><h1>Dashboard de Skills — MauroPrime</h1><p>Fuente canónica: {html.escape(str(LOCAL_ROOT))} · generado {html.escape(report['generatedAt'])}</p></header>
<main><section class="metrics">{cards}</section>
<div class="tabs"><button class="tab active" data-tab="catalog">Catálogo</button><button class="tab" data-tab="workflows">Workflows</button><button class="tab" data-tab="findings">Arquitectura</button><button class="tab" data-tab="duplicates">Duplicados</button><button class="tab" data-tab="dependencies">Dependencias</button></div>
<section id="catalog" class="tabpage"><div class="controls"><input id="search" placeholder="Buscar nombre, descripción, categoría, fase o ruta…"><select id="source"><option value="">Todas las fuentes</option></select><select id="category"><option value="">Todas las categorías</option></select><button id="reset">Limpiar</button></div><div id="count"></div><div id="skills" class="grid"></div></section>
<section id="workflows" class="tabpage hidden"><div class="panel"><h2>Routing estructurado y workflows</h2><p class="meta">Contrato Git: {html.escape(str(ROUTING_PATH))}<br>Schema: {html.escape(str(ROUTING_SCHEMA_PATH))}<br>Fixtures: {html.escape(str(ROUTING_FIXTURES_PATH))}</p><div id="workflow-list"></div></div></section>
<section id="findings" class="tabpage hidden"><div class="panel"><h2>Hallazgos y mejoras de loop</h2>{findings_html}</div></section>
<section id="duplicates" class="tabpage hidden"><div class="panel"><h2>Duplicados y versiones divergentes</h2><div id="dup"></div></div></section>
<section id="dependencies" class="tabpage hidden"><div class="panel"><h2>Referencias entre skills propias y de sistema</h2><div id="deps"></div></div></section>
</main><script id="payload" type="application/json">{data_json}</script><script>
const DATA=JSON.parse(document.getElementById('payload').textContent), skills=DATA.skills, report=DATA.report, routing=DATA.routing;
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}}[c]));
function options(id,vals){{const el=$(id);[...new Set(vals)].sort().forEach(v=>el.insertAdjacentHTML('beforeend',`<option>${{esc(v)}}</option>`))}}
options('#source',skills.map(x=>x.source));options('#category',skills.map(x=>x.category));
function render(){{const q=$('#search').value.toLowerCase(),src=$('#source').value,cat=$('#category').value;const rows=skills.filter(x=>(!src||x.source===src)&&(!cat||x.category===cat)&&(!q||`${{x.name}} ${{x.description}} ${{x.category}} ${{x.path}} ${{x.preview}} ${{x.routing?.phase||''}} ${{(x.routing?.coversPhases||[]).join(' ')}} ${{(x.routing?.domains||[]).join(' ')}} ${{(x.routing?.actions||[]).join(' ')}}`.toLowerCase().includes(q)));$('#count').innerHTML=`<p><b>${{rows.length}}</b> skills visibles</p>`;$('#skills').innerHTML=rows.length?rows.map(x=>`<article class="skill"><div><h3>${{esc(x.name)}}</h3><div class="badges"><span class="badge source-${{esc(x.source)}}">${{esc(x.source)}}</span><span class="badge">${{esc(x.category)}}</span>${{x.routing?.phase?`<span class="badge">${{esc(x.routing.phase)}}</span>`:''}}${{x.copies>1?`<span class="badge">${{x.copies}} copias</span>`:''}}</div></div><p>${{esc(x.description||x.preview||'Sin descripción')}}</p><details><summary>Detalles</summary><p>${{esc(x.preview||'')}}</p>${{x.routing&&Object.keys(x.routing).length?`<div class="meta"><b>Routing:</b> ${{esc((x.routing.domains||[]).join(', '))}} · ${{esc((x.routing.actions||[]).join(', '))}}<br><b>Cubre:</b> ${{esc((x.routing.coversPhases||[x.routing.phase]).filter(Boolean).join(', ')||'—')}}<br><b>Requiere:</b> ${{esc((x.routing.requires||[]).join(', ')||'—')}}</div>`:''}}<div class="meta">${{esc(x.path)}}${{x.lines?` · ${{x.lines}} líneas`:''}}</div>${{x.alternatePaths?.length?`<div class="meta"><b>Alternativas:</b><br>${{x.alternatePaths.map(esc).join('<br>')}}</div>`:''}}</details></article>`).join(''):'<div class="empty">Sin resultados</div>'}}
['#search','#source','#category'].forEach(s=>$(s).addEventListener('input',render));$('#reset').onclick=()=>{{$('#search').value='';$('#source').value='';$('#category').value='';render()}};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabpage').forEach(x=>x.classList.add('hidden'));b.classList.add('active');$('#'+b.dataset.tab).classList.remove('hidden')}});
const dupRows=[...report.duplicatesDivergent.map(x=>({{...x,type:'Divergente'}})),...report.duplicatesExact.map(x=>({{...x,type:'Copia exacta'}}))];$('#dup').innerHTML=dupRows.length?`<table><thead><tr><th>Skill</th><th>Tipo</th><th>Copias/versiones</th><th>Rutas</th></tr></thead><tbody>${{dupRows.map(x=>`<tr><td>${{esc(x.name)}}</td><td>${{esc(x.type)}}</td><td>${{esc(x.copies)}} · ${{x.versions.map(esc).join(', ')}}</td><td class="meta">${{x.paths.map(esc).join('<br>')}}</td></tr>`).join('')}}</tbody></table>`:'<p>No hay duplicados.</p>';
$('#deps').innerHTML=`<table><thead><tr><th>Skill</th><th>Referencia a</th><th>Referenciada por</th></tr></thead><tbody>${{report.dependencies.map(x=>`<tr><td>${{esc(x.name)}}</td><td>${{x.outgoing.map(esc).join('<br>')||'—'}}</td><td>${{esc(x.incoming)}}</td></tr>`).join('')}}</tbody></table>${{report.cycles.length?`<h3>Ciclos detectados</h3><pre>${{esc(JSON.stringify(report.cycles,null,2))}}</pre>`:''}}`;
$('#workflow-list').innerHTML=(routing.workflows||[]).length?(routing.workflows||[]).map(w=>`<article class="finding"><div><b>${{esc(w.name)}}</b><small>${{esc(JSON.stringify(w.match))}}</small></div>${{w.phases.map(p=>`<p><b>${{esc(p.phase)}}</b> · ${{p.required===false?'opcional':'requerida'}}<br><code>${{p.skills.map(esc).join(' → ')}}</code>${{p.when?`<br><span class="meta">cuando ${{esc(JSON.stringify(p.when))}}</span>`:''}}</p>`).join('')}}</article>`).join(''):'<p>No hay workflows estructurados.</p>';
render();
</script></body></html>"""


def render_markdown(report: dict) -> str:
    c = report["counts"]
    lines = [
        "# Auditoría de Skills",
        "",
        f"Generado: `{report['generatedAt']}`",
        "",
        "## Resumen",
        "",
        f"- Entradas físicas: **{c['physicalFiles']}**",
        f"- Skills únicas incluyendo Roblox: **{c['uniqueIncludingRemote']}**",
        f"- Skills locales propias: **{c['local']}**",
        f"- Skills de sistema: **{c['system']}**",
        f"- Entradas de plugins: **{c['plugin']}**",
        f"- Skills oficiales vivas de Roblox: **{c['robloxRemote']}**",
        f"- Grupos de copias exactas: **{c['exactDuplicateGroups']}**",
        f"- Nombres con versiones divergentes: **{c['divergentDuplicateGroups']}**",
        "",
        "## Hallazgos de arquitectura",
        "",
    ]
    for f in report["findings"]:
        lines += [f"### {f['title']} ({f['priority']})", "", f["detail"], "", f"Skills: `{', '.join(f['skills']) or 'catálogo de plugins'}`", ""]
    lines += ["## Posibles solapamientos entre skills propias", ""]
    for pair in report["overlapsLocal"][:15]:
        lines.append(f"- `{pair['a']}` ↔ `{pair['b']}`: similitud léxica {pair['score']}")
    lines += ["", "## Validación y mantenimiento", "", "- No editar directamente caches administrados por plugins; usar precedencia o una skill persistente de override.", "- Ejecutar `skill_bootstrap` al iniciar tareas sustanciales y `skill-maintenance-loop` al cerrar iteraciones con aprendizaje reusable.", "- Regenerar este dashboard después de instalar, crear o actualizar grupos importantes de skills.", ""]
    return "\n".join(lines)


def main() -> None:
    skills = discover()
    routing = load_routing()
    report = analyze(skills, routing)
    registry = {
        "schemaVersion": 1,
        "generatedAt": report["generatedAt"],
        "sourceOfTruth": str(LOCAL_ROOT),
        "routingContract": str(ROUTING_PATH),
        "skills": preferred_entries(report, routing),
        "workflows": routing.get("workflows", []),
    }
    (OUTPUT_ROOT / "skills-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_ROOT / "skills-registry.json").write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_ROOT / "skills-dashboard.html").write_text(render_html(report, routing), encoding="utf-8")
    (OUTPUT_ROOT / "SKILLS_AUDIT.md").write_text(render_markdown(report), encoding="utf-8")
    (OUTPUT_ROOT / "ROUTING_SOURCE.md").write_text("\n".join([
        "# Routing source", "",
        "The editable, Git-tracked MSSR contract lives in:", "",
        f"`{ROUTING_ROOT}`", "",
        "This dashboard directory contains generated inspection outputs only.", "",
    ]), encoding="utf-8")
    print(json.dumps({
        "outputRoot": str(OUTPUT_ROOT),
        "dashboard": str(OUTPUT_ROOT / "skills-dashboard.html"),
        "audit": str(OUTPUT_ROOT / "SKILLS_AUDIT.md"),
        "json": str(OUTPUT_ROOT / "skills-audit.json"),
        "registry": str(OUTPUT_ROOT / "skills-registry.json"),
        "routing": str(ROUTING_PATH),
        "schema": str(ROUTING_SCHEMA_PATH),
        "fixtures": str(ROUTING_FIXTURES_PATH),
        "counts": report["counts"],
        "topOverlaps": report["overlapsLocal"][:10],
        "cycles": report["cycles"],
        "warnings": report["warnings"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
