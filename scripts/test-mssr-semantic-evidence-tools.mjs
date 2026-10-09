import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APIConnectionError, APIError, APIUserAbortError, APITimeoutError, TypeSafeError } from "@typesafe-ai/sdk";
import {
  buildMssrEvidenceAtom,
  buildMssrMarkdownDocumentSurface,
  mssrJevDecisionRequestSchema,
} from "@mauroprime/mssr";
import { createToolRegistry } from "../dist/tool-registry.js";
import {
  createMssrJevBridgeDecisionProvider,
  createMssrSemanticEvidenceToolModule,
} from "../dist/tools/mssr-semantic-evidence-tools.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mssr-semantic-evidence-"));
const policyMarkdown = [
  "# Project evidence",
  "",
  "## Preserve operational records",
  "Keep benchmark results with their source revisions and provenance so results remain auditable. Add enough operational detail that the exact-source fetch remains necessary for complete reading and verification. This long continuation is deliberately longer than the selector excerpt budget and must not be sent to Jev. TAIL-ONLY-MUST-NOT-BE-SENT",
  "",
  "## Review retention windows",
  "Classify cache and runtime snapshots by owner and retention window before cleanup.",
  "",
].join("\n");

try {
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.mkdir(path.join(root, ".mssr"), { recursive: true });
  await fs.writeFile(path.join(root, ".mssr", "project-context.json"), JSON.stringify({
    schemaVersion: 1,
    core: [],
    modules: [
      {
        id: "policy-preserve-records",
        kind: "context",
        description: "Owner-declared routing selectors for one exact policy heading.",
        source: { path: "policy.md", sections: ["## Preserve operational records"] },
        domains: ["godot"],
        actions: ["review"],
        artifacts: ["repository"],
        needs: ["version-control"],
        signals: ["tool-chain-needed"],
      },
      {
        id: "policy-multiple-sections",
        kind: "memory",
        description: "A whole-module selector with more than one source heading.",
        source: { path: "policy.md", sections: ["## Preserve operational records", "## Review retention windows"] },
        domains: ["filesystem"],
      },
      {
        id: "policy-whole-file",
        kind: "memory",
        description: "A whole-file selector has no exact heading scope.",
        source: { path: "policy.md" },
        domains: ["browser"],
      },
      {
        id: "policy-missing-heading",
        kind: "context",
        description: "A missing heading cannot be bound to source bytes.",
        source: { path: "policy.md", sections: ["## Missing heading"] },
        domains: ["roblox"],
      },
      {
        id: "policy-directive",
        kind: "directive",
        description: "Conditional procedure is not indexed as evidence.",
        source: { path: "policy.md", sections: ["## Preserve operational records"] },
        domains: ["browser"],
      },
    ],
  }));
  await fs.writeFile(path.join(root, "policy.md"), policyMarkdown, "utf8");
  await fs.writeFile(path.join(root, "other-policy.md"), "## Unrelated source\nThis file does not contain the selected search handle.\n", "utf8");
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  await fs.writeFile(path.join(root, "data", "should-not-read.md"), "private runtime data", "utf8");
  await fs.mkdir(path.join(root, ".mssr", "runtime"), { recursive: true });
  await fs.writeFile(path.join(root, ".mssr", "runtime", "receipt.md"), "ephemeral runtime receipt", "utf8");
  const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(path.join(root, "data"), path.join(root, "docs", "data-alias"), directoryLinkType);
  await fs.symlink(path.join(root, ".mssr", "runtime"), path.join(root, "docs", "runtime-alias"), directoryLinkType);

  const projectSurface = buildMssrMarkdownDocumentSurface({ sourceRef: "policy.md", markdown: policyMarkdown });
  const preserveHeading = projectSurface.headings.find((heading) => heading.title === "Preserve operational records");
  assert.ok(preserveHeading, "fixture heading should be present for the exact sidecar binding");
  const sidecarEntry = {
    entryId: "policy-preserve-records",
    sourcePath: "policy.md",
    headingPath: preserveHeading.headingPath,
    expectedFingerprint: preserveHeading.fingerprint,
    selectors: {
      domains: ["godot"],
      actions: ["review"],
      artifacts: ["repository"],
      needs: ["version-control"],
      signals: ["tool-chain-needed"],
    },
  };
  const sidecarPath = path.join(root, ".mssr", "project-context-librarian.json");
  await fs.writeFile(sidecarPath, JSON.stringify({ schemaVersion: 1, entries: [sidecarEntry] }), "utf8");

  const providerCalls = [];
  const decisionProvider = {
    async executeSystemOne(request) {
      providerCalls.push(request);
      const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
        if (question.kind === "noul") return [key, { type: "noul", noul: 0.97 }];
        if (key === "selection") {
          const selectedOption = request.state.query.includes("absent-case")
            ? "none"
            : request.state.evidence.find((candidate) => {
              try {
                const evidence = JSON.parse(candidate.text);
                return Array.isArray(evidence) && evidence[2]?.at(-1) === "Preserve operational records";
              } catch {
                return false;
              }
            })?.id ?? (request.state.stage === "local-shortlist" ? Object.keys(question.options)[0] : "none");
          const probabilities = Object.fromEntries(Object.keys(question.options).map((option) => [option, option === selectedOption ? 0.97 : 0.03 / (Object.keys(question.options).length - 1)]));
          return [key, { type: "choice", choice: selectedOption, confidence: 0.97, probabilities }];
        }
        return [key, { type: "choice", choice: "supports", confidence: 0.97 }];
      }));
      return { provider: "test-provider", model: "test-model", answers, usage: { input_tokens: 12, output_tokens: 3 } };
    },
  };
  const registry = createToolRegistry([createMssrSemanticEvidenceToolModule({ decisionProvider })]);
  const selected = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "preserve operational records", maxResults: 10 },
  });
  assert.equal(selected.advisoryOnly, true);
  assert.equal(selected.sourceCount, 1);
  assert.equal(selected.metadataIndex, undefined, "metadata-assisted search remains opt-in");
  assert.ok(selected.results.length >= 1);
  const preserveHandle = (selected.results.find((item) => item.handle.rangeKind === "block") ?? selected.results[0]).handle;

  const exact = await registry.call("mssr_librarian_fetch", { projectRoot: root, handle: preserveHandle });
  assert.equal(exact.advisoryOnly, true);
  assert.match(exact.text, /Keep benchmark results/);

  const retentionSearch = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "retention windows", maxResults: 10 },
  });
  const retentionHandle = retentionSearch.results[0]?.handle;
  assert.ok(retentionHandle, "search should return a second exact range for evidence packing");
  const providerCallsBeforePack = providerCalls.length;
  const evidencePack = await registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    handles: [preserveHandle, retentionHandle],
  });
  assert.equal(providerCalls.length, providerCallsBeforePack, "evidence packing must not call Jev");
  assert.equal(evidencePack.kind, "mssr-librarian-evidence-pack");
  assert.equal(evidencePack.assembly, "verbatim-source-ranges");
  assert.equal(evidencePack.paragraphs.length, 2);
  assert.match(evidencePack.paragraphs[0].exactText, /Keep benchmark results/);
  assert.match(evidencePack.paragraphs[1].exactText, /Classify cache and runtime snapshots/);
  assert.equal(evidencePack.paragraphs[0].citation.handleId, preserveHandle.id);
  assert.equal(evidencePack.paragraphs[1].citation.fingerprint, retentionHandle.fingerprint);
  assert.equal(evidencePack.advisoryOnly, true);
  assert.equal(evidencePack.truthAuthority, false);
  assert.equal(evidencePack.canonicalRewriteAllowed, false);
  assert.equal(evidencePack.ownerAndPrivacyAreCallerAsserted, true);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md", "other-policy.md"],
    handles: [preserveHandle],
  }), /exactly match the unique sources referenced by handles/);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["other-policy.md"],
    handles: [preserveHandle],
  }), /explicitly supplied normalized sourceRefs/);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    handles: [preserveHandle, preserveHandle],
  }), /handles must be unique/);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    handles: [{ ...preserveHandle, privacyClass: "operational-metadata" }],
  }), /only project-metadata sources/);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    handles: [{ ...preserveHandle, fingerprint: "0".repeat(64) }],
  }), /id mismatch/i);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    handles: [preserveHandle],
    documents: [{ owner: root, sourceRef: "policy.md", markdown: "caller text", privacyClass: "project-metadata" }],
  }));

  const jevSelection = await registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "Where should benchmark records and provenance be kept?",
  });
  assert.equal(jevSelection.projectOwner, root.replace(/\\/g, "/").toLowerCase());
  assert.equal(jevSelection.sourceCount, 1);
  assert.equal(jevSelection.status, "selected");
  assert.equal(jevSelection.selected.title, "Preserve operational records");
  assert.equal(jevSelection.verification, "unverified");
  assert.equal(jevSelection.confidenceCalibration, "uncalibrated-provider-score");
  assert.equal(jevSelection.choiceCalls.length, 1);
  assert.deepEqual(Object.keys(jevSelection.choiceCalls[0].probabilities).sort(), jevSelection.choiceCalls[0].offeredOptionIds.slice().sort(), "tool output preserves the complete exact offered Choice distribution");
  assert.equal(jevSelection.choiceCalls[0].probabilities[jevSelection.choiceCalls[0].selectedOptionId], 0.97);
  assert.equal(jevSelection.choiceCalls[0].confidence, 0.97);
  assert.equal(jevSelection.exactFetchRequired, true);
  assert.ok(jevSelection.rangeOverlapDiagnostics, "Bridge must pass through MSSR range-overlap diagnostics");
  assert.ok(Number.isInteger(jevSelection.rangeOverlapDiagnostics.sameSourceRevisionPairs));
  assert.ok(Number.isInteger(jevSelection.rangeOverlapDiagnostics.overlappingPairCount));
  assert.ok(Array.isArray(jevSelection.rangeOverlapDiagnostics.pairs));
  assert.equal(jevSelection.rangeOverlapDiagnostics.mutationApplied, false, "range diagnostics must stay read-only");
  assert.equal(jevSelection.truthAuthority, false);
  assert.equal(jevSelection.autoApplyAllowed, false);
  const selectionRequest = providerCalls.at(-1);
  assert.equal(selectionRequest.state.query, "Where should benchmark records and provenance be kept?");
  assert.ok(Object.keys(selectionRequest.questions.selection.options).includes("none"));
  assert.ok(Object.values(selectionRequest.questions.selection.options).every((option) => option.length <= 1200));
  assert.equal(JSON.stringify(selectionRequest).includes("TAIL-ONLY-MUST-NOT-BE-SENT"), false, "Jev selection must receive only the bounded excerpt, not the whole source section");
  const maplessRegistry = createToolRegistry([createMssrSemanticEvidenceToolModule({ decisionProvider: {
    async executeSystemOne(request) {
      const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
        if (question.kind === "noul") return [key, { type: "noul", noul: 0.97 }];
        const selectedOption = Object.entries(question.options).find(([, option]) => option.includes("Keep benchmark results"))?.[0] ?? "none";
        return [key, { type: "choice", choice: selectedOption, confidence: 0.97 }];
      }));
      return { provider: "mapless-test-provider", model: "mapless-test-model", answers, usage: { input_tokens: 12, output_tokens: 3 } };
    },
  } } )]);
  const maplessSelection = await maplessRegistry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "Where should benchmark records and provenance be kept?",
  });
  assert.equal(maplessSelection.choiceCalls.length, 1);
  assert.equal(maplessSelection.choiceCalls[0].probabilities, null, "a missing provider distribution remains explicitly absent");
  const manyHeadings = ["# Hierarchical choice fixture", ""];
  for (let index = 1; index <= 260; index += 1) {
    const title = index === 260 ? "Preserve operational records" : `Section ${String(index).padStart(3, "0")}`;
    manyHeadings.push(`## ${title}`, "", `Candidate ${index} contains bounded evidence for hierarchical option preservation. ${index === 260 ? "UNIQUE_HIERARCHICAL_TARGET" : ""}`, "");
  }
  await fs.writeFile(path.join(root, "hierarchical-choice.md"), manyHeadings.join("\n"), "utf8");
  const providerCallsBeforeHierarchy = providerCalls.length;
  const hierarchicalSelection = await registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["hierarchical-choice.md"],
    query: "Find the target evidence in the hierarchical catalog.",
  });
  assert.equal(hierarchicalSelection.status, "selected");
  assert.equal(hierarchicalSelection.selectionMode, "hierarchical");
  assert.equal(hierarchicalSelection.providerCalls, 3);
  assert.equal(providerCalls.length - providerCallsBeforeHierarchy, hierarchicalSelection.providerCalls);
  assert.equal(hierarchicalSelection.choiceCalls.length, hierarchicalSelection.providerCalls, "the MCP result preserves every shard and final Choice call");
  assert.ok(hierarchicalSelection.rangeOverlapDiagnostics, "hierarchical results retain range-overlap diagnostics");
  assert.ok(hierarchicalSelection.choiceCalls.every((call) => call.probabilities && Object.keys(call.probabilities).sort().join("\0") === call.offeredOptionIds.slice().sort().join("\0")), "each hierarchical call preserves the exact complete option distribution");
  assert.equal(hierarchicalSelection.selected.title, "Preserve operational records");
  const jevExact = await registry.call("mssr_librarian_fetch", { projectRoot: root, handle: jevSelection.selected.handle });
  assert.equal(jevExact.handle.fingerprint, jevSelection.selected.handle.fingerprint);
  assert.match(jevExact.text, /Keep benchmark results/);

  const metadataOff = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
  });
  assert.equal(metadataOff.results.length, 0, "manifest selectors do not affect default lexical-only search");
  const metadataSearch = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
    metadataMode: "project-context-single-section",
  });
  assert.equal(metadataSearch.metadataIndex.status, "applied");
  assert.equal(metadataSearch.metadataIndex.manifestRevision.length, 64);
  assert.equal(metadataSearch.metadataIndex.moduleCount, 1, "only the exact one-heading context module is projected");
  assert.equal(metadataSearch.metadataIndex.rangeCount, 1);
  assert.equal(metadataSearch.metadataIndex.atomCount, 5);
  assert.equal(metadataSearch.metadataIndex.advisoryOnly, true);
  assert.equal(metadataSearch.metadataIndex.truthAuthority, false);
  assert.equal(metadataSearch.metadataIndex.canonicalRewriteAllowed, false);
  assert.equal(metadataSearch.metadataIndex.skipped.nonSingleSection, 2);
  assert.equal(metadataSearch.metadataIndex.skipped.ambiguousOrMissingSection, 1);
  assert.equal(metadataSearch.metadataIndex.skipped.unsupportedKind, 1);
  assert.equal(metadataSearch.results.length, 1);
  assert.equal(metadataSearch.results[0].title, "Preserve operational records");
  assert.ok(metadataSearch.results[0].metadataProjectionMatches.some((match) => match.producer === "project-context-manifest"
    && match.provenanceIsCallerAsserted === true
    && match.matches.some((entry) => entry.field === "domain" && entry.value === "godot")));
  assert.ok(metadataSearch.results[0].projectContextMetadataBindings.some((binding) => binding.moduleId === "policy-preserve-records"
    && binding.selectorField === "domain" && binding.selectorValue === "godot"));
  assert.equal(metadataSearch.results[0].handle.rangeKind, "section");
  assert.match((await registry.call("mssr_librarian_fetch", { projectRoot: root, handle: metadataSearch.results[0].handle })).text, /Keep benchmark results/);

  const metadataFiltered = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "benchmark", metadata: { domain: "godot" }, maxResults: 10 },
    metadataMode: "project-context-single-section",
  });
  assert.equal(metadataFiltered.results.length, 1, "manifest metadata filters the exact bound heading");
  const rejectedMultiSectionTag = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "filesystem", maxResults: 10 },
    metadataMode: "project-context-single-section",
  });
  assert.equal(rejectedMultiSectionTag.results.length, 0, "selectors from multi-section modules are not spread across headings");

  const sidecarSearch = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
    metadataMode: "project-context-librarian-sidecar",
  });
  assert.equal(sidecarSearch.metadataIndex.mode, "project-context-librarian-sidecar");
  assert.equal(sidecarSearch.metadataIndex.status, "applied");
  assert.equal(sidecarSearch.metadataIndex.declared, 1);
  assert.equal(sidecarSearch.metadataIndex.projected, 1);
  assert.equal(sidecarSearch.metadataIndex.omitted, 0);
  assert.equal(sidecarSearch.metadataIndex.projectContextManifestRevision.length, 64);
  assert.equal(sidecarSearch.metadataIndex.librarianManifestRevision.length, 64);
  assert.equal(sidecarSearch.metadataIndex.segmentsManifestRevision, null, "an absent optional segments manifest is observed and passed as null");
  assert.equal(sidecarSearch.metadataIndex.referencesManifestRevision, null, "an absent optional references manifest is observed and passed as null");
  assert.equal(sidecarSearch.metadataIndex.advisoryOnly, true);
  assert.equal(sidecarSearch.metadataIndex.truthAuthority, false);
  assert.equal(sidecarSearch.metadataIndex.canonicalRewriteAllowed, false);
  assert.equal(sidecarSearch.results.length, 1);
  assert.equal(sidecarSearch.results[0].title, "Preserve operational records");
  assert.ok(sidecarSearch.results[0].metadataProjectionMatches.some((match) => match.producer === "project-context-librarian"
    && match.provenanceIsCallerAsserted === true
    && match.matches.some((entry) => entry.field === "domain" && entry.value === "godot")));
  assert.ok(sidecarSearch.results[0].projectContextLibrarianBindings.some((binding) => binding.entryId === "policy-preserve-records"
    && binding.sourceRef === "policy.md" && binding.headingPath.at(-1) === "Preserve operational records"));
  assert.equal(sidecarSearch.results[0].handle.rangeKind, "section");
  assert.match((await registry.call("mssr_librarian_fetch", { projectRoot: root, handle: sidecarSearch.results[0].handle })).text, /Keep benchmark results/);

  const secondModule = {
    id: "policy-other-file",
    kind: "memory",
    description: "A selector that is deliberately bound to an unselected source.",
    source: { path: "other-policy.md", sections: ["## Unrelated source"] },
    domains: ["browser"],
  };
  const projectContextPath = path.join(root, ".mssr", "project-context.json");
  const originalProjectContext = JSON.parse(await fs.readFile(projectContextPath, "utf8"));
  const otherSurface = buildMssrMarkdownDocumentSurface({ sourceRef: "other-policy.md", markdown: await fs.readFile(path.join(root, "other-policy.md"), "utf8") });
  const otherHeading = otherSurface.headings.find((heading) => heading.title === "Unrelated source");
  assert.ok(otherHeading);
  await fs.writeFile(projectContextPath, JSON.stringify({ ...originalProjectContext, modules: [...originalProjectContext.modules, secondModule] }), "utf8");
  await fs.writeFile(sidecarPath, JSON.stringify({ schemaVersion: 1, entries: [sidecarEntry, {
    ...sidecarEntry,
    entryId: secondModule.id,
    sourcePath: "other-policy.md",
    headingPath: otherHeading.headingPath,
    expectedFingerprint: otherHeading.fingerprint,
    selectors: { domains: ["browser"], actions: [], artifacts: [], needs: [], signals: [] },
  }] }), "utf8");
  const unselectedSource = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "browser", maxResults: 10 },
    metadataMode: "project-context-librarian-sidecar",
  });
  assert.equal(unselectedSource.results.length, 0, "sidecar entries cannot tag Markdown files outside explicit sourceRefs");
  assert.equal(unselectedSource.metadataIndex.omitted, 1);
  assert.equal(unselectedSource.metadataIndex.items.find((item) => item.entryId === secondModule.id)?.issue, "source-not-provided");
  await fs.writeFile(projectContextPath, JSON.stringify(originalProjectContext), "utf8");
  await fs.writeFile(sidecarPath, JSON.stringify({ schemaVersion: 1, entries: [sidecarEntry] }), "utf8");

  const staleSidecarEntry = { ...sidecarEntry, expectedFingerprint: "0".repeat(64) };
  await fs.writeFile(sidecarPath, JSON.stringify({ schemaVersion: 1, entries: [staleSidecarEntry] }), "utf8");
  const staleSidecar = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
    metadataMode: "project-context-librarian-sidecar",
  });
  assert.equal(staleSidecar.metadataIndex.status, "no-projectable-declarations");
  assert.equal(staleSidecar.metadataIndex.omitted, 1);
  assert.equal(staleSidecar.metadataIndex.items[0].issue, "stale-fingerprint");
  assert.equal(staleSidecar.results.length, 0, "stale declarations are discarded instead of widening retrieval");
  await fs.writeFile(sidecarPath, JSON.stringify({ schemaVersion: 1, entries: [sidecarEntry] }), "utf8");

  const sidecarTemporarilyMissing = `${sidecarPath}.missing-test`;
  await fs.rename(sidecarPath, sidecarTemporarilyMissing);
  try {
    const missingSidecar = await registry.call("mssr_librarian_search", {
      projectRoot: root,
      sourceRefs: ["policy.md"],
      query: { query: "godot", maxResults: 10 },
      metadataMode: "project-context-librarian-sidecar",
    });
    assert.equal(missingSidecar.metadataIndex.status, "sidecar-missing");
    assert.equal(missingSidecar.results.length, 0, "missing declarations preserve lexical-only search");
  } finally {
    await fs.rename(sidecarTemporarilyMissing, sidecarPath);
  }

  const sidecarBackupPath = `${sidecarPath}.safe-backup`;
  const externalSidecarPath = `${sidecarPath}.outside-project`;
  await fs.rename(sidecarPath, sidecarBackupPath);
  await fs.writeFile(externalSidecarPath, JSON.stringify({ schemaVersion: 1, entries: [sidecarEntry] }), "utf8");
  let sidecarSymlinkCreated = false;
  try {
    await fs.symlink(externalSidecarPath, sidecarPath, "file");
    sidecarSymlinkCreated = true;
  } catch (error) {
    assert.ok(["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error?.code), `unexpected symlink setup failure: ${error?.code}`);
  }
  try {
    if (sidecarSymlinkCreated) {
      await assert.rejects(registry.call("mssr_librarian_search", {
        projectRoot: root,
        sourceRefs: ["policy.md"],
        query: { query: "godot", maxResults: 10 },
        metadataMode: "project-context-librarian-sidecar",
      }), /outside the project-control directory/, "the sidecar cannot redirect reads outside the canonical .mssr home");
    }
  } finally {
    if (sidecarSymlinkCreated) await fs.rm(sidecarPath, { force: true });
    await fs.rename(sidecarBackupPath, sidecarPath);
    await fs.rm(externalSidecarPath, { force: true });
  }

  await fs.writeFile(sidecarPath, Buffer.alloc(2_000_001, 0x20));
  await assert.rejects(registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
    metadataMode: "project-context-librarian-sidecar",
  }), /exceeds 2000000 bytes/, "oversized sidecars are rejected before JSON parsing");
  await fs.writeFile(sidecarPath, JSON.stringify({ schemaVersion: 1, entries: [sidecarEntry] }), "utf8");

  const segmentsPath = path.join(root, ".mssr", "project-context-segments.json");
  await fs.writeFile(segmentsPath, JSON.stringify({ schemaVersion: 1, modules: [{
    moduleId: "policy-preserve-records",
    segments: [
      { id: "baseline", sections: ["## Preserve operational records"], baseline: true },
      { id: "retention", sections: ["## Review retention windows"], terms: ["retention"] },
    ],
  }] }), "utf8");
  const indirectSidecar = await registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
    metadataMode: "project-context-librarian-sidecar",
  });
  assert.equal(indirectSidecar.metadataIndex.status, "no-projectable-declarations");
  assert.equal(indirectSidecar.metadataIndex.items[0].issue, "indirect-source", "segmented modules are excluded from overlapping sidecar projection");
  await fs.rm(segmentsPath, { force: true });

  const referencesPath = path.join(root, ".mssr", "project-context-refs.json");
  await fs.writeFile(referencesPath, "{not-json", "utf8");
  await assert.rejects(registry.call("mssr_librarian_search", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: { query: "godot", maxResults: 10 },
    metadataMode: "project-context-librarian-sidecar",
  }), /invalid JSON/, "invalid optional project-control JSON fails closed instead of silently dropping policy");
  await fs.rm(referencesPath, { force: true });

  const blockSelection = await registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "Which exact policy preserves benchmark records with their source revision and provenance?",
    candidateHandles: [preserveHandle],
  });
  assert.equal(blockSelection.status, "selected");
  assert.equal(blockSelection.selected.handle.rangeKind, preserveHandle.rangeKind);
  assert.deepEqual(blockSelection.selected.handle, preserveHandle, "Jev selection must preserve the exact Librarian search handle");
  assert.equal(blockSelection.candidateCount, 1);
  assert.equal(JSON.stringify(providerCalls.at(-1)).includes("TAIL-ONLY-MUST-NOT-BE-SENT"), false);
  const providerCallsBeforeInvalidHandle = providerCalls.length;
  await assert.rejects(
    registry.call("mssr_librarian_jev_select", {
      projectRoot: root,
      sourceRefs: ["other-policy.md"],
      query: "select a result from an unselected source",
      candidateHandles: [preserveHandle],
    }),
    /explicitly supplied document owned by the same caller/,
  );
  assert.equal(providerCalls.length, providerCallsBeforeInvalidHandle, "a handle outside the selected sourceRefs must be rejected before calling Jev");

  const jevFromMetadataSearch = await registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "Select the exact policy about preserving benchmark records that matched the Godot domain selector.",
    candidateHandles: metadataSearch.results.map((result) => result.handle),
  });
  assert.equal(jevFromMetadataSearch.status, "selected", "Jev can select from exact handles returned by metadata-assisted search");
  assert.equal(jevFromMetadataSearch.selected.title, "Preserve operational records");
  assert.equal(jevFromMetadataSearch.verification, "unverified");
  assert.equal(jevFromMetadataSearch.truthAuthority, false);
  assert.deepEqual(jevFromMetadataSearch.selected.handle, metadataSearch.results[0].handle);

  const abstained = await registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "absent-case: which heading contains an unrelated absent policy?",
  });
  assert.equal(abstained.status, "abstained");
  assert.equal(abstained.selected, null);
  assert.equal(abstained.jevCallMade, true);

  await assert.rejects(
    registry.call("mssr_librarian_jev_select", { projectRoot: root, sourceRefs: ["data/should-not-read.md"], query: "private runtime" }),
    /approved project-document scope/,
  );

  await assert.rejects(
    registry.call("mssr_librarian_search", { projectRoot: root, sourceRefs: ["data/should-not-read.md"], query: { query: "private runtime" } }),
    /approved project-document scope/,
  );
  await assert.rejects(
    registry.call("mssr_librarian_search", { projectRoot: root, sourceRefs: ["..\\outside.md"], query: { query: "outside" } }),
    /clean project-relative Markdown path/,
  );
  await assert.rejects(
    registry.call("mssr_librarian_search", { projectRoot: root, sourceRefs: ["policy.md:private-stream"], query: { query: "private stream" } }),
    /clean project-relative Markdown path/,
    "source refs must not address Windows Alternate Data Streams",
  );
  await assert.rejects(
    registry.call("mssr_librarian_search", { projectRoot: root, sourceRefs: [".mssr/runtime/receipt.md"], query: { query: "runtime receipt" } }),
    /approved project-document scope/,
  );
  await assert.rejects(
    registry.call("mssr_librarian_search", { projectRoot: root, sourceRefs: ["docs/data-alias/should-not-read.md"], query: { query: "private runtime" } }),
    /approved project-document scope/,
    "an internal junction must not expose a denied data/ target",
  );
  await assert.rejects(
    registry.call("mssr_librarian_search", { projectRoot: root, sourceRefs: ["docs/runtime-alias/receipt.md"], query: { query: "runtime receipt" } }),
    /approved project-document scope/,
    "an internal junction must not expose .mssr/runtime/",
  );

  const currentMarkdown = await fs.readFile(path.join(root, "policy.md"), "utf8");
  const preservation = await registry.call("mssr_librarian_search", {
    projectRoot: root, sourceRefs: ["policy.md"], query: { query: "preserve operational records" },
  });
  const retention = await registry.call("mssr_librarian_search", {
    projectRoot: root, sourceRefs: ["policy.md"], query: { query: "review retention windows" },
  });
  const handleA = (preservation.results.find((item) => item.handle.rangeKind === "block") ?? preservation.results[0]).handle;
  const handleB = (retention.results.find((item) => item.handle.rangeKind === "block") ?? retention.results[0]).handle;
  const makeAtom = (handle, identity) => buildMssrEvidenceAtom({
    subject: { namespace: "bridge-test", kind: "policy-claim", identity },
    source: {
      ref: handle.sourceRef,
      revision: handle.revision,
      freshness: "unknown",
      headingPath: [identity],
      range: { startLine: handle.startLine, endLine: handle.endLine, startOffset: handle.startOffset, endOffset: handle.endOffset },
    },
    provenance: { producer: "bridge-test", sourceClass: "observed", canonicalOwner: handle.owner, projectKey: "bridge-test-project" },
    fingerprints: { record: "a".repeat(64), payload: handle.fingerprint },
    reasonCodes: [],
    lineage: { parentAtomIds: [], relatedAtomIds: [], supersedesAtomIds: [] },
    dedupeKey: `${handle.sourceRef}:${handle.rangeId}`,
    authorityClass: "observed",
    privacyClass: handle.privacyClass,
    usage: { selection: "unknown", consumed: false, outcome: "unknown", reasonCodes: [] },
    attributes: {},
  });
  const atomA = makeAtom(handleA, "preserve operational records");
  const atomB = makeAtom(handleB, "review retention windows");
  const time = "2026-01-01T00:00:00.000Z";
  const reviewInput = {
    projectKey: "bridge-test-project",
    corpusKey: "bridge-test-corpus",
    goal: "Review whether these project policy claims can be used together.",
    inputAtoms: [atomA, atomB],
    sourceEvidence: [
      { atomId: atomA.id, handle: handleA, text: "caller supplied text must be ignored" },
      { atomId: atomB.id, handle: handleB, text: "caller supplied text must be ignored" },
    ],
    pairs: [{
      id: "policy-pair-1",
      leftAtomId: atomA.id,
      rightAtomId: atomB.id,
      claim: { validity: "current", scope: "project retention policy", validFrom: time, validUntil: null },
      comparability: {
        scope: { left: "project retention policy", right: "project retention policy" },
        temporal: { leftValidity: "current", leftValidFrom: time, leftValidUntil: null, rightValidity: "current", rightValidFrom: time, rightValidUntil: null },
      },
    }],
    traceId: "bridge-test-je v-01".replace(" ", ""),
  };
  mssrJevDecisionRequestSchema.parse({ state: { test: true }, questions: { q: { kind: "noul", prompt: "test" } } });
  const providerCallsBeforeRelationReview = providerCalls.length;
  const reviewed = await registry.call("mssr_semantic_evidence_relation_review", { projectRoot: root, input: reviewInput });
  assert.equal(providerCalls.length, providerCallsBeforeRelationReview + 1, "one relation review adds exactly one provider call after the selection workflow");
  assert.match(JSON.stringify(providerCalls.at(-1).state), /Keep benchmark results/);
  assert.doesNotMatch(JSON.stringify(providerCalls.at(-1).state), /caller supplied text must be ignored/);
  assert.equal(reviewed.policy.judgmentsVerified, false);
  assert.equal(reviewed.policy.advisoryOnly, true);

  const preview = await registry.call("mssr_semantic_evidence_synthesis_preview", {
    projectRoot: root,
    input: {
      judgment: reviewed.judgments[0].judgment,
      inputAtoms: [atomA, atomB],
      sourceEvidence: reviewInput.sourceEvidence,
    },
  });
  assert.equal(preview.advisoryOnly, true);
  assert.equal(preview.applyAllowed, false);
  assert.equal(preview.canonicalRewriteAllowed, false);
  assert.equal(await fs.readFile(path.join(root, "policy.md"), "utf8"), currentMarkdown);

  await fs.writeFile(path.join(root, "policy.md"), `${policyMarkdown}\n## New revision\nChanged.\n`, "utf8");
  await assert.rejects(registry.call("mssr_librarian_fetch", { projectRoot: root, handle: preserveHandle }), /stale/);
  await assert.rejects(registry.call("mssr_librarian_evidence_pack", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    handles: [preserveHandle],
  }), /stale/);
  const providerCallsBeforeStaleSelection = providerCalls.length;
  await assert.rejects(registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "select a stale search result",
    candidateHandles: [preserveHandle],
  }), /stale/);
  assert.equal(providerCalls.length, providerCallsBeforeStaleSelection, "a stale search handle must be rejected before calling Jev");

  const credentialBytes = Buffer.from("test-only-credential", "utf16le");
  let suppliedApiKey;
  const provider = createMssrJevBridgeDecisionProvider({
    readCredentialBytes: async () => credentialBytes,
    executeSystemOne: async (apiKey, request) => {
      suppliedApiKey = apiKey;
      return {
        provider: "test-provider", model: request.model ?? "test-model",
        answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, { type: "noul", noul: 0.1 }])),
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  });
  await provider.executeSystemOne({ state: {}, questions: { q: { kind: "noul", prompt: "test" } } });
  assert.equal(suppliedApiKey, "test-only-credential");
  assert.ok(credentialBytes.every((byte) => byte === 0), "credential bytes must be cleared after the call");

  const providerErrorSecret = "synthetic-secret-error-body-must-not-escape";
  const safeErrorCases = [
    { error: new APITimeoutError(30_000, { cause: new Error(providerErrorSecret) }), message: "Jev provider request timed out; no decision was produced." },
    { error: new APIConnectionError(providerErrorSecret), message: "Jev provider connection or response delivery failed; no decision was produced." },
    { error: new APIUserAbortError(providerErrorSecret), message: "Jev provider request was cancelled; no decision was produced." },
    { error: new APIError(401, { error: providerErrorSecret }, new Headers(), providerErrorSecret), message: "Jev provider request failed (HTTP 401); response content was suppressed." },
    { error: new TypeSafeError(providerErrorSecret), message: "Jev SDK rejected its request configuration; raw details were suppressed." },
    { error: new Error(providerErrorSecret), message: "Jev provider request failed without a classified response; raw details were suppressed." },
  ];
  for (const [index, testCase] of safeErrorCases.entries()) {
    const failedCredentialBytes = Buffer.from(`test-only-failure-credential-${index}`, "utf16le");
    const failedProvider = createMssrJevBridgeDecisionProvider({
      readCredentialBytes: async () => failedCredentialBytes,
      executeSystemOne: async () => { throw testCase.error; },
    });
    await assert.rejects(
      failedProvider.executeSystemOne({ state: {}, questions: { q: { kind: "noul", prompt: "test" } } }),
      (error) => {
        assert.equal(error.message, testCase.message);
        assert.equal(error.message.includes(providerErrorSecret), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.ok(failedCredentialBytes.every((byte) => byte === 0), "provider failure must clear credential bytes");
  }

  const previousTypesafeBaseUrl = process.env.TYPESAFE_BASE_URL;
  const originalFetch = globalThis.fetch;
  const sdkCredentialBytes = Buffer.from("sdk-test-credential", "utf16le");
  let sdkRequest;
  try {
    process.env.TYPESAFE_BASE_URL = "https://attacker.invalid";
    globalThis.fetch = async (input, init) => {
      sdkRequest = { url: String(input), authorization: new Headers(init?.headers).get("authorization") };
      return Response.json({
        model: "test-model",
        answers: { q: { type: "choice", choice: "yes", confidence: 0.8, probabilities: { yes: 0.8, no: 0.2 } } },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    const sdkProvider = createMssrJevBridgeDecisionProvider({
      readCredentialBytes: async () => sdkCredentialBytes,
      model: "test-model",
    });
    const sdkResponse = await sdkProvider.executeSystemOne({ state: {}, questions: { q: { kind: "choice", prompt: "test", options: { yes: "yes", no: "no" } } } });
    assert.deepEqual(sdkResponse.answers.q, { type: "choice", choice: "yes", confidence: 0.8, probabilities: { yes: 0.8, no: 0.2 } }, "TypeSafe Choice distribution must survive the SDK adapter unchanged");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousTypesafeBaseUrl === undefined) delete process.env.TYPESAFE_BASE_URL;
    else process.env.TYPESAFE_BASE_URL = previousTypesafeBaseUrl;
  }
  assert.equal(sdkRequest?.url, "https://api.typesafe.ai/v1/systemone", "an inherited SDK base URL must not redirect the Windows credential");
  assert.equal(sdkRequest?.authorization, "Bearer sdk-test-credential");
  assert.ok(sdkCredentialBytes.every((byte) => byte === 0), "SDK credential bytes must be cleared after the request");

  const defaultRegistry = (await import("../dist/tool-registry.js")).createDefaultToolRegistry();
  assert.ok(defaultRegistry.has("mssr_librarian_search"));
  assert.ok(defaultRegistry.has("mssr_librarian_jev_select"));
  assert.ok(defaultRegistry.has("mssr_librarian_evidence_pack"));
  assert.ok(defaultRegistry.has("mssr_semantic_evidence_relation_review"));
  const selectorSchema = defaultRegistry.tools.find((tool) => tool.name === "mssr_librarian_jev_select");
  assert.equal(selectorSchema.inputSchema.properties.candidateHandles.maxItems, 100);
  assert.equal("metadataMode" in selectorSchema.inputSchema.properties, false, "metadata retrieval is an explicit prior search step");
  const searchSchema = defaultRegistry.tools.find((tool) => tool.name === "mssr_librarian_search");
  assert.deepEqual(searchSchema.inputSchema.properties.metadataMode.enum, ["off", "project-context-single-section", "project-context-librarian-sidecar"]);
  const evidencePackSchema = defaultRegistry.tools.find((tool) => tool.name === "mssr_librarian_evidence_pack");
  assert.equal(evidencePackSchema.inputSchema.properties.handles.maxItems, 16);
  assert.ok(defaultRegistry.riskSummary.readOnly.includes("mssr_librarian_evidence_pack"));
  assert.equal(evidencePackSchema.annotations.readOnlyHint, true);
  assert.equal(evidencePackSchema.annotations.destructiveHint, false);
  assert.equal(selectorSchema.annotations.readOnlyHint, false);
  assert.equal(selectorSchema.annotations.destructiveHint, false);
  assert.equal(selectorSchema.metadata.mssrLifecycle.effect, "external-side-effect");
  const reviewSchema = defaultRegistry.tools.find((tool) => tool.name === "mssr_semantic_evidence_relation_review");
  assert.equal(reviewSchema.annotations.readOnlyHint, false);
  assert.equal(reviewSchema.metadata.mssrLifecycle.effect, "external-side-effect");

  console.log("MSSR semantic evidence Bridge tool tests passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
