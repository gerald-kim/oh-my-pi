import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { WorkspaceTool, type WorkspaceToolController } from "@oh-my-pi/pi-coding-agent/tools";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("workspace tool", () => {
	it("lets the agent list and mutate the live session workspace through approval-gated actions", async () => {
		const tempDir = TempDir.createSync("@omp-workspace-tool-");
		try {
			const additionalDirectories: string[] = [];
			const controller: WorkspaceToolController = {
				list: () => ({ cwd: tempDir.path(), additionalDirectories: [...additionalDirectories] }),
				add: async directory => {
					const resolved = path.resolve(tempDir.path(), directory);
					if (additionalDirectories.includes(resolved)) return null;
					additionalDirectories.push(resolved);
					return resolved;
				},
				remove: async directory => {
					const resolved = path.resolve(tempDir.path(), directory);
					const index = additionalDirectories.indexOf(resolved);
					if (index === -1) return null;
					additionalDirectories.splice(index, 1);
					return resolved;
				},
			};
			const tool = new WorkspaceTool(tempDir.path(), controller);

			expect(tool.approval({ action: "list" })).toBe("read");
			expect(tool.approval({ action: "add", path: "repo" })).toBe("write");

			const added = await tool.execute("add", { action: "add", path: "repo" });
			expect(added.details).toMatchObject({
				action: "add",
				changed: true,
				additionalDirectories: [path.join(tempDir.path(), "repo")],
			});

			const listed = await tool.execute("list", { action: "list" });
			const listedText = listed.content
				.filter(block => block.type === "text")
				.map(block => block.text)
				.join("\n");
			expect(listedText).toContain("repo");

			const removed = await tool.execute("remove", { action: "remove", path: "repo" });
			expect(removed.details).toMatchObject({ action: "remove", changed: true, additionalDirectories: [] });
		} finally {
			tempDir.removeSync();
		}
	});
});
