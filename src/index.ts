// Beethoven for Claude Desktop and Claude Code: the server Claude starts on this computer. It speaks MCP
// on stdin and stdout and nothing else; stderr gets one fixed line at start, because the host keeps a
// server's stderr in its own log. It writes no file but its own folder's known_hosts (the pinned grid
// key), the sign-in launcher and ssh's control socket, and it opens no network connection of its own:
// the only programs it starts are the computer's ssh, ssh-keyscan, its terminal app and its link opener.
import { configFrom } from './config.js';
import { Grid } from './grid.js';
import { McpServer, serveStdio, type Tool } from './mcp.js';
import { loadProfile, ProfileError } from './profile.js';
import { tools } from './tools.js';
import { NAME, PRODUCT_NAME, VERSION } from './version.js';

const INSTRUCTIONS = [
  `${PRODUCT_NAME} reaches the student's Claude Code worker on their university's grid over their own ssh sign-in.`,
  'Start with grid_check; if it says the student is not signed in, use grid_sign_in, which opens a terminal where the student signs in themselves (never ask the student for a password or code: no tool takes one).',
  'worker_status tells where the worker is; worker_start asks for it; open_in_claude opens it once it is online. worker_stop ends it: ask the student first.',
  'workspace_list and workspace_read show the worker\'s own folder. worker_status asks the grid at most once a minute; there is no need to call it more often.',
  "account_list shows the student's own Claude accounts on this computer, as the account switcher keeps them; it only reads that list, and the student changes it in their own terminal.",
  "Never suggest adding the grid as an SSH connection in Claude Code Desktop: that installs and runs Claude Code on the grid's login node, which the grid forbids.",
].join(' ');

function main(): void {
  const { config, problems } = configFrom(process.env);
  let list: Tool[];
  try {
    const profile = loadProfile(config.site);
    list = tools(new Grid(config, profile));
  } catch (e) {
    const why = e instanceof ProfileError ? e.message : 'its site profile could not be read';
    // the server still answers, so the student reads why instead of a server that will not start
    problems.push(`Beethoven can't reach a grid: ${why}.`);
    list = [{ name: 'grid_check', title: 'Check the grid connection', description: "Says why Beethoven can't reach a grid.", inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, call: async () => ({ content: [] }) }];
  }
  if (problems.length) list = list.map((t) => ({ ...t, call: async () => ({ content: [{ type: 'text' as const, text: problems.join(' ') }], isError: true }) }));
  process.stderr.write(`${NAME} ${VERSION} started\n`);
  serveStdio((write) => new McpServer({ name: NAME, title: PRODUCT_NAME, version: VERSION, instructions: INSTRUCTIONS }, list, write));
}

main();
