import type { Config, KeyList, Manifest, PublishResponse } from "../core/types.ts";
import { KeyListSchema, PublishResponseSchema, ManifestSchema } from "../core/types.ts";
import { validateManifestAndConfig } from "../core/validation.ts";
import { KeyRing } from "./keyring.ts";
import type { ClientState } from "./state.ts";

export interface PollResult {
  updated: boolean;
  config?: Config;
  manifest?: Manifest;
  keyListUpdated?: boolean;
}

export interface PollerOptions {
  serverUrl: string;
  keyRing: KeyRing;
  pollInterval: number; // seconds
  onConfigUpdate?: (config: Config, manifest: Manifest) => void | Promise<void>;
  onError?: (error: Error) => void;
  getState: () => ClientState;
  setState: (updater: (prev: ClientState) => ClientState) => void;
  rootPublicKey: Uint8Array;
}

const MAX_BACKOFF_SECONDS = 86400; // 24 hours
const JITTER_FACTOR = 0.1; // ±10%

export class Poller {
  private readonly options: PollerOptions;
  private abortController: AbortController | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors: number = 0;
  private running: boolean = false;

  constructor(options: PollerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.consecutiveErrors = 0;
    this.scheduleNextPoll(0); // immediate first poll
  }

  stop(): void {
    this.running = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async check(): Promise<PollResult> {
    const controller = new AbortController();
    this.abortController = controller;
    try {
      return await this.doPoll(controller.signal);
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.timeoutId = setTimeout(async () => {
      this.timeoutId = null;
      if (!this.running) return;
      try {
        await this.check();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        this.options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      if (this.running) {
        this.scheduleNextPoll(this.getNextInterval());
      }
    }, delayMs);
  }

  private getNextInterval(): number {
    const baseInterval = this.options.pollInterval * 1000;
    let interval: number;

    if (this.consecutiveErrors > 0) {
      // Exponential backoff: interval * 2^errors, capped at MAX_BACKOFF
      const backoff = Math.min(
        baseInterval * Math.pow(2, this.consecutiveErrors),
        MAX_BACKOFF_SECONDS * 1000,
      );
      interval = backoff;
    } else {
      interval = baseInterval;
    }

    // Add jitter ±10%
    const jitter = interval * JITTER_FACTOR * (2 * Math.random() - 1);
    return Math.max(0, Math.floor(interval + jitter));
  }

  private async doPoll(signal: AbortSignal): Promise<PollResult> {
    const state = this.options.getState();
    let keyListUpdated = false;

    // Step 1: Fetch and update key list
    try {
      const keyListResponse = await fetch(
        `${this.options.serverUrl}/v1/keys`,
        { signal },
      );
      if (!keyListResponse.ok) {
        throw new Error(`Key list endpoint returned ${keyListResponse.status}`);
      }
      const keyListData = await keyListResponse.json();
      const keyList = KeyListSchema.parse(keyListData);
      if (keyList.list_sequence > state.last_list_sequence) {
        const updated = await this.options.keyRing.updateFromKeyList(keyList);
        if (updated) {
          keyListUpdated = true;
          this.options.setState((prev) => ({
            ...prev,
            last_list_sequence: keyList.list_sequence,
            cached_key_list: keyList,
          }));
        }
      }
    } catch (error) {
      // Key list fetch failure is non-fatal — continue with cached keys
      if (signal.aborted) throw error;
      this.options.onError?.(
        new Error(`Key list fetch failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }

    // Step 2: Check manifest for version change (lightweight)
    let manifestResponse: Response;
    try {
      manifestResponse = await fetch(
        `${this.options.serverUrl}/v1/config/latest/manifest`,
        { signal },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`Manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!manifestResponse.ok) {
      throw new Error(`Manifest endpoint returned ${manifestResponse.status}`);
    }

    const manifestData = await manifestResponse.json();
    const manifest = ManifestSchema.parse(manifestData.manifest ?? manifestData);

    // No update needed if version hasn't changed
    if (manifest.version <= state.last_config_version) {
      return { updated: false, keyListUpdated };
    }

    // Step 3: Fetch full config
    let configResponse: Response;
    try {
      configResponse = await fetch(
        `${this.options.serverUrl}/v1/config/latest`,
        { signal },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`Config fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!configResponse.ok) {
      throw new Error(`Config endpoint returned ${configResponse.status}`);
    }

    const publishData = await configResponse.json();
    const publishResponse = PublishResponseSchema.parse(publishData);

    // Step 4-7: Full verification
    const currentState = this.options.getState();
    const keyList = currentState.cached_key_list;
    if (!keyList) {
      throw new Error("No key list available for verification");
    }

    const validation = await validateManifestAndConfig(
      publishResponse.manifest,
      publishResponse.config,
      keyList,
      this.options.rootPublicKey,
    );

    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // All checks passed — apply
    this.options.setState((prev) => ({
      ...prev,
      last_config_version: publishResponse.manifest.version,
      cached_manifest: publishResponse.manifest,
      cached_config: publishResponse.config,
    }));

    try {
      await this.options.onConfigUpdate?.(
        publishResponse.config,
        publishResponse.manifest,
      );
    } catch {
      // Callback errors are non-fatal
    }

    return {
      updated: true,
      config: publishResponse.config,
      manifest: publishResponse.manifest,
      keyListUpdated,
    };
  }
}
