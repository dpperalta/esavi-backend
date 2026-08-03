import crypto from 'crypto';

const algorithm: crypto.CipherGCMTypes = process.env.CRYPTO_ALGORITHM as crypto.CipherGCMTypes || 'aes-256-cbc';
const secutirtyKey = crypto.scryptSync(process.env.CRYPTO_SECRET_KEY as string, 'salt', 32);
const initVector = crypto.scryptSync(process.env.CRYPTO_VECTOR as string, 'salt', 16);

// Data encryption function
const esaviCrypt = (text: string) => {
    try {
        if( !secutirtyKey || !initVector ) {
            throw new Error('CRYPTO_SECRET_KEY and CRYPTO_VECTOR must be defined in environment variables');
        }
        const cipher = crypto.createCipheriv(algorithm, secutirtyKey, initVector);
        let encryptedData = cipher.update(text, 'utf-8', 'hex');
        encryptedData += cipher.final('hex');
        return encryptedData;
    } catch (error) {
        throw error;
    }
}

// Data decryption function
const esaviDecrypt = (text: string) => {
    try {
        if( !secutirtyKey || !initVector ) {
            throw new Error('CRYPTO_SECRET_KEY and CRYPTO_VECTOR must be defined in environment variables');
        }
        const decipher = crypto.createDecipheriv(algorithm, secutirtyKey, initVector);
        let decryptedData = decipher.update(text, 'hex', 'utf-8');
        decryptedData += decipher.final('utf-8');
        return decryptedData;
    } catch (error) {
        throw error;
    }
}

export {
    esaviCrypt,
    esaviDecrypt
}