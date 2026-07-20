import { Zalo, ZaloAPI } from 'zca-js';
import db from '../config/db';
import { encrypt } from '../utils/crypto';
import { ZaloService } from './zaloService';

interface QRSession {
  status: 'init' | 'generated' | 'scanned' | 'expired' | 'declined' | 'success' | 'error';
  qrImage?: string;
  displayName?: string;
  avatar?: string;
  error?: string;
  abortAction?: () => void;
}

export class QRManager {
  private static sessions: Map<number, QRSession> = new Map();

  /**
   * Get active QR login session status for a user
   */
  public static getSession(userId: number): QRSession | undefined {
    return this.sessions.get(userId);
  }

  /**
   * Cancel/abort a running QR login process
   */
  public static abortSession(userId: number) {
    const session = this.sessions.get(userId);
    if (session && session.abortAction) {
      try {
        session.abortAction();
      } catch (e) {
        console.error(`Error aborting QR session for user ${userId}:`, e);
      }
    }
    this.sessions.delete(userId);
  }

  /**
   * Start asynchronous QR login process using zca-js
   */
  public static startQRLogin(userId: number): Promise<void> {
    // If session is already running, abort it first
    this.abortSession(userId);

    const session: QRSession = { status: 'init' };
    this.sessions.set(userId, session);

    return new Promise((resolve) => {
      const zalo = new Zalo();
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

      zalo.loginQR({ userAgent }, (event: any) => {
        // Event types: QRCodeGenerated = 0, QRCodeExpired = 1, QRCodeScanned = 2, QRCodeDeclined = 3, GotLoginInfo = 4
        switch (event.type) {
          case 0: // QRCodeGenerated
            session.status = 'generated';
            session.qrImage = event.data.image; // Base64 string
            console.log(`Zalo QR generated for user ${userId}`);
            session.abortAction = () => {
              if (event.actions && typeof event.actions.abort === 'function') {
                event.actions.abort();
              }
            };
            break;
          case 1: // QRCodeExpired
            session.status = 'expired';
            break;
          case 2: // QRCodeScanned
            session.status = 'scanned';
            session.displayName = event.data.display_name;
            session.avatar = event.data.avatar;
            break;
          case 3: // QRCodeDeclined
            session.status = 'declined';
            break;
          case 4: // GotLoginInfo
            try {
              const imei = event.data.imei;
              const cookies = event.data.cookie;
              const cookiesStr = JSON.stringify(cookies);
              const encryptionKey = process.env.ENCRYPTION_KEY || 'zalo-secret-key-32-chars-long!!!';
              const encrypted = encrypt(cookiesStr, encryptionKey);

              // Update in database
              db.prepare('UPDATE users SET imei = ?, encrypted_cookies = ? WHERE id = ?')
                .run(imei, encrypted, userId);

              session.status = 'success';
              // Flush Zalo clients cache to pick up the new session
              ZaloService.logout(userId);
            } catch (err) {
              console.error('Failed to save QR login credentials to database:', err);
              session.status = 'error';
              session.error = (err as Error).message;
            }
            break;
        }
      })
      .then((api: ZaloAPI) => {
        console.log(`Zalo QR Login Success for user ${userId}`);
        resolve();
      })
      .catch((err: Error) => {
        console.error(`Zalo QR Login Promise rejected for user ${userId}:`, err);
        session.status = err.name === 'ZaloApiLoginQRDeclined' ? 'declined' : 'error';
        session.error = err.message;
        resolve(); // Resolve to avoid hanging, since status checking is handled by polling
      });
    });
  }
}
