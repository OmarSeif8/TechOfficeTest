import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  IStorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
} from "@/services/storage/types";
import { DiskStorageProvider } from "./disk-storage-provider";

export class SupabaseStorageProvider implements IStorageProvider {
  private client: SupabaseClient | null = null;
  private fallback: DiskStorageProvider;

  constructor() {
    this.fallback = new DiskStorageProvider();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && key) {
      this.client = createClient(url, key);
    }
  }

  async upload(
    bucket: string,
    filePath: string,
    data: Buffer | Uint8Array,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    if (!this.client) {
      return this.fallback.upload(bucket, filePath, data, options);
    }

    const { error } = await this.client.storage
      .from(bucket)
      .upload(filePath, data, {
        contentType: options?.contentType ?? "application/octet-stream",
        upsert: true,
      });

    if (error) {
      throw new Error(`Supabase storage upload failed: ${error.message}`);
    }

    const { data: urlData } = this.client.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return {
      path: `${bucket}/${filePath}`,
      publicUrl: urlData.publicUrl,
      sizeBytes: data.byteLength,
    };
  }

  async getUrl(bucket: string, filePath: string): Promise<string> {
    if (!this.client) {
      return this.fallback.getUrl(bucket, filePath);
    }
    const { data } = this.client.storage.from(bucket).getPublicUrl(filePath);
    return data.publicUrl;
  }

  async delete(bucket: string, filePath: string): Promise<void> {
    if (!this.client) {
      return this.fallback.delete(bucket, filePath);
    }
    const { error } = await this.client.storage.from(bucket).remove([filePath]);
    if (error) {
      throw new Error(`Supabase storage delete failed: ${error.message}`);
    }
  }

  async exists(bucket: string, filePath: string): Promise<boolean> {
    if (!this.client) {
      return this.fallback.exists(bucket, filePath);
    }
    const { data, error } = await this.client.storage
      .from(bucket)
      .list(filePath.substring(0, filePath.lastIndexOf("/")) || undefined, {
        search: filePath.substring(filePath.lastIndexOf("/") + 1),
      });

    return !error && !!data && data.length > 0;
  }
}
