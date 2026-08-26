import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { LspTool } from "@oh-my-pi/pi-coding-agent/lsp";
import { getActiveClients, shutdownAll } from "@oh-my-pi/pi-coding-agent/lsp/client";
import { configCache } from "@oh-my-pi/pi-coding-agent/lsp/config";
import { disposeLspWorkspace } from "@oh-my-pi/pi-coding-agent/lsp/servers";
import { createLspWritethrough } from "@oh-my-pi/pi-coding-agent/lsp/writethrough";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { TempDir } from "@oh-my-pi/pi-utils";

const FAKE_LSP_SERVER = path.resolve(import.meta.dir, "../fixtures/fake-lsp-server.ts");

describe("multi-root LSP", () => {
	it("starts file-scoped and write-through servers from the registered root instead of the meta-workspace cwd", async () => {
		const tempDir = TempDir.createSync("@omp-lsp-multi-root-");
		const metaRoot = tempDir.path();
		const repositoryRoot = path.join(metaRoot, "repos", "worktree");
		const sourcePath = path.join(repositoryRoot, "src", "main.ts");
		try {
			fs.mkdirSync(path.join(repositoryRoot, ".omp"), { recursive: true });
			fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
			fs.writeFileSync(path.join(repositoryRoot, ".fake-lsp-root"), "");
			fs.writeFileSync(sourcePath, "export const value = 1;\n");
			fs.writeFileSync(
				path.join(repositoryRoot, ".omp", "lsp.json"),
				JSON.stringify({
					servers: {
						"fake-multi-root": {
							command: process.execPath,
							args: [FAKE_LSP_SERVER],
							fileTypes: [".ts"],
							rootMarkers: [".fake-lsp-root"],
						},
					},
				}),
			);

			const session = {
				cwd: metaRoot,
				additionalDirectories: [repositoryRoot],
				settings: Settings.isolated(),
			} as ToolSession;
			const tool = new LspTool(session);
			const result = await tool.execute("request", {
				action: "request",
				file: sourcePath,
				query: "test/state",
			});

			expect(result.details?.success).toBe(true);
			expect(getActiveClients()).toContainEqual(
				expect.objectContaining({ name: process.execPath, root: repositoryRoot, status: "ready" }),
			);
			expect(getActiveClients().some(client => client.root === metaRoot)).toBe(false);
			const writethrough = createLspWritethrough(metaRoot, {
				enableFormat: true,
				getAdditionalDirectories: () => [repositoryRoot],
			});
			await writethrough(sourcePath, "export const value = 2;\n");
			expect(fs.readFileSync(sourcePath, "utf8")).toBe("export const value = 2;\n");
			const stateAfterWrite = await tool.execute("state-after-write", {
				action: "request",
				file: sourcePath,
				query: "test/state",
			});
			const stateText = stateAfterWrite.content
				.filter(block => block.type === "text")
				.map(block => block.text)
				.join("\n");
			expect(stateText).toContain(sourcePath);
			expect(stateText).toContain("didChange");
			expect(await disposeLspWorkspace(repositoryRoot)).toEqual([process.execPath]);
			expect(getActiveClients().some(client => client.root === repositoryRoot)).toBe(false);
		} finally {
			await shutdownAll();
			configCache.delete(metaRoot);

			configCache.delete(repositoryRoot);
			tempDir.removeSync();
		}
	}, 15_000);
});
