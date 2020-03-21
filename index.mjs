import fs from 'fs';
import Promise from 'bluebird';
import _ from 'lodash'; // Lazy, lodash isn't really needed anymore
import pdfjs from 'pdfjs';
import debug from 'debug';
import { JobQueue } from '@oada/oada-jobs';
import ml from '@trellisfw/masklink';
import tsig from '@trellisfw/signatures';
import uuid from 'uuid';
import jsonpointer from 'json-pointer';

import config from './config.js';

const error = debug('trellis-masker:error');
const warn = debug('trellis-masker:warn');
const info = debug('trellis-masker:info');
const trace = debug('trellis-masker:trace');

const TOKEN = config.get('token');
let DOMAIN = config.get('domain') || '';
if (!DOMAIN.match(/^http/)) DOMAIN = 'https://'+DOMAIN;
if (DOMAIN === 'https://localhost') {
  DOMAIN = 'http://http-handler';
}


// You can generate a signing key pair by running `oada-certs --create-keys`
const privateJWK = JSON.parse(fs.readFileSync(config.get('privateJWK')));
const publicJWK = tsig.keys.pubFromPriv(privateJWK);
const header = { jwk: publicJWK };
if (privateJWK.jku) header.jku = privateJWK.jku; // make sure we keep jku and kid
if (privateJWK.kid) header.kid = privateJWK.kid;
const signer = config.get('signer');
const type = config.get('signatureType');


const VDOC_KEYS_TO_IGNORE = { unmask: true, masks: true, pdf: true }; // these are vdocs that interlink, not things inside vdocs.
const KEYS_TO_MASK = [ 'location' ]; // searches recursively for the appearance of this key anywhere in any json doc

const service = new JobQueue('trellis-masker', jobCallback, {
  concurrency: 1,
  domain: DOMAIN,
  token: TOKEN
});

//-------------------------------------------------------
// Main job queue callback:
async function jobCallback(id, task, con) {
  const respath = `/resources/${id}`;

  const unmasked_vdoc = await con.get({path: respath}).then(r => r.data)
    .catch(e => { throw new Error(`Could not get ${respath}.  Error was: ${e.toString()}`) });

  if (!unmasked_vdoc) throw new Error(`Retrieved unmasked vdoc resource was falsey`);

  const keys = _.keys(unmasked_vdoc).filter(k => {
    if (k.match(/^_/)) return false; // no oada keys
    if (VDOC_KEYS_TO_IGNORE[k]) return false; // no masks, unmask, pdf
    return true;
  });
  // This should only leave audits, cois as of the time of writing this
  trace('Retrieved unmasked resource, I am going to search for mask opportunities under these vdoc keys: ', keys);

  // Plan:
  // 0: for all audits or cois
  // 1: look for the key "location" paths anywhere in document
  // 2: mask&sign all location paths in document as a new resource
  // 3: create a new pdf from the masked audit or coi: name in _meta is same as unmasked pdf meta name
  // 4: create a new vdoc for this masked version, link audit/coi link at appropriate key, link pdf, link unmask
  // 5: link the audit/coi mask and pdf back to their corresponding vdoc instead of relying on oada-ensure
  // 6: create the masks link in original to point to new vdoc

  const newvdoc = {
    // will add audits, cois, pdf below
    unmask: { _id: unmasked_vdoc._id }
  };
  function findPathsToMask(obj,previouspath) {
    const jp = jsonpointer.parse(previouspath);
    return _.reduce(_.keys(obj), (acc,k) => {
      const curpath = jsonpointer.compile([...jp, k]);
      if (_.includes(KEYS_TO_MASK, k)) {
        acc.push(curpath);
        return acc;
      }
      if (typeof obj[k] === 'object') {
        // recursively keep looking for paths
        return acc.concat(findPathsToMask(obj[k], curpath));
      }
      return acc;
    }, []);
  }
  // This function runs once for every key in vdoc that is not ignored.
  // It looks for links, and when it finds one, it loads it to find the mask paths.
  async function maskALink(key,obj,previouspath) {
    if (typeof obj !== 'object') return [];
    let masked_link_paths = [];

    const jp = jsonpointer.parse(previouspath);
    const curpath = jsonpointer.compile([...jp,key]);
    const link = obj[key];
    if (!link._id) { // it's not a link, so assume is a list of stuff
      masked_link_paths = await Promise.reduce(_.keys(obj[key]), async (acc, k) => {
        return acc.concat(await maskALink(k, obj[key], curpath));
      },[]); // recursively call ourself until we find links
    } else {
      // Otherwise, it is a link so we need to find all the paths with any of the keys that we need to mask
      const maskresmeta = await con.get({ path: `/${link._id}/_meta` }).then(r=>r.data)
        .catch(e => { throw new Error(`${respath}: failed to retrieve meta of resourece link at path ${curpath} with link._id ${link._id}.  Error was: `+JSON.stringify(e,false,'  ')) });
      if (!maskresmeta || !maskresmeta._type || !maskresmeta._type.match(/json$/)) {
        throw new Error(`${respath}: attempted to mask resource at link ${link._id} from vdoc path ${curpath}, but it's _meta/_type did not end in json.  We can only mask json types!`);
      }

      const restomask = await con.get({ path: `/${link._id}` }).then(r => r.data)
        .catch(e => { throw new Error(`${respath}: Failed to retrieve resource link at path ${curpath} with link._id = ${link._id}.  Error was: `+JSON.stringify(e,false,'  ')); });
      
      const paths = findPathsToMask(restomask,'');
      trace(`#maskALink: searched vdoc key ${key} resource for possible paths to mask, result is`, paths);

      const maskid = await ml.maskAndSignRemoteResourceAsNewResource({
        url: `${DOMAIN}/${restomask._id}`, 
        privateJWK,
        signer,
        connection: con,
        paths
      }).catch(e => { throw new Error(`#maskALink: Failed to maskAndSignRemoteResourceAsNewResource for url ${domain}/${restomask._id}.  Error was: `+JSON.stringify(e,false,'  ')); });
      trace(`#maskALink: successfully created mask resource for ${DOMAIN}/${restomask._id} as new resource id ${maskid}`);

      // Put a link to this new masked thing at the same place in the newvdoc as it was in the unmasked one:
      trace(`#maskALink: putting link to new mask into new vdoc at same place as original: ${curpath} => { _id: ${maskid} }`);
      jsonpointer.set(newvdoc,curpath,{ _id: maskid });
      // Keep track of all the things that were masked for later in case that is useful
      masked_link_paths.push({ path: curpath, maskid, maskedpaths: paths });
    }

    return masked_link_paths;
  }
  // For all the keys on the document that we're not supposed to ignore, 
  // get each link, find any paths to mask, and make a new mask resource for that one.
  const masked_link_paths = await Promise.reduce(keys, async (acc, k) => {
    return acc.concat(await maskALink(k,unmasked_vdoc,''));
  },[]);
  newvdoc['masked-link-paths'] = masked_link_paths;
  newvdoc['masked-keys-list'] = KEYS_TO_MASK;
  info(`Finished creating mask resources.  Made a masked version of the following paths: `, masked_link_paths);
  
  // Now, we need to create a PDF document for the new vdoc
  error(`------>>>>>>> DO NOT FORGET <<<<<<<<<<<<<-------------: You are not making a new PDF yet, you just linked the old one`);
  newvdoc.pdf = makeAndPostPdfFromMaskedVdoc(newvdoc);

  // POST the new vdoc to /resources:
  const newvdocid = await con.post({
    path: '/resources',
    data: newvdoc,
    headers: { 'content-type': 'application/vnd.trellisfw.vdoc.1+json' },
  }).then(r=>r.headers['content-location'].slice(1))
  .catch(e => { throw new Error('Failed to POST new vdoc to /resources.  Error was: '+JSON.stringify(e,false,'  ')); });
  trace(`Successfully posted new vdoc to /resources at id ${newvdocid}`);

  // Put up the new vdoc to /bookmarks/trellisfw/documents
  const newvdocid_indocuments = await con.post({
    path: '/bookmarks/trellisfw/documents',
    data: { _id: newvdocid },
    headers: { 'content-type': 'application/vnd.trellisfw.vdoc.1+json' },
  }).then(r=>r.headers['content-location'].slice(1))
  .catch(e => { throw new Error(`${respath}: could not post new masked vdoc to /bookmarks/trellisfw/documents.  Error was: `+JSON.stringify(e,false,'  ')) });
  trace(`Posted link to new masked vdoc to id ${newvdocid} under /bookmarks/trellisfw/documents, content-location was: ${newvdocid_indocuments}`);

  // POST a link to new vdoc under the masks key for the unmasked_vdoc
  const masks_key_in_parent = await con.post({
    path: `${respath}/masks`,
    data: { _id: newvdocid },
    headers: { 'content-type': 'application/vnd.trellisfw.vdoc.1+json' },
  }).then(r=>r.headers['content-location'].slice(1))
  .catch(e => { throw new Error(`${respath}: could not post link ({ _id: ${newvdocid} }) to new masked vdoc into parent under masks.  Error was: `+JSON.stringify(e,false,'  ')) });
  trace(`Posted link to new masked resource under parent\'s masks, content-location was: ${masks_key_in_parent}`)

  // DONE!
  info(`Succesfully masked the following resources for resource ${respath}: `,masked_link_paths);
  return { success: true };
}


// Give this thing the actual vdoc, not the ID to it.  It will return a link to the new PDF which you 
// can then put in newvdoc.pdf as newvdoc.pdf = makeAndPostPdfFromMaskedVdoc()
function makeAndPostPdfFromMaskedVdoc(vdocvdoc) {
 
  

  return { _id: pdfid };
}

(async () => {
  try {
    await service.start();
  } catch (e) {
    console.error(e);
  }
})();
