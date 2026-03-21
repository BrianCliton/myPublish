import type { Config, Manifest } from "../core/types.ts";
import { KeyRing } from "./keyring.ts";
import { Poller } from "./poller.ts";
import type { PollResult } from "./poller.ts";
import { type ClientState, createDefaultState, loadState, saveState } from "./state.ts";

export interface PublishClientOptions {
  serverUrl: string;
  rootPublicKey: Uint8Array;
  pollInterval?: number; // default 3600 (1 hour, in seconds)
  statePath?: string;
  onConfigUpdate?: (config: Config, manifest: Manifest) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export class PublishClient {
  private readonly options: PublishClientOptions;
  private readonly keyRing: KeyRing;
  private readonly poller: Poller;
  private state: ClientState;
  private initialized: boolean = false;

  constructor(options: PublishClientOptions) {
    this.options = options;
    this.state = createDefaultState();
    this.keyRing = new KeyRing(options.rootPublicKey);

    this.poller = new Poller({
      serverUrl: options.serverUrl,
      keyRing: this.keyRing,
      pollInterval: options.pollInterval ?? 3600,
      rootPublicKey: options.rootPublicKey,
      onConfigUpdate: async (config, manifest) => {
        await this.persistState();
        try {
          await options.onConfigUpdate?.(config, manifest);
        } catch {
          // User callback errors are non-fatal
        }
      },
      onError: (error) => {
        try {
          options.onError?.(error);
        } catch {
          // Error handler errors are non-fatal
        }
      },
      getState: () => this.state,
      setState: (updater) => {
        this.state = updater(this.state);
      },
    });
  }

  /**
   * Start the polling loop. Loads persisted state if statePath is configured.
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      await this.loadPersistedState();
      this.initialized = true;
    }
    this.poller.start();
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    this.poller.stop();
  }

  /**
   * Force an immediate check for updates.
   */
  async check(): Promise<{ updated: boolean; config?: Config; manifest?: Manifest }> {
    if (!this.initialized) {
      await this.loadPersistedState();
      this.initialized = true;
    }
    try {
      const result: PollResult = await this.poller.check();
      if (result.updated) {
        await this.persistState();
      }
      return {
        updated: result.updated,
        config: result.config,
        manifest: result.manifest,
      };
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      return { updated: false };
    }
  }

  /**
   * Get current config from cache/state.
   */
  getCurrentConfig(): Config | null {
    return this.state.cached_config;
  }

  /**
   * Get current manifest from cache/state.
   */
  getCurrentManifest(): Manifest | null {
    return this.state.cached_manifest;
  }

  private async loadPersistedState(): Promise<void> {
    if (!this.options.statePath) return;
    try {
      this.state = await loadState(this.options.statePath);
      // Restore keyring from cached key list
      if (this.state.cached_key_list) {
        this.keyRing.restoreFromCache(
          this.state.cached_key_list,
          this.state.last_list_sequence,
        );
      }
    } catch {
      this.state = createDefaultState();
    }
  }

  private async persistState(): Promise<void> {
    if (!this.options.statePath) return;
    try {
      await saveState(this.options.statePath, this.state);
    } catch {
      // Persistence failure is non-fatal
    }
  }
}

// Re-exports for convenience
export { KeyRing } from "./keyring.ts";
export { Poller, type PollResult, type PollerOptions } from "./poller.ts";
export {
  type ClientState,
  createDefaultState,
  loadState,
  saveState,
} from "./state.ts";
