import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

registerMockApi();

/**
 * Contract: the shared AgentSession workspace mutation path used by `/add-dir`
 * and the agent workspace tool MUST refresh the system prompt before the next
 * model call. Session state and the <workspace-roots> block must change
 * together on both add and remove.
 */
describe("workspace directories in the system prompt", () => {
	it("keeps session state and the workspace prompt synchronized across live add and remove", async () => {
		const dir = TempDir.createSync("@ws-prompt-add-");
		const auth = await AuthStorage.create(path.join(dir.path(), "auth.db"));
		try {
			auth.setRuntimeApiKey("mock", "test-key");
			const extraDir = path.join(dir.path(), "extra-root");
			fs.mkdirSync(extraDir, { recursive: true });
			const laterDir = path.join(dir.path(), "later-root");
			fs.mkdirSync(laterDir, { recursive: true });

			const mockModel = createMockModel({ id: "text", handler: () => ({ content: ["ok"] }) });
			const settings = Settings.isolated({
				"compaction.enabled": false,
				"todo.enabled": false,
				"retry.enabled": false,
			});
			const sessionManager = SessionManager.inMemory(dir.path());
			const { session } = await createAgentSession({
				cwd: dir.path(),
				agentDir: dir.path(),
				additionalDirectories: [extraDir],
				authStorage: auth,
				modelRegistry: new ModelRegistry(auth, path.join(dir.path(), "models.yml")),
				model: mockModel,
				settings,
				sessionManager,
				disableExtensionDiscovery: true,
				enableMCP: false,
				enableLsp: false,
				skills: [],
				rules: [],
				contextFiles: [],
			});
			try {
				// Sanity: the seed dir is present in the sessionManager state.
				expect(sessionManager.getAdditionalDirectories()).toEqual([extraDir]);

				// The shared mutation path persists state and refreshes the prompt.
				expect(await session.addWorkspaceDirectory(laterDir)).toBe(laterDir);

				// sessionManager state now has both.
				expect(sessionManager.getAdditionalDirectories()).toEqual([extraDir, laterDir]);

				// Send a prompt so we can inspect the system prompt the provider received.
				await session.prompt("noop");

				const calls = mockModel.calls ?? [];
				const lastCall = calls.at(-1);
				const systemPrompt = (lastCall?.context?.systemPrompt as string[] | undefined)?.join("\n") ?? "";

				// Both directories must appear in the <workspace-roots> block.
				expect(systemPrompt).toContain("<workspace-roots>");
				expect(systemPrompt).toContain(extraDir);
				expect(systemPrompt).toContain(laterDir);

				expect(await session.removeWorkspaceDirectory(laterDir)).toBe(laterDir);
				expect(sessionManager.getAdditionalDirectories()).toEqual([extraDir]);
				await session.prompt("noop after remove");
				const promptAfterRemove =
					(mockModel.calls?.at(-1)?.context?.systemPrompt as string[] | undefined)?.join("\n") ?? "";
				expect(promptAfterRemove).toContain(extraDir);
				expect(promptAfterRemove).not.toContain(laterDir);
			} finally {
				await session.dispose();
			}
		} finally {
			auth.close();
			dir.removeSync();
		}
	});
});
