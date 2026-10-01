import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildMssrEvidenceAtom,
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
  await fs.writeFile(path.join(root, ".mssr", "project-context.json"), JSON.stringify({ schemaVersion: 1, core: [], modules: [] }));
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

  const providerCalls = [];
  const decisionProvider = {
    async executeSystemOne(request) {
      providerCalls.push(request);
      const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
        if (key === "selection") {
          const selectedOption = request.state.query.includes("absent-case")
            ? "none"
            : Object.entries(question.options).find(([optionId, value]) => optionId !== "none" && JSON.parse(value)[2].includes("Preserve operational records"))?.[0] ?? "none";
          return [key, { type: "choice", choice: selectedOption, confidence: 0.97 }];
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
  assert.ok(selected.results.length >= 1);
  const preserveHandle = (selected.results.find((item) => item.handle.rangeKind === "block") ?? selected.results[0]).handle;

  const exact = await registry.call("mssr_librarian_fetch", { projectRoot: root, handle: preserveHandle });
  assert.equal(exact.advisoryOnly, true);
  assert.match(exact.text, /Keep benchmark results/);

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
  assert.equal(jevSelection.exactFetchRequired, true);
  assert.equal(jevSelection.truthAuthority, false);
  assert.equal(jevSelection.autoApplyAllowed, false);
  const selectionRequest = providerCalls.at(-1);
  assert.equal(selectionRequest.state.query, "Where should benchmark records and provenance be kept?");
  assert.ok(Object.keys(selectionRequest.questions.selection.options).includes("none"));
  assert.ok(Object.values(selectionRequest.questions.selection.options).every((option) => option.length <= 1200));
  assert.equal(JSON.stringify(selectionRequest).includes("TAIL-ONLY-MUST-NOT-BE-SENT"), false, "Jev selection must receive only the bounded excerpt, not the whole source section");
  const jevExact = await registry.call("mssr_librarian_fetch", { projectRoot: root, handle: jevSelection.selected.handle });
  assert.equal(jevExact.handle.fingerprint, jevSelection.selected.handle.fingerprint);
  assert.match(jevExact.text, /Keep benchmark results/);

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
  await assert.rejects(
    registry.call("mssr_librarian_jev_select", {
      projectRoot: root,
      sourceRefs: ["other-policy.md"],
      query: "select a result from an unselected source",
      candidateHandles: [preserveHandle],
    }),
    /explicitly supplied document owned by the same caller/,
  );
  assert.equal(providerCalls.length, 2, "a handle outside the selected sourceRefs must be rejected before calling Jev");

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
  const reviewed = await registry.call("mssr_semantic_evidence_relation_review", { projectRoot: root, input: reviewInput });
  assert.equal(providerCalls.length, 4);
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
  await assert.rejects(registry.call("mssr_librarian_jev_select", {
    projectRoot: root,
    sourceRefs: ["policy.md"],
    query: "select a stale search result",
    candidateHandles: [preserveHandle],
  }), /stale/);
  assert.equal(providerCalls.length, 4, "a stale search handle must be rejected before calling Jev");

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
        answers: { q: { type: "noul", noul: 0.1 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    const sdkProvider = createMssrJevBridgeDecisionProvider({
      readCredentialBytes: async () => sdkCredentialBytes,
      model: "test-model",
    });
    await sdkProvider.executeSystemOne({ state: {}, questions: { q: { kind: "noul", prompt: "test" } } });
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
  assert.ok(defaultRegistry.has("mssr_semantic_evidence_relation_review"));
  const selectorSchema = defaultRegistry.tools.find((tool) => tool.name === "mssr_librarian_jev_select");
  assert.equal(selectorSchema.inputSchema.properties.candidateHandles.maxItems, 100);
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
