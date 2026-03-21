import { z } from "zod";

// --- Zod Schemas ---

export const AnnouncementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["banner", "popup", "toast", "fullscreen"]),
  title: z.string().optional(),
  content: z.string().min(1),
  action_url: z.string().url().optional(),
  image_url: z.string().url().optional(),
  priority: z.number().int(),
  starts_at: z.number().int().positive().optional(),
  expires_at: z.number().int().positive(),
  display_rule: z.enum(["once", "every_launch", "daily"]).optional(),
  target_versions: z.string().optional(),
});

export const ConfigSchema = z.object({
  update: z
    .object({
      latest_version: z.string().min(1),
      min_version: z.string().min(1),
      download_url: z.string().url(),
      sha256: z.string().min(1),
      release_notes: z.string().optional(),
      force: z.boolean().optional(),
    })
    .optional(),
  endpoints: z.record(z.string(), z.string()).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  announcements: z.array(AnnouncementSchema).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const ManifestSchema = z.object({
  version: z.number().int().positive(),
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  content_size: z.number().int().nonnegative(),
  key_id: z.string().min(1),
  timestamp: z.number().int().positive(),
  expires_at: z.number().int().positive(),
  signature: z.string().min(1),
});

export const SigningKeyEntrySchema = z.object({
  key_id: z.string().min(1),
  public_key: z.string().min(1),
  status: z.enum(["active", "revoked"]),
  not_before: z.number().int().nonnegative(),
  not_after: z.number().int().positive(),
  revoked_at: z.number().int().positive().optional(),
});

export const KeyListSchema = z.object({
  version: z.number().int().positive(),
  list_sequence: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  expires_at: z.number().int().positive(),
  keys: z.array(SigningKeyEntrySchema),
  root_signature: z.string().min(1),
});

export const PublishResponseSchema = z.object({
  manifest: ManifestSchema,
  config: ConfigSchema,
});

// --- TypeScript Types (inferred from schemas) ---

export type Announcement = z.infer<typeof AnnouncementSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type SigningKeyEntry = z.infer<typeof SigningKeyEntrySchema>;
export type KeyList = z.infer<typeof KeyListSchema>;
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

// --- Unsigned variants (without signature fields) ---

export type UnsignedManifest = Omit<Manifest, "signature">;
export type UnsignedKeyList = Omit<KeyList, "root_signature">;
