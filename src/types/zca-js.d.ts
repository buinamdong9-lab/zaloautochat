declare module 'zca-js' {
  export interface ZaloConfig {
    imageMetadataGetter?: (filePath: string) => Promise<any>;
  }

  export interface LoginCredentials {
    cookie: any;
    imei: string;
    userAgent: string;
  }

  export enum ThreadType {
    User = 'user',
    Group = 'group'
  }

  export interface ZaloAPI {
    sendMessage(text: string, threadId: string): Promise<any>;
    getGroupInfo(threadId: string): Promise<any>;
    getAllFriends(count?: number, page?: number): Promise<any>;
    // Depending on version, we might have these or custom REST calls
  }

  export class Zalo {
    constructor(config?: ZaloConfig);
    login(credentials: LoginCredentials): Promise<ZaloAPI>;
    loginQR(options?: any, callback?: any): Promise<ZaloAPI>;
  }
}
