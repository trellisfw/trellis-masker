import { AxiosResponse } from '../node_modules/axios/index.d';

export interface OadaCache {
  get: (arg0: CacheGet) => Promise<AxiosResponse>;
  post: (arg0: CachePost) => Promise<AxiosResponse>;
  put: (arg0: CachePut) => Promise<AxiosResponse>;
  delete: (arg0: CacheDelete) => Promise<AxiosResponse>;
}

export interface CacheGet {
  path: string;
}

export interface CachePost {
  path: string;
  data?: any;
}

export type CachePut = CachePost;
export type CacheDelete = CachePost;
