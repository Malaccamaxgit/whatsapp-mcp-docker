/**
 * Typed helpers for MCP tool registration.
 *
 * The SDK's registerTool() uses complex conditional types that are not
 * directly assignable from plain TypeScript function types, so every call
 * site ends up with an `as any` cast.  This module centralises the interop
 * in ONE place and exports:
 *
 *   ToolInput<T>   – derives the plain-TS input type from a Zod raw shape
 *   McpResult      – the MCP tool result type our handlers return
 *   registerTool() – typed wrapper that removes the need for `as any` at
 *                    every call site
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Derives the TypeScript input type for a tool handler from the Zod raw shape
 * passed as `inputSchema` to `registerTool`.
 *
 * Example:
 *   const mySchema = { name: z.string(), count: z.number().optional() };
 *   const handler = async ({ name, count }: ToolInput<typeof mySchema>) => { ... };
 */
export type ToolInput<T extends Record<string, z.ZodTypeAny>> = {
  [K in keyof T]: z.infer<T[K]>;
};

/**
 * The MCP tool result type.  All tool handlers must return this (or a
 * Promise of it).  Structurally compatible with the SDK's CallToolResult.
 */
export type McpResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

type RegisterToolConfig<T extends Record<string, z.ZodTypeAny>> = {
  description?: string;
  inputSchema?: T;
  annotations?: ToolAnnotations;
};

/**
 * Typed wrapper for server.registerTool() that eliminates `as any` casts from
 * individual tool handlers.  The SDK's internal type (ToolCallback<InputArgs>)
 * requires an index signature and the exact SDK CallToolResult type, so
 * bridging it with our simpler McpResult is done once here.
 */
export function registerTool<T extends Record<string, z.ZodTypeAny>>(
  server: McpServer,
  name: string,
  config: RegisterToolConfig<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: ToolInput<T>) => McpResult | Promise<McpResult>
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, config as any, handler as any);
}
