export const SERVER_NAME = "bridge-mcp";
export const SERVER_VERSION = "0.5.2";

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_CAPTURE_CHARS = 512 * 1024;
export const DEFAULT_GIT_REMOTE_URL = "https://github.com/mauro3422/bridgeWEB-MCP.git";
export const DEFAULT_TUNNEL_ADMIN_BASE_URL = "http://127.0.0.1:8081";
export const DEFAULT_RESTART_REQUEST_FILE = ".bridge-restart-request";
export const DEFAULT_RESTART_ACK_FILE = ".bridge-restart-ack";

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3001;
const DEFAULT_HTTP_PATH = "/mcp";

export type BridgeHttpConfig = {
  host: string;
  port: number;
  mcpPath: string;
  allowRemote: boolean;
};

function parseBool(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_HTTP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BRIDGE_MCP_HTTP_PORT: ${value}. Expected integer 1-65535.`);
  }
  return port;
}

function parsePath(value: string | undefined): string {
  const mcpPath = value || DEFAULT_HTTP_PATH;
  if (!mcpPath.startsWith("/")) {
    throw new Error(`Invalid BRIDGE_MCP_HTTP_PATH: ${mcpPath}. Path must start with '/'.`);
  }
  if (mcpPath.includes("..") || mcpPath.includes("\\")) {
    throw new Error(`Invalid BRIDGE_MCP_HTTP_PATH: ${mcpPath}. Path must not contain '..' or backslashes.`);
  }
  return mcpPath;
}

function parseHost(value: string | undefined, allowRemote: boolean): string {
  const host = value || DEFAULT_HTTP_HOST;
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!allowRemote && !loopbackHosts.has(host)) {
    throw new Error(
      `Refusing non-loopback BRIDGE_MCP_HTTP_HOST '${host}'. Set BRIDGE_MCP_HTTP_ALLOW_REMOTE=true only if you intentionally want this.`,
    );
  }
  return host;
}

export function getBridgeHttpConfig(env: NodeJS.ProcessEnv = process.env): BridgeHttpConfig {
  const allowRemote = parseBool(env.BRIDGE_MCP_HTTP_ALLOW_REMOTE);
  return {
    allowRemote,
    host: parseHost(env.BRIDGE_MCP_HTTP_HOST, allowRemote),
    port: parsePort(env.BRIDGE_MCP_HTTP_PORT),
    mcpPath: parsePath(env.BRIDGE_MCP_HTTP_PATH),
  };
}

