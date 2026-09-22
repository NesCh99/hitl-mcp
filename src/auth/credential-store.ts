import { mkdir, readFile, writeFile, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { getCredentialsDir } from "../config/defaults.js";
import type { SecureStorage } from "./secure-storage.js";
import { FileSecureStorage } from "./secure-storage.js";

/**
 * Persistent provider credentials, fully separated from runtime HITL state.
 */
export interface CredentialStore {
  get(provider: string): Promise<unknown | undefined>;
  set(provider: string, credentials: unknown): Promise<void>;
  delete(provider: string): Promise<void>;
}

export class LocalCredentialStore implements CredentialStore {
  constructor(private readonly storage: SecureStorage = new FileSecureStorage()) {}

  async get(provider: string): Promise<unknown | undefined> {
    return this.storage.read(provider);
  }

  async set(provider: string, credentials: unknown): Promise<void> {
    await this.storage.write(provider, credentials);
  }

  async delete(provider: string): Promise<void> {
    await this.storage.remove(provider);
  }
}

/**
 * File-backed credential store under ~/.hitl-mcp/credentials/.
 * Separated from config.json. OS keychain can replace FileSecureStorage later.
 */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly dir = getCredentialsDir()) {}

  private pathFor(provider: string): string {
    const safe = provider.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async get(provider: string): Promise<unknown | undefined> {
    const path = this.pathFor(provider);
    try {
      await access(path, constants.F_OK);
    } catch {
      return undefined;
    }
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  }

  async set(provider: string, credentials: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      this.pathFor(provider),
      `${JSON.stringify(credentials, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async delete(provider: string): Promise<void> {
    try {
      await unlink(this.pathFor(provider));
    } catch {
      // already absent
    }
  }
}
