/**
 * @license
 * Copyright 2020 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import convict from 'convict';
import { config as load } from 'dotenv';

load();

const config = convict({
  oada: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'localhost',
      env: 'DOMAIN',
      arg: 'domain',
    },
    token: {
      doc: 'OADA API token',
      format: Array,
      default: ['god'],
      env: 'TOKEN',
      arg: 'token',
    },
  },
  maskpath: {
    doc: 'Paths in resources that should be masked',
    format: Array,
    default: [  ],
    env: 'MASKPATH',
    arg: 'maskpath',
  },
  maskkey: {
    doc: 'Keys that should be masked regardless of path',
    format: Array,
    default: [ 'location' ],
    env: 'MASKKEY',
    arg: 'maskkey',
  },
  privateJWK: {
    doc: 'Path to private key file as a JWK in your container.  Generate with oada-certs --create-keys',
    format: String,
    default: './keys/private_key.jwk', // obviously the default is NOT private at all
    env: 'PRIVATEJWK',
    arg: 'privatejwk',
  },
  signerName: {
    doc: 'Name of signer, to be included in generated signatures.',
    format: String,
    default: 'Test Signer',
    env: 'SIGNERNAME',
    arg: 'signername',
  },
  signerUrl: {
    doc: 'URL of signer\'s homepage, to be included in generated signatures.',
    format: String,
    default: 'https://oatscenter.org',
    env: 'SIGNERURL',
    arg: 'signerurl',
  },
});

/**
 * Error if our options are invalid.
 * Warn if extra options found.
 */
config.validate({ allowed: 'warn' });

export default config;
