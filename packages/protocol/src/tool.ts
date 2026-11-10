/**
 * Agent tools.
 *
 * Not on the wire: this is the contract between the core and the packages
 * that give the agent abilities (`@agentos/computer`, the core's own tools).
 * Engines adapt these to whatever their model expects.
 */
import type { z } from "zod";
import type { Risk } from "./schemas.js";

export type ToolContent =
  | { type: "text"; text: string }
  /** `data` is raw base64, without a `data:` prefix. */
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolContext {
  /** Aborted when the owner interrupts the agent. */
  signal: AbortSignal;
  /** Thread the call was made from. */
  threadId: string;
}

/** What a call is about, known before it runs. */
export interface ToolCallFacts {
  /** Human name of the thing acted on, e.g. the label of a button: "Deploy". */
  target?: string;
  /** Set when this particular call deserves the owner's attention. */
  risk?: Risk;
}

export interface AgentTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** snake_case, unique. */
  name: string;
  /** Written for the model: what it does and when to use it. */
  description: string;
  input: Shape;
  /** True when the tool only observes and never changes anything. */
  readOnly: boolean;
  /**
   * Optional: facts about one call, used for the activity line the owner
   * reads ("Clicking “Deploy”") and by the safety policy. Must be cheap and
   * must not have side effects.
   */
  inspect?(input: z.infer<z.ZodObject<Shape>>): ToolCallFacts;
  run(input: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<ToolResult>;
}

/** Helper that keeps the input type inferred from the shape. */
export function defineTool<Shape extends z.ZodRawShape>(tool: AgentTool<Shape>): AgentTool<Shape> {
  return tool;
}
