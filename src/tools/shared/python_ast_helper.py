#!/usr/bin/env python3
"""
Small stdlib-only Python AST helper for bridge-mcp.

It intentionally emits plain JSON so the TypeScript side can stay dependency-light.
The helper is conservative: it resolves local/module calls well, reports unresolved
calls explicitly, and avoids importing target project code.
"""
from __future__ import annotations

import argparse
import ast
import fnmatch
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "site-packages",
}

TEST_DIRS = {"test", "tests"}


def as_posix(path: Path) -> str:
    return path.as_posix()


def rel_path(root: Path, file_path: Path) -> str:
    try:
        return as_posix(file_path.relative_to(root))
    except ValueError:
        return as_posix(file_path)


def is_test_file(root: Path, file_path: Path) -> bool:
    rel = rel_path(root, file_path).lower()
    parts = set(Path(rel).parts)
    name = file_path.name.lower()
    return bool(
        TEST_DIRS.intersection(parts)
        or name.startswith("test_")
        or name.endswith("_test.py")
        or name.endswith(".test.py")
    )


def iter_python_files(root: Path, pattern: str, include_tests: bool, max_files: int) -> list[Path]:
    files: list[Path] = []
    for current, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        current_path = Path(current)
        for filename in sorted(filenames):
            if len(files) >= max_files:
                return files
            if not fnmatch.fnmatch(filename, pattern):
                continue
            if not filename.endswith(".py"):
                continue
            full = current_path / filename
            if not include_tests and is_test_file(root, full):
                continue
            files.append(full)
    return files


def dotted_module(root: Path, file_path: Path) -> str:
    rel = rel_path(root, file_path)
    if rel.endswith(".py"):
        rel = rel[:-3]
    parts = rel.split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(part for part in parts if part)


def node_text_line(source_lines: list[str], lineno: int) -> str:
    if lineno <= 0 or lineno > len(source_lines):
        return ""
    return source_lines[lineno - 1].strip()[:240]


def attr_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = attr_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return attr_name(node.func)
    if isinstance(node, ast.Subscript):
        return attr_name(node.value)
    return None


@dataclass
class Scope:
    key: str
    qualified_name: str
    name: str
    kind: str
    file: str
    line: int
    col: int


class FileVisitor(ast.NodeVisitor):
    def __init__(self, root: Path, file_path: Path, source: str) -> None:
        self.root = root
        self.file_path = file_path
        self.file_rel = rel_path(root, file_path)
        self.module = dotted_module(root, file_path)
        self.source_lines = source.splitlines()
        self.definitions: list[dict[str, Any]] = []
        self.imports: list[dict[str, Any]] = []
        self.calls: list[dict[str, Any]] = []
        self.scope_stack: list[Scope] = []
        self.class_stack: list[str] = []
        self.aliases: dict[str, str] = {}

    def current_scope(self) -> Scope | None:
        return self.scope_stack[-1] if self.scope_stack else None

    def make_key(self, qualified_name: str, node: ast.AST) -> str:
        return f"{self.file_rel}:{getattr(node, 'lineno', 0)}:{getattr(node, 'col_offset', 0)}:{qualified_name}"

    def qualified_name_for(self, name: str) -> str:
        prefixes = [scope.name for scope in self.scope_stack]
        prefixes.append(name)
        local = ".".join(prefixes)
        return f"{self.module}.{local}" if self.module else local

    def add_definition(self, node: ast.AST, name: str, kind: str) -> Scope:
        qualified_name = self.qualified_name_for(name)
        key = self.make_key(qualified_name, node)
        decorators = []
        for deco in getattr(node, "decorator_list", []):
            value = attr_name(deco)
            if value:
                decorators.append(value)
        scope = Scope(
            key=key,
            qualified_name=qualified_name,
            name=name,
            kind=kind,
            file=self.file_rel,
            line=getattr(node, "lineno", 0),
            col=getattr(node, "col_offset", 0) + 1,
        )
        self.definitions.append(
            {
                "key": key,
                "qualifiedName": qualified_name,
                "name": name,
                "kind": kind,
                "file": self.file_rel,
                "line": scope.line,
                "column": scope.col,
                "endLine": getattr(node, "end_lineno", scope.line),
                "exported": not name.startswith("_"),
                "decorators": decorators,
                "text": node_text_line(self.source_lines, scope.line),
            }
        )
        return scope

    def add_import(self, node: ast.AST, module: str, name: str | None, alias: str | None, imported_as: str) -> None:
        self.imports.append(
            {
                "file": self.file_rel,
                "line": getattr(node, "lineno", 0),
                "column": getattr(node, "col_offset", 0) + 1,
                "module": module,
                "name": name,
                "alias": alias,
                "as": imported_as,
                "text": node_text_line(self.source_lines, getattr(node, "lineno", 0)),
            }
        )
        self.aliases[imported_as] = f"{module}.{name}" if name else module

    def visit_Import(self, node: ast.Import) -> Any:
        for alias in node.names:
            imported_as = alias.asname or alias.name.split(".")[0]
            self.add_import(node, alias.name, None, alias.asname, imported_as)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> Any:
        dots = "." * int(node.level or 0)
        module = f"{dots}{node.module or ''}"
        for alias in node.names:
            imported_as = alias.asname or alias.name
            self.add_import(node, module, alias.name, alias.asname, imported_as)

    def visit_ClassDef(self, node: ast.ClassDef) -> Any:
        scope = self.add_definition(node, node.name, "class")
        self.class_stack.append(node.name)
        self.scope_stack.append(scope)
        for stmt in node.body:
            self.visit(stmt)
        self.scope_stack.pop()
        self.class_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> Any:
        self._visit_function(node, "function")

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> Any:
        self._visit_function(node, "async_function")

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef, kind: str) -> None:
        if self.class_stack and self.scope_stack and self.scope_stack[-1].kind == "class":
            kind = "async_method" if kind == "async_function" else "method"
        scope = self.add_definition(node, node.name, kind)
        self.scope_stack.append(scope)
        for default in list(node.args.defaults) + list(node.args.kw_defaults):
            if default is not None:
                self.visit(default)
        for deco in node.decorator_list:
            self.visit(deco)
        for stmt in node.body:
            self.visit(stmt)
        self.scope_stack.pop()

    def visit_Call(self, node: ast.Call) -> Any:
        caller = self.current_scope()
        callee = attr_name(node.func) or "<dynamic>"
        base = callee.split(".")[0] if callee else callee
        resolved_alias = self.aliases.get(base or "")
        if resolved_alias and base:
            suffix = callee[len(base):]
            qualified_callee = f"{resolved_alias}{suffix}"
        else:
            qualified_callee = callee
        self.calls.append(
            {
                "file": self.file_rel,
                "line": getattr(node, "lineno", 0),
                "column": getattr(node, "col_offset", 0) + 1,
                "callerKey": caller.key if caller else None,
                "callerQualifiedName": caller.qualified_name if caller else None,
                "callee": callee,
                "qualifiedCallee": qualified_callee,
                "text": node_text_line(self.source_lines, getattr(node, "lineno", 0)),
            }
        )
        self.generic_visit(node)


def parse_file(root: Path, file_path: Path) -> dict[str, Any]:
    try:
        source = file_path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        source = file_path.read_text(encoding="utf-8", errors="replace")
    tree = ast.parse(source, filename=str(file_path))
    visitor = FileVisitor(root, file_path, source)
    visitor.visit(tree)
    return {
        "file": rel_path(root, file_path),
        "module": dotted_module(root, file_path),
        "definitions": visitor.definitions,
        "imports": visitor.imports,
        "calls": visitor.calls,
        "errors": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="bridge-mcp Python AST helper")
    parser.add_argument("--root", required=True)
    parser.add_argument("--file-pattern", default="*.py")
    parser.add_argument("--include-tests", action="store_true")
    parser.add_argument("--max-files", type=int, default=500)
    parser.add_argument("--output")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists() or not root.is_dir():
        print(json.dumps({"ok": False, "error": f"root is not a directory: {root}"}))
        return 2

    max_files = max(1, min(2000, int(args.max_files)))
    files = iter_python_files(root, args.file_pattern, args.include_tests, max_files)
    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for file_path in files:
        try:
            results.append(parse_file(root, file_path))
        except SyntaxError as exc:
            errors.append(
                {
                    "file": rel_path(root, file_path),
                    "line": exc.lineno or 0,
                    "column": exc.offset or 0,
                    "message": exc.msg,
                }
            )
        except Exception as exc:  # helper must not crash caller project scan
            errors.append({"file": rel_path(root, file_path), "line": 0, "column": 0, "message": str(exc)})

    payload = {
        "ok": True,
        "root": str(root),
        "scannedFiles": len(files),
        "truncated": len(files) >= max_files,
        "files": results,
        "errors": errors,
    }
    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"ok": True, "output": str(output_path), "scannedFiles": len(files), "errors": len(errors)}))
    else:
        print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
