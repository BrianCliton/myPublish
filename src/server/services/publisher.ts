import type { AdminStore } from "../db/admin-store.ts";
import type { Config, UnsignedManifest } from "../../core/types.ts";
import { computeContentHash, computeContentSize } from "../../core/hash.ts";
import { signManifest, base64ToUint8Array } from "../../core/signing.ts";
import { canonicalJson } from "../../core/canonical.ts";
import { decryptPrivateKey } from "./keymanager.ts";

export interface PublishResult {
  readonly success: boolean;
  readonly error?: string;
  readonly version?: number;
  readonly signature?: string;
}

export async function publishConfig(
  store: AdminStore,
  version: number,
  keyId: string,
  expiresInSeconds: number = 86400 * 30,
): Promise<PublishResult> {
  const config = store.getConfigDetail(version);
  if (!config) {
    return { success: false, error: "Config version not found" };
  }

  if (config.status !== "approved") {
    return { success: false, error: `Cannot publish config with status '${config.status}', must be 'approved'` };
  }

  const signingKey = store.getSigningKey(keyId);
  if (!signingKey) {
    return { success: false, error: "Signing key not found" };
  }

  if (signingKey.status !== "active") {
    return { success: false, error: "Signing key is revoked" };
  }

  const parsedConfig: Config = JSON.parse(config.config_content);
  const contentHash = await computeContentHash(parsedConfig);
  const contentSize = computeContentSize(parsedConfig);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expiresInSeconds;

  const unsigned: UnsignedManifest = {
    version,
    content_hash: contentHash,
    content_size: contentSize,
    key_id: keyId,
    timestamp: now,
    expires_at: expiresAt,
  };

  const privateKeyBytes = await decryptPrivateKey(signingKey.private_key_enc);
  const signedManifest = await signManifest(unsigned, privateKeyBytes);

  store.updateConfigStatus(version, "published", {
    content_hash: contentHash,
    content_size: contentSize,
    key_id: keyId,
    signature: signedManifest.signature,
    expires_at: expiresAt,
    published_at: now,
    config_content: canonicalJson(parsedConfig),
  });

  return {
    success: true,
    version,
    signature: signedManifest.signature,
  };
}
