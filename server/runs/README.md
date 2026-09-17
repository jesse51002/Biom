# The automation templates

One folder per harness, the framework's own, beside its code and never in the vault. `automation.create` copies one into `<page>/automations/<name>/` and the copy is the workspace's from that moment — nothing is seeded and nothing is updated. `server/main.ts` names this directory as `TEMPLATES_DIR` and `tools/app.ts` carries it into the compiled binary.

Each holds the `automation.yaml`, `kickoff.md` and `INSTRUCTIONS.md` a new automation starts from; the manifest's `name` is replaced by what the person called it. A template that will not read is left out of the list rather than offered. `.agents/skills/runs-guide/` is the guide.
