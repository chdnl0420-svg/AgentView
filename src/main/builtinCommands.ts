import type { SlashCommandEntry } from '@shared/types';

/**
 * Claude Code TUI built-in slash commands. These don't have .md files on disk
 * but the TUI accepts them as `/<name>`. We surface them in the autocomplete
 * so the user can pick them the same way as user-defined commands.
 */
const BUILTIN: Array<{ name: string; description: string }> = [
  { name: 'agents', description: 'Manage background agents' },
  { name: 'allowed-tools', description: 'Show/edit allowed tools for this session' },
  { name: 'bug', description: 'File a bug report' },
  { name: 'clear', description: 'Clear the conversation history' },
  { name: 'compact', description: 'Compact the conversation, optionally with instructions' },
  { name: 'config', description: 'Open the Claude Code configuration' },
  { name: 'cost', description: 'Show running cost and token usage' },
  { name: 'diff', description: 'Show the working-tree diff' },
  { name: 'doctor', description: 'Run health checks on Claude Code' },
  { name: 'effort', description: 'Adjust effort/thinking level' },
  { name: 'export', description: 'Export the current conversation' },
  { name: 'fork', description: 'Fork the current session into a new one' },
  { name: 'goal', description: 'Set or clear a session goal' },
  { name: 'help', description: 'Show available commands' },
  { name: 'hooks', description: 'Manage Claude Code hooks' },
  { name: 'init', description: 'Initialise a new Claude Code project' },
  { name: 'login', description: 'Log in to Claude' },
  { name: 'logout', description: 'Log out of Claude' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'memory', description: 'Manage long-term memory' },
  { name: 'model', description: 'Switch the model for the current session' },
  { name: 'permissions', description: 'Manage tool permissions' },
  { name: 'plan', description: 'Restate requirements and plan the implementation' },
  { name: 'plugin', description: 'Manage plugins' },
  { name: 'pr-comments', description: 'Read PR review comments' },
  { name: 'pr-create', description: 'Create a pull request' },
  { name: 'pwd', description: 'Show current working directory' },
  { name: 'release-notes', description: 'Show recent Claude Code release notes' },
  { name: 'resume', description: 'Resume a previous session' },
  { name: 'review', description: 'Review local or PR changes' },
  { name: 'save', description: 'Save the current session' },
  { name: 'sessions', description: 'List recent sessions' },
  { name: 'skill', description: 'Invoke a registered skill' },
  { name: 'status', description: 'Show session status' },
  { name: 'think-harder', description: 'Re-run the last turn with deeper thinking' },
  { name: 'todos', description: 'Manage the current task list' },
  { name: 'undo', description: 'Undo the last action' },
  { name: 'upgrade', description: 'Check for Claude Code updates' },
  { name: 'verbose', description: 'Toggle verbose output' },
  { name: 'vim', description: 'Toggle Vim keybindings' },
  { name: 'workspace', description: 'Show workspace info' },
  { name: 'worktree', description: 'Create or list git worktrees' }
];

export function listBuiltinCommands(): SlashCommandEntry[] {
  return BUILTIN.map((b) => ({
    name: b.name,
    scope: 'builtin',
    description: b.description,
    filePath: ''
  }));
}
