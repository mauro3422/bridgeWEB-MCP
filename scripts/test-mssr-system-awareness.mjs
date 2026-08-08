import assert from "node:assert/strict";
import {
  classifyRobloxTargetState,
  isRobloxMssrRoute,
  parseRobloxStudioMode,
} from "../dist/mssr-system-awareness.js";

const studio = { id: "studio-1", name: "1.rbxl", active: false };
const activeStudio = { ...studio, active: true };

assert.equal(isRobloxMssrRoute({ domains: ["roblox"] }), true);
assert.equal(isRobloxMssrRoute({ domains: ["coding"] }, ["roblox-development"]), true);
assert.equal(isRobloxMssrRoute({ domains: ["coding"] }, ["skill-system-maintenance"]), false);

assert.equal(parseRobloxStudioMode({ content: [{ type: "text", text: "- Current Studio Mode: Edit" }] }), "Edit");
assert.equal(parseRobloxStudioMode({ content: [{ type: "text", text: "- Current Studio Mode: Play" }] }), "Play");
assert.equal(parseRobloxStudioMode({ content: [] }), "Unknown");

assert.equal(classifyRobloxTargetState({ catalogStatus: "unavailable", studios: [], activeStudio: null, mode: "Unknown" }), "catalog-unavailable");
assert.equal(classifyRobloxTargetState({ catalogStatus: "degraded", studios: [], activeStudio: null, mode: "Unknown" }), "catalog-degraded");
assert.equal(classifyRobloxTargetState({ catalogStatus: "cached", studios: [], activeStudio: null, mode: "Unknown" }), "catalog-degraded");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [], activeStudio: null, mode: "Unknown" }), "no-studio");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [studio], activeStudio: null, mode: "Unknown" }), "single-studio-inactive");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [studio, { id: "studio-2", name: "2.rbxl", active: false }], activeStudio: null, mode: "Unknown" }), "multiple-studios-no-active");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [activeStudio], activeStudio, mode: "Edit" }), "active-edit");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [activeStudio], activeStudio, mode: "Play" }), "active-play");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [activeStudio], activeStudio, mode: "Unknown" }), "active-unknown");
assert.equal(classifyRobloxTargetState({ catalogStatus: "healthy", studios: [], activeStudio: null, mode: "Unknown", inspectionError: "boom" }), "studio-inspection-failed");

console.log("mssr system awareness: ok");
