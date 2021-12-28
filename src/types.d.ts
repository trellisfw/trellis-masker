/**
 * Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * OADA certificates
 */
declare module '@oada/oada-certs' {
  /**
   * JSON Web Key
   */
  export interface JWKPublic {
    kty: string;
    use?: string;
    key_ops?: string[];
    alg?: string;
    kid?: string;
    jku?: string;
    n?: string;
    e?: string;
  }

  export interface JWK extends JWKPublic {
    d?: string;
    p?: string;
    q?: string;
    dp?: string;
    dq?: string;
    qi?: string;
  }

  export interface Keys {
    create: () => { 
      public: JWKPublic,
      private: JWK
    };
    pubFromPriv: (key: JWK) => Promise<JWKPublic>;
  }
  export const keys: Keys;
}

/**
 * Trellis signatures
 */
declare module '@trellisfw/signatures' {
  import { keys, JWK, JWKPublic } from '@oada/oada-certs';

  export function sign<T>(
    jsonObject: T,
    privateJWK: JWK,
    headers: Record<string, unknown>
  ): Promise<T & { signatures: string[] }>;

  export function verify<T extends { signatures?: string[] }>(
    jsonObject: T,
    // TODO: what is this?
    options?: unknown
  ): Promise<{
    valid: boolean;
    trusted: boolean;
    unchanged: boolean;
    payload: Record<string, unknown>;
    messages: string[];
    original: T;
  }>;

  // keys is re-exported from oada-certs
  export const keys: typeof keys;

  export { JWK, JWKPublic } from '@oada/oada-certs';
}

declare module '@trellisfw/masklink' {
  import { JWK, JWKPublic } from '@oada/oada-certs';
  import { OADAClient } from '@oada/client';

  // Returns id of the new masked resource
  export function maskAndSignRemoteResourceAsNewResource(cfg: {
    url: string,
    privateJWK: JWK,
    signer: { name: string, url?: string },
    domain?: string,
    token?: string,
    connection?: OADAClient,
    paths: string[],
  }):Promise<string>;

}
