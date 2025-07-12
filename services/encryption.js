const crypto = require('crypto');
const forge = require('node-forge');
const logger = require('./logger');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
    this.saltLength = 32;
    this.iterations = 100000;
    
    // Master key from environment
    this.masterKey = this.deriveMasterKey();
  }

  // Derive master key from environment variable
  deriveMasterKey() {
    const secret = process.env.ENCRYPTION_SECRET || 'default-secret-key-change-in-production';
    const salt = process.env.ENCRYPTION_SALT || 'default-salt-change-in-production';
    
    return crypto.pbkdf2Sync(secret, salt, this.iterations, this.keyLength, 'sha512');
  }

  // Generate a random key
  generateKey() {
    return crypto.randomBytes(this.keyLength);
  }

  // Generate a random IV
  generateIV() {
    return crypto.randomBytes(this.ivLength);
  }

  // Encrypt data with AES-256-GCM
  encrypt(data, key = null) {
    try {
      if (!data) return null;
      
      const encryptionKey = key || this.masterKey;
      const iv = this.generateIV();
      const cipher = crypto.createCipher(this.algorithm, encryptionKey, iv);
      
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      // Combine IV, tag, and encrypted data
      const combined = Buffer.concat([iv, tag, Buffer.from(encrypted, 'hex')]);
      
      return combined.toString('base64');
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('Encryption failed', error, { dataType: typeof data });
      throw new Error('Encryption failed');
    }
  }

  // Decrypt data with AES-256-GCM
  decrypt(encryptedData, key = null) {
    try {
      if (!encryptedData) return null;
      
      const encryptionKey = key || this.masterKey;
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract IV, tag, and encrypted data
      const iv = combined.slice(0, this.ivLength);
      const tag = combined.slice(this.ivLength, this.ivLength + this.tagLength);
      const encrypted = combined.slice(this.ivLength + this.tagLength);
      
      const decipher = crypto.createDecipher(this.algorithm, encryptionKey, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('Decryption failed', error, { dataLength: encryptedData?.length });
      throw new Error('Decryption failed');
    }
  }

  // Hash password with salt
  hashPassword(password, salt = null) {
    try {
      const passwordSalt = salt || crypto.randomBytes(this.saltLength);
      const hash = crypto.pbkdf2Sync(password, passwordSalt, this.iterations, this.keyLength, 'sha512');
      
      return {
        hash: hash.toString('hex'),
        salt: passwordSalt.toString('hex')
      };
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('Password hashing failed', error);
      throw new Error('Password hashing failed');
    }
  }

  // Verify password against hash
  verifyPassword(password, hash, salt) {
    try {
      const passwordSalt = Buffer.from(salt, 'hex');
      const computedHash = crypto.pbkdf2Sync(password, passwordSalt, this.iterations, this.keyLength, 'sha512');
      
      return computedHash.toString('hex') === hash;
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('Password verification failed', error);
      return false;
    }
  }

  // Generate secure random tokens
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  // Generate secure random string
  generateSecureString(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      result += chars[randomIndex];
    }
    
    return result;
  }

  // Create HMAC signature
  createHMAC(data, secret = null) {
    try {
      const hmacSecret = secret || this.masterKey;
      const hmac = crypto.createHmac('sha256', hmacSecret);
      hmac.update(JSON.stringify(data));
      return hmac.digest('hex');
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('HMAC creation failed', error);
      throw new Error('HMAC creation failed');
    }
  }

  // Verify HMAC signature
  verifyHMAC(data, signature, secret = null) {
    try {
      const expectedSignature = this.createHMAC(data, secret);
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('HMAC verification failed', error);
      return false;
    }
  }

  // Generate RSA key pair for asymmetric encryption
  generateRSAKeyPair() {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      return { publicKey, privateKey };
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('RSA key pair generation failed', error);
      throw new Error('RSA key pair generation failed');
    }
  }

  // Generate secure session ID
  generateSessionId() {
    const timestamp = Date.now().toString(36);
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `${timestamp}-${randomBytes}`;
  }

  // Hash IP address for privacy
  hashIPAddress(ipAddress) {
    try {
      const hash = crypto.createHash('sha256');
      hash.update(ipAddress + (process.env.IP_HASH_SECRET || 'default-ip-secret'));
      return hash.digest('hex');
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('IP address hashing failed', error);
      return null;
    }
  }

  // Generate API key
  generateAPIKey(userId, permissions = []) {
    try {
      const payload = {
        userId,
        permissions,
        timestamp: Date.now(),
        random: this.generateToken(16)
      };
      
      const signature = this.createHMAC(payload);
      const apiKey = Buffer.from(JSON.stringify({ ...payload, signature })).toString('base64');
      
      return apiKey;
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('API key generation failed', error, { userId });
      throw new Error('API key generation failed');
    }
  }

  // Verify API key
  verifyAPIKey(apiKey) {
    try {
      const payload = JSON.parse(Buffer.from(apiKey, 'base64').toString());
      const { signature, ...data } = payload;
      
      if (!this.verifyHMAC(data, signature)) {
        return null;
      }
      
      // Check if key is expired (24 hours)
      const ageInMs = Date.now() - data.timestamp;
      if (ageInMs > 24 * 60 * 60 * 1000) {
        return null;
      }
      
      return data;
      
    } catch (error) {
      logger.errorWithContext && logger.errorWithContext('API key verification failed', error);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new EncryptionService();
