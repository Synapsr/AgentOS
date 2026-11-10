/**
 * The core's own tools: how the agent asks its owner a question and how it
 * runs long work in the background. Engine-agnostic, like the computer's.
 */
import { statSync } from "node:fs";
import { type AgentTool, Risk, type Thread, type ToolResult, defineTool } from "@agentos/protocol";
import { z } from "zod";
import type { AgentNode } from "./node.js";

/** The tools the agent gets in a thread. Only the main conversation can run jobs. */
export function coreTools(node: AgentNode, thread: Thread): AgentTool[] {
  return thread.kind === "main" ? [askOwner(node), ...jobTools(node)] : [askOwner(node)];
}

function askOwner(node: AgentNode): AgentTool {
  return defineTool({
    name: "ask_owner",
    description:
      "Ask your owner a question and wait for their answer. Use it before anything irreversible or outward-facing " +
      "(spending money, sending a message in their name, deleting data, publishing, deploying to production), or when " +
      "only they can decide. The question is read aloud to them, wherever they are.",
    input: {
      question: z.string().min(1).describe("One clear sentence, written to be heard."),
      options: z.array(z.string().min(1)).max(4).optional().describe('Short answers offered as buttons, e.g. ["Deploy", "Not now"].'),
      risk: Risk.optional().describe("How much is at stake. Defaults to low."),
      screenshot: z.boolean().optional().describe("Show them what is on the screen right now, when seeing it helps to decide."),
    },
    readOnly: true,
    run: async (input, ctx) => {
      const answer = await node.askOwner(ctx.threadId, input, ctx.signal);
      if (!answer) return say("Your owner stopped you before answering. Do not go ahead.");
      const choice = answer.option ? `chose "${answer.option}"` : "answered";
      return say(`Your owner ${choice}${answer.text ? `: "${answer.text}"` : "."}`);
    },
  }) as AgentTool;
}

function jobTools(node: AgentNode): AgentTool[] {
  return [
    defineTool({
      name: "start_job",
      description:
        "Start long work in the background, usually in a project folder, and keep this conversation free. " +
        "The job is a separate agent with the same abilities as you. You are told when it finishes.",
      input: {
        title: z.string().min(1).max(80).describe('A few words your owner will see, e.g. "Fix the login page".'),
        prompt: z.string().min(1).describe("Everything the job needs to know. It starts with no memory of this conversation."),
        cwd: z.string().optional().describe("Absolute path of the folder to work in."),
      },
      readOnly: false,
      run: async ({ title, prompt, cwd }, ctx) => {
        if (cwd && !isDirectory(cwd)) return say(`There is no folder at ${cwd}.`, true);
        const job = node.startJob({ parentId: ctx.threadId, title, prompt, cwd: cwd ?? null });
        return say(`Job ${job.id} started. You will be told when it finishes.`);
      },
    }) as AgentTool,
    defineTool({
      name: "list_jobs",
      description: "List your background jobs: their id, title, state and latest line.",
      input: {},
      readOnly: true,
      run: async () => {
        const lines = node.jobs().map((j) => `${j.id} · ${j.title} · ${j.state}${j.preview ? ` · ${j.preview}` : ""}`);
        return say(lines.join("\n") || "No jobs.");
      },
    }) as AgentTool,
    defineTool({
      name: "tell_job",
      description: "Send a message to a background job: more instructions, a correction, an answer.",
      input: { job: z.string().describe("The job's id."), message: z.string().min(1) },
      readOnly: false,
      run: async ({ job, message }) => {
        if (!node.tellJob(job, message)) return say(`There is no job ${job}.`, true);
        return say("Delivered.");
      },
    }) as AgentTool,
    defineTool({
      name: "stop_job",
      description: "Stop what a background job is doing.",
      input: { job: z.string().describe("The job's id.") },
      readOnly: false,
      run: async ({ job }) => {
        if (!(await node.stopJob(job))) return say(`There is no job ${job}.`, true);
        return say("Stopped.");
      },
    }) as AgentTool,
  ];
}

function say(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
