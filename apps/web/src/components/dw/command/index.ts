/**
 * ⌘K + WebMCP + window.darwin for the Darwin app. Mount <CommandRuntimeProvider> inside <DarwinProvider>,
 * then <CommandBar /> and <RunToast /> once; <CommandPill /> goes in the top nav.
 */
export { CommandRuntimeProvider, useCommandRuntime, useCommandState, useWebMcpAvailable, type CommandRuntime } from "./runtime";
export { CommandBar } from "./command-bar";
export { useModKey } from "./keys";
export { RunToast } from "./run-toast";
export { CommandPill } from "./pill";
