import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

// Configure Cloudinary if environment variables are present
const isConfigured = Boolean(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (isConfigured) {
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloudinary_url: process.env.CLOUDINARY_URL
    });
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }
  logger.info('☁️ Cloudinary Storage Service initialized.');
} else {
  logger.warn('Cloudinary credentials not detected in .env. Screenshots will be served locally as fallback.');
}

class CloudinaryService {
  isAvailable() {
    return isConfigured;
  }

  /**
   * Uploads screenshot buffer or local file path to Cloudinary
   * @param {Buffer|string} fileSource 
   * @param {string} filename 
   * @returns {Promise<{ url: string, public_id: string } | null>}
   */
  async uploadScreenshot(fileSource, filename = '') {
    if (!isConfigured) return null;

    try {
      const publicId = (filename || `gold_alert_${Date.now()}`).replace(/\.[^/.]+$/, "");

      if (Buffer.isBuffer(fileSource)) {
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'gold_alerts',
              public_id: publicId,
              resource_type: 'image',
              overwrite: true
            },
            (error, result) => {
              if (error) {
                logger.error(`Cloudinary buffer upload error: ${error.message}`);
                return resolve(null);
              }
              logger.info(`☁️ Screenshot uploaded to Cloudinary: ${result.secure_url}`);
              resolve({
                url: result.secure_url,
                public_id: result.public_id
              });
            }
          );
          uploadStream.end(fileSource);
        });
      } else {
        const result = await cloudinary.uploader.upload(fileSource, {
          folder: 'gold_alerts',
          public_id: publicId,
          resource_type: 'image',
          overwrite: true
        });
        logger.info(`☁️ Screenshot file uploaded to Cloudinary: ${result.secure_url}`);
        return {
          url: result.secure_url,
          public_id: result.public_id
        };
      }
    } catch (err) {
      logger.error(`Failed to upload screenshot to Cloudinary: ${err.message}`);
      return null;
    }
  }

  /**
   * Deletes screenshot from Cloudinary by publicId or URL
   */
  async deleteScreenshot(publicIdOrUrl) {
    if (!isConfigured || !publicIdOrUrl) return false;

    try {
      let publicId = publicIdOrUrl;
      if (publicIdOrUrl.startsWith('http')) {
        // Extract public_id from URL
        const matches = publicIdOrUrl.match(/gold_alerts\/[^.]+/);
        if (matches) publicId = matches[0];
      }

      const res = await cloudinary.uploader.destroy(publicId);
      logger.info(`☁️ Cloudinary asset deleted: ${publicId}`);
      return res.result === 'ok';
    } catch (err) {
      logger.warn(`Error deleting Cloudinary asset: ${err.message}`);
      return false;
    }
  }
}

export const cloudinaryService = new CloudinaryService();
