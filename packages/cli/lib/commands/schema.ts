import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { WbError, info } from "@stanok/core/utils";

function skHome(): string {
  return join(process.env.HOME!, ".stanok");
}

const SCHEMA_URL = join(skHome(), "settings.schema.json");

const SCHEMA_ENTRY = {
  fileMatch: ["**/.stanok/settings.json", "**/.stanok/settings.local.json"],
  url: SCHEMA_URL,
};

// ── VS Code / Cursor ───────────────────────────────────────────────────────

interface VscodeTarget {
  name: string;
  settingsPath: string;
}

const VSCODE_TARGETS: Record<string, VscodeTarget> = {
  vscode: {
    name: "VS Code",
    settingsPath: join(process.env.HOME!, "Library/Application Support/Code/User/settings.json"),
  },
  cursor: {
    name: "Cursor",
    settingsPath: join(process.env.HOME!, "Library/Application Support/Cursor/User/settings.json"),
  },
};

function applyVscode(target: VscodeTarget) {
  if (!existsSync(target.settingsPath)) {
    throw new WbError(`${target.name} settings not found at ${target.settingsPath}`);
  }

  const raw = readFileSync(target.settingsPath, "utf-8");
  let settings: any;
  try {
    settings = JSON.parse(raw);
  } catch {
    throw new WbError(`Failed to parse ${target.name} settings.json`);
  }

  if (!Array.isArray(settings["json.schemas"])) {
    settings["json.schemas"] = [];
  }

  const schemas: any[] = settings["json.schemas"];
  const existing = schemas.findIndex((s: any) =>
    s.url === SCHEMA_ENTRY.url ||
    (Array.isArray(s.fileMatch) && s.fileMatch.some((m: string) => m.includes(".stanok/settings")))
  );

  if (existing >= 0) {
    schemas[existing] = SCHEMA_ENTRY;
    info(`Updated stanok schema in ${target.name} settings`);
  } else {
    schemas.push(SCHEMA_ENTRY);
    info(`Added stanok schema to ${target.name} settings`);
  }

  writeFileSync(target.settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// ── JetBrains ──────────────────────────────────────────────────────────────

function applyJetbrains(cwd: string) {
  const ideaDir = join(cwd, ".idea");
  if (!existsSync(ideaDir)) {
    mkdirSync(ideaDir, { recursive: true });
  }

  const xmlPath = join(ideaDir, "jsonSchemas.xml");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="JsonSchemaMappingsProjectConfiguration">
    <state>
      <map>
        <entry key="stanok">
          <value>
            <SchemaInfo>
              <option name="name" value="stanok" />
              <option name="relativePathReference" value="false" />
              <option name="schemaFile" value="file://${SCHEMA_URL}" />
              <option name="patterns">
                <list>
                  <Item>
                    <option name="path" value=".stanok/settings.json" />
                  </Item>
                  <Item>
                    <option name="path" value=".stanok/settings.local.json" />
                  </Item>
                </list>
              </option>
            </SchemaInfo>
          </value>
        </entry>
      </map>
    </state>
  </component>
</project>
`;

  writeFileSync(xmlPath, xml);
  info(`Written ${xmlPath}`);
}

// ── Command ────────────────────────────────────────────────────────────────

export async function cmdSchema(args: string[]) {
  const target = args[0];

  if (!existsSync(join(skHome(), "settings.schema.json"))) {
    throw new WbError("Schema not found. Run 'stanok reload' first.");
  }

  if (target && target in VSCODE_TARGETS) {
    applyVscode(VSCODE_TARGETS[target]);
    return;
  }

  if (target === "jetbrains") {
    applyJetbrains(process.cwd());
    return;
  }

  const available = [...Object.keys(VSCODE_TARGETS), "jetbrains"].join(", ");
  throw new WbError(`Usage: stanok schema <${available}>`);
}
