import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolResult, ToolApprovalDecision } from "@oh-my-pi/pi-agent-core";
import workspaceDescription from "../prompts/tools/workspace.md" with { type: "text" };
import type { ToolSession, WorkspaceToolController } from ".";
import { formatPathRelativeToCwd } from "./path-utils";

const workspaceSchema = type({
	action: "'list' | 'add' | 'remove'",
	"path?": type("string").describe("workspace directory, absolute or relative to the session working directory"),
}).narrow((params, ctx) => {
	if (params.action === "list") {
		return params.path === undefined || ctx.mustBe('used without "path" for "list"');
	}
	return params.path?.trim() ? true : ctx.mustBe(`used with "path" for "${params.action}"`);
});

export type WorkspaceParams = typeof workspaceSchema.infer;

export interface WorkspaceToolDetails {
	action: WorkspaceParams["action"];
	changed: boolean;
	cwd: string;
	additionalDirectories: string[];
	affectedDirectory?: string;
}

/** Structured agent-facing access to the same live workspace state as /add-dir. */
export class WorkspaceTool implements AgentTool<typeof workspaceSchema, WorkspaceToolDetails> {
	readonly name = "workspace";
	readonly approval = (args: unknown): ToolApprovalDecision =>
		(args as Partial<WorkspaceParams>).action === "list" ? "read" : "write";
	readonly label = "Workspace";
	readonly description = workspaceDescription;
	readonly parameters = workspaceSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "List, add, or remove session workspace roots";

	constructor(
		private readonly cwd: string,
		private readonly controller: WorkspaceToolController,
	) {}

	static createIf(session: ToolSession): WorkspaceTool | null {
		if (!session.workspace || (session.taskDepth ?? 0) > 0) return null;
		return new WorkspaceTool(session.cwd, session.workspace);
	}

	formatApprovalDetails(args: unknown): string[] {
		const params = args as Partial<WorkspaceParams>;
		const lines = [`Action: ${params.action ?? "(missing)"}`];
		if (params.path) lines.push(`Directory: ${formatPathRelativeToCwd(params.path, this.cwd)}`);
		return lines;
	}

	async execute(_id: string, params: WorkspaceParams): Promise<AgentToolResult<WorkspaceToolDetails>> {
		if (params.action === "list") {
			const state = this.controller.list();
			const directories = [
				`${formatPathRelativeToCwd(state.cwd, this.cwd)} (working directory)`,
				...state.additionalDirectories.map(directory => formatPathRelativeToCwd(directory, this.cwd)),
			];
			return {
				content: [
					{ type: "text", text: `Workspace directories:\n${directories.map(line => `  ${line}`).join("\n")}` },
				],
				details: { action: params.action, changed: false, ...state },
			};
		}

		const directory = params.path?.trim();
		if (!directory) throw new Error(`"${params.action}" requires "path".`);
		const affectedDirectory =
			params.action === "add" ? await this.controller.add(directory) : await this.controller.remove(directory);
		const state = this.controller.list();
		const changed = affectedDirectory !== null;
		let verb: string;
		if (params.action === "add") verb = changed ? "Added" : "Already registered";
		else verb = changed ? "Removed" : "Not registered";
		const displayDirectory = formatPathRelativeToCwd(affectedDirectory ?? directory, this.cwd);
		return {
			content: [{ type: "text", text: `${verb} workspace directory: ${displayDirectory}` }],
			details: {
				action: params.action,
				changed,
				...state,
				...(affectedDirectory ? { affectedDirectory } : undefined),
			},
		};
	}
}
