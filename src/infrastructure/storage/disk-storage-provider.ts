import fs from "fs/promises";
import path from "path";
import {
  IStorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
} from "@/services/storage/types";

export class DiskStorageProvider implements IStorageProvider {
  private baseDir: string;

  constructor(baseDir: string = "uploads") {
    this.baseDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), baseDir);
  }

  async upload(
    bucket: string,
    filePath: string,
    data: Buffer | Uint8Array,
    _options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const fullDir = path.join(this.baseDir, bucket, path.dirname(filePath));
    await fs.mkdir(fullDir, { recursive: true });

    const fullPath = path.join(this.baseDir, bucket, filePath);
    await fs.writeFile(fullPath, data);

    const relativePath = path.join(bucket, filePath).replace(/\\/g, "/");
    return {
      path: relativePath,
      publicUrl: `/api/file-uploads?key=${encodeURIComponent(relativePath)}`,
      sizeBytes: data.byteLength,
    };
  }

  async getUrl(bucket: string, filePath: string): Promise<string> {
    const relativePath = path.join(bucket, filePath).replace(/\\/g, "/");
    return `/api/file-uploads?key=${encodeURIComponent(relativePath)}`;
  }

  async delete(bucket: string, filePath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, bucket, filePath);
    try {
      await fs.unlink(fullPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  async exists(bucket: string, filePath: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, bucket, filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}
