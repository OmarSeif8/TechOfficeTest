/**
 * Storage Provider Abstraction
 *
 * Provides a unified interface for storing uploaded drawing files, attachments,
 * and exported documents. Supports both cloud storage (Supabase/S3 for Web)
 * and local file system storage (for Electron/Desktop conversion).
 */

export interface StorageUploadOptions {
  contentType?: string;
  isPublic?: boolean;
}

export interface StorageUploadResult {
  path: string;
  publicUrl: string;
  sizeBytes: number;
}

export interface IStorageProvider {
  /**
   * Upload binary data to storage.
   */
  upload(
    bucket: string,
    filePath: string,
    data: Buffer | Uint8Array,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult>;

  /**
   * Retrieve a public or signed URL for accessing a stored file.
   */
  getUrl(bucket: string, filePath: string): Promise<string>;

  /**
   * Delete a file from storage.
   */
  delete(bucket: string, filePath: string): Promise<void>;

  /**
   * Check if a file exists in storage.
   */
  exists(bucket: string, filePath: string): Promise<boolean>;
}
