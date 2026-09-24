import { expect, it } from "bun:test";
import { $ } from "bun";
import * as path from "node:path";

it("loads canonical model overlays after installing the legacy resolver without corrupting their paths", async () => {
	// Runtime plugins are process-global; exercise the CLI's lazy require boundary
	// in a fresh process rather than leaking the compatibility hook into the suite.
	const result = await $`${process.execPath} -e ${`
		import { installLegacyPiSpecifierShim } from "./src/extensibility/plugins/legacy-pi-compat.ts";
		installLegacyPiSpecifierShim();
		for (const [specifier, name] of [
			["@oh-my-pi/pi-tui/overlays/model-hub.js", "ModelHubComponent"],
			["@oh-my-pi/pi-tui/overlays/model-picker.js", "ModelPickerComponent"],
		]) {
			if (typeof require(specifier)[name] !== "function") throw new Error(name + " is unavailable");
		}
	`}`
		.cwd(path.resolve(import.meta.dir, "../.."))
		.env({ ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" })
		.quiet()
		.nothrow();
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
}, 15_000);
