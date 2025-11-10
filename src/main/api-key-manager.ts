import { app } from 'electron';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import machineId from 'node-machine-id';

/**
 * Manages encrypted storage of the Anthropic API key.
 * Uses AES-256-GCM encryption with a machine-specific key.
 */
export class ApiKeyManager {
  private configPath: string;
  private encryptionKey: Buffer;

  constructor() {
    // Store encrypted API key in userData directory
    this.configPath = join(app.getPath('userData'), 'api-key.enc');

    // Derive encryption key from machine ID for machine-specific encryption
    // This provides basic security without requiring a user password
    const id = machineId.machineIdSync();
    this.encryptionKey = this.deriveKey(id);
  }

  /**
   * Derive a 256-bit encryption key from the machine ID
   */
  private deriveKey(machineId: string): Buffer {
    // Use PBKDF2 to derive a strong key from the machine ID
    return pbkdf2Sync(
      machineId,
      'anthropic-api-key-salt', // Static salt (okay for machine-specific encryption)
      100000, // iterations
      32, // key length (256 bits)
      'sha256'
    );
  }

  /**
   * Encrypt and store the API key
   */
  setApiKey(apiKey: string): void {
    try {
      // Generate a random IV (initialization vector) for each encryption
      const iv = randomBytes(16);

      // Create cipher with AES-256-GCM
      const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

      // Encrypt the API key
      let encrypted = cipher.update(apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get the authentication tag
      const authTag = cipher.getAuthTag();

      // Store IV + authTag + encrypted data
      const data = {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        encrypted: encrypted
      };

      writeFileSync(this.configPath, JSON.stringify(data), 'utf8');
    } catch (error) {
      console.error('Failed to encrypt and save API key:', error);
      throw new Error('Failed to save API key');
    }
  }

  /**
   * Decrypt and retrieve the API key
   */
  getApiKey(): string | null {
    try {
      if (!existsSync(this.configPath)) {
        return null;
      }

      const fileContent = readFileSync(this.configPath, 'utf8');
      const data = JSON.parse(fileContent);

      // Extract IV, auth tag, and encrypted data
      const iv = Buffer.from(data.iv, 'hex');
      const authTag = Buffer.from(data.authTag, 'hex');
      const encrypted = data.encrypted;

      // Create decipher
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt API key:', error);
      return null;
    }
  }

  /**
   * Check if an API key is stored
   */
  hasApiKey(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Delete the stored API key
   */
  deleteApiKey(): void {
    try {
      if (existsSync(this.configPath)) {
        unlinkSync(this.configPath);
      }
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw new Error('Failed to delete API key');
    }
  }
}
