import debug from 'debug';

// @ts-ignore
import { JobQueue } from '@oada/oada-jobs';
// @ts-ignore
import signatures from '@trellisfw/signatures';
import config from './config.js';

import Bluebird from 'bluebird';
Promise = <any>Bluebird;

// Types
import { OadaAudit } from './types/OadaDoc';
import { OadaCache } from './types/OadaCache.js';
import { AxiosResponse } from './node_modules/axios/index.js';
import { Jobs } from './types/OadaJobs.js';

const info = debug('trellis-cb:info');
const trace = debug('trellis-cb:trace');
const warn = debug('trellis-cb:warn');
const error = debug('trellis-cb:error');

const TRELLIS_URL = `https://${config.get('trellis_url')}`;
const TRELLIS_TOKEN = config.get('token');

// Hash, redact and PUT
async function hashmap(resourceId: string, task: Object, conn: OadaCache) {
  info(`Masking resource ${resourceId}`);
  debug(`Get virtual document from trellis`);
  const vDoc: Jobs = await conn
    .get({ path: `/resources/${resourceId}` })
    .then((r: AxiosResponse) => r.data);

  if (vDoc.audits) {
    await Bluebird.map(Object.keys(vDoc.audits), async (auditId: string) => {
      debug(`Audit: ${auditId}`);
      let audit: OadaAudit;
      try {
        audit = await conn
          .get({ path: `/resources/${resourceId}/audits/${auditId}` })
          .then((r) => r.data);
      } catch (e) {
        error('%O', e);
        throw 'Failed to get OADA document';
      }

      maskAudit(resourceId, auditId, audit);

      trace(`Posting masked audit ${auditId}`);
      let masked;
      try {
        masked = await conn
          .post({
            path: `/resources`,
            data: JSON.stringify(audit)
          })
          .then((r: AxiosResponse) => r.headers);
      } catch (e) {
        error('%O', e);
        throw 'Failed to post masked document';
      }

      const maskedId: string = masked.get('content-location').split('/')[1];
      debug(`Masked document located at /resources/${maskedId}`);
      await conn.put({
        path: `/resources/${resourceId}/audits-masked/${auditId}/${maskedId}`,
        data: '{}'
      });
    });
  }
}

// Mask documents
function maskAudit(resourceId: string, auditId: string, audit: OadaAudit) {
  const link = `${TRELLIS_URL}/resouces/${resourceId}/audits/${auditId}`;
  audit['organization']['location']['link'] = link;
  const { hash } = signatures.hashJSON(audit);
  trace(`Audit ${auditId} hash: ${hash}`);
  audit['organization']['location'] = { hash, link };
  return audit;
}

// Instantiate service
const service = new JobQueue('trellis-cb', hashmap, {
  concurrency: 1,
  // TODO get url and token from config
  domain: TRELLIS_URL,
  token: TRELLIS_TOKEN
});

// Run service
(async () => {
  trace('Starting trellis-cb service');
  try {
    await service.start();
  } catch (e) {
    error('%O', e);
  }
})();
