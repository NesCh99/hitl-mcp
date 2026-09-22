import { mkdir, readFile, writeFile, unlink, access, chmod } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { getCredentialsDir } from "../config/defaults.js";

/**
 * Abstraction over local secure storage for provider credentials.
 * MVP uses a restricted-permission file under ~/.hitl-mcp/credentials/.
 * A future implementation may use OS keychain (keytar / Security framework).
 */
export interface SecureStorage {
  read(key: string): Promise<unknown | undefined>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export class FileSecureStorage implements SecureStorage {
  constructor(private readonly dir = getCredentialsDir()) {}

  private pathFor(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async read(key: string): Promise<unknown | undefined> {
    const path = this.pathFor(key);
    try {
      await access(path, constants.F_OK);
    } catch {
      return undefined;
    }
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  }

  async write(key: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.pathFor(key);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    try {
      await chmod(path, 0o600);
    } catch {
      // best-effort on platforms that don't support chmod the same way
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // already absent
    }
  }
}
