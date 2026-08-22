import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type ContaPaths = { root:string; data:string; database:string; backups:string; imports:string; logs:string; temp:string };

export function resolveContaPaths(mode=process.env.CONTA_MODE ?? "development", rootOverride=process.env.CONTA_DATA_ROOT):ContaPaths {
  const root = resolve(rootOverride || (mode === "production"
    ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Conta Offline")
    : join(tmpdir(), "conta-offline-development")));
  return { root, data:join(root,"data"), database:join(root,"data","conta.db"), backups:join(root,"backups"), imports:join(root,"imports"), logs:join(root,"logs"), temp:join(root,"temp") };
}
