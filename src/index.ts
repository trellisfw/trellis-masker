/**
 * @license
 * Copyright 2021 https://oatscenter.org
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

import { readFileSync } from 'fs';
import debug from 'debug';
import { Service } from '@oada/jobs';
import type { WorkerFunction } from '@oada/jobs';
import tsig, { JWK } from '@trellisfw/signatures';
import oerror from '@overleaf/o-error';
import jsonpointer from 'json-pointer';
import config from './config.js';
import ml from '@trellisfw/masklink';

const error = debug('trellis-masker:error');
//const warn = debug('trellis-masker:warn');
const info = debug('trellis-masker:info');
const trace = debug('trellis-masker:trace');


//----------------------------------------------------------------------------------------
// Load configs (keys, signer name, type)
//----------------------------------------------------------------------------------------

const { 
  token: tokens, 
  domain,
} = config.get('oada');
const privateJWK = config.get('privateJWK');
const signerName = config.get('signerName');
const signerUrl = config.get('signerUrl');
const maskpaths = config.get('maskpath');
const maskkeys = config.get('maskkey');

// Allows domains with or without http on the front:
let DOMAIN = domain || '';
if (!DOMAIN.match(/^http/)) DOMAIN = 'https://'+DOMAIN;

// Read the signing key and get public key from it
const prvKey = JSON.parse(readFileSync(privateJWK).toString()) as JWK;
const pubKey = await tsig.keys.pubFromPriv(prvKey);
const header: { jwk: JWK; jku?: string; kid?: string } = { jwk: pubKey };
if (prvKey.jku) header.jku = prvKey.jku; // make sure we keep jku and kid
if (prvKey.kid) header.kid = prvKey.kid;
const signer: { name: string, url: string } = {
  name: signerName,
  url: signerUrl,
};


//----------------------------------------------------------------------------------------
// Utility functions
//----------------------------------------------------------------------------------------

/*
 * Recursive function to find json paths of any maskable keys in a document
 * @param obj the object to search for the keys
 * @param keys the keys to mask
 * @param previouspath? used in recursion, ignore for first call
 */
function findPathsToMask(obj: any, keys: string[], previouspath?: string): string[] {
  if (!previouspath) previouspath = '';
  const jp = jsonpointer.parse(previouspath);
  let found: string[] = [];
  if (typeof obj !== 'object' || !obj) return found; // no paths here
  // If obj is an object, look through its keys, and check their values too
  for (const k in obj) {
    const curpath = jsonpointer.compile([...jp, k]);
    if (keys.includes(k)) {
      found.push(curpath);
    }
    found = [ ...found, ...(findPathsToMask(obj[k], keys, curpath)) ];
  }
  return found;
}


//-----------------------------------------------------------------
// Job handler: sign a resource given a path
//-----------------------------------------------------------------
interface MaskJobConfig {
  path: string;
}
const isMaskJobConfig = (obj: unknown): obj is MaskJobConfig => {
  if (!obj || typeof obj !== 'object') return false;
  if (!('path' in obj))  return false;
  return true;
}

const handleMaskJob: WorkerFunction = async (job, { jobId, /*log,*/ oada }) => {
  if (!isMaskJobConfig(job.config)) {
    error('FAIL job ',jobId,': job.config did not have a path');
    throw new oerror(`FAIL job ${jobId}: job.config did not have a path`);
  }
  const configpath = job?.config?.path || '';
  info('Received mask job ',jobId,': path ', configpath); 

  // Grab the original doc for masking paths and keys
  trace('Grabbing original resource to find mask paths');
  const orig = await oada.get({ path: configpath }).then(r => r.data)
  .catch((e:Error) => {
    error('FAIL job ',jobId,': Could not get path ', configpath);
    throw oerror.tag(e, `FAIL job ${jobId}: Could not get path ${configpath}`);
  });
  trace('Found original, looking for paths');

  // Check if any of the config maskpaths exist on this document
  let paths: string[] = maskpaths.filter(p => jsonpointer.has(orig, p));
  // Also add any paths where any universally maskable keys are found
  paths = [ ...paths, ...(findPathsToMask(orig, maskkeys)) ];
  trace('Masking these paths: ', paths);

  trace('Beginning to mask and signing remote resource');
  const maskid = await ml.maskAndSignRemoteResourceAsNewResource({
    url: `${DOMAIN}${configpath}`, 
    privateJWK: prvKey,
    signer,
    domain: oada.getDomain(), // mask&link is still on older  oada client, let it recreate client for itself
    token: oada.getToken(),
    //connection: oada,
    paths
  }).catch(e => { 
    error('Failed to maskAndSignRemoteResourceAsNewResource for url ',DOMAIN+configpath, ', error = ', e);
    throw oerror.tag(e, `Failed to maskAndSignRemoteResourceAsNewResource for urli ${DOMAIN}${configpath}`);
  });
  info('Successfully masked resource at ',job.config.path, ' as new resource ', maskid);

  // Cross-link mask/unmasked versions, using ref's for masked
  await oada.put({
    path: `${configpath}/_meta`,
    data: {
      vdoc: { 
        mask: { _id: maskid }
      }
    },
  });
  await oada.put({
    path: `/${maskid}/_meta`,
    data: {
      vdoc: {
        unmask: { _ref: maskid }
      }
    }
  });
  trace('Cross-linked masked/unmasked documents');



  // We are done with the job!  Document is masked
  return { 
    success: true,
    mask: { _id: maskid }
  };
};


// "run" handles one token: One service handler per token
async function run(token: string) {
  // Create service with up to 10 "in-flight" simultaneous requests to OADA
  const service = new Service('trellis-masker', DOMAIN, token, 10);
  // Register the job handler for the "Sign" job type:
  service.on('mask', 10*1000, handleMaskJob);
  // Start the service
  await service.start();
}

await Promise.all(tokens.map(async (token) => run(token)));
