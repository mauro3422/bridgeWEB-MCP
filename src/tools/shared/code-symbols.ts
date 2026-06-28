import path from "node:path";

export type CodeSymbolKind = "function" | "class" | "const" | "type" | "interface" | "export";
export type CodeSymbol = {
  name: string;
  kind: CodeSymbolKind;
  line: number;
  text: string;
  exported: boolean;
};

export type CodeReference = {
  line: number;
  text: string;
  kind: "definition" | "import" | "call" | "reference";
};

export function splitCodeLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/);
}

function wordPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`);
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ts") return "TypeScript";
  if (ext === ".tsx") return "TypeScript React";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "JavaScript";
  if (ext === ".json") return "JSON";
  if (ext === ".md") return "Markdown";
  if (ext === ".ps1") return "PowerShell";
  return ext ? ext.slice(1).toUpperCase() : "text";
}

export function extractCodeSymbols(text: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = splitCodeLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const lineNo = i + 1;
    const exported = trimmed.startsWith("export ");

    const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (functionMatch?.[1]) symbols.push({ name: functionMatch[1], kind: "function", line: lineNo, text: trimmed.slice(0, 200), exported });

    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch?.[1]) symbols.push({ name: classMatch[1], kind: "class", line: lineNo, text: trimmed.slice(0, 200), exported });

    const constMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (constMatch?.[1]) symbols.push({ name: constMatch[1], kind: "const", line: lineNo, text: trimmed.slice(0, 200), exported });

    const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/);
    if (typeMatch?.[1]) symbols.push({ name: typeMatch[1], kind: "type", line: lineNo, text: trimmed.slice(0, 200), exported });

    const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/);
    if (interfaceMatch?.[1]) symbols.push({ name: interfaceMatch[1], kind: "interface", line: lineNo, text: trimmed.slice(0, 200), exported });

    const namedExport = trimmed.match(/^export\s*\{\s*([^}]+)\s*\}/);
    if (namedExport?.[1]) {
      for (const part of namedExport[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/i)[0]?.trim();
        if (name) symbols.push({ name, kind: "export", line: lineNo, text: trimmed.slice(0, 200), exported: true });
      }
    }
  }
  return symbols;
}

export function findReferences(text: string, name: string): CodeReference[] {
  const pattern = wordPattern(name);
  const lines = splitCodeLines(text);
  const refs: CodeReference[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (!pattern.test(raw)) continue;
    const textLine = raw.trim().slice(0, 240);
    let kind: CodeReference["kind"] = "reference";
    if (/^(export\s+)?(async\s+)?function\s+/.test(textLine) || /^(export\s+)?(const|let|var|class|type|interface)\s+/.test(textLine)) kind = "definition";
    else if (/^import\s/.test(textLine) || /^export\s*\{/.test(textLine)) kind = "import";
    else if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(textLine)) kind = "call";
    refs.push({ line: i + 1, text: textLine, kind });
  }
  return refs;
}
