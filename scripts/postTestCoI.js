import minimist from 'minimist'
import oada from '@oada/oada-cache';
import tsig from '@trellisfw/signatures';
import fs from 'fs';
const argv = minimist(process.argv.slice(2));
// 0: Look for our dummy vdoc: if there, use it, if not, create it
//   - create it means upload pdf and coi, link _meta/vdoc to parent
//   - also sign the coi (happens in testcoi() function at end)
// 1: post link in /bookmarks/trellisfw/documents
// 1: post link to the vdoc at /bookmarks/services/trellis-masker/jobs

(async () => {
process.env.NODE_TLS_REJECT_UNAUTHORIZED=0;
const token = argv.t || 'god'
let domain = argv.d || 'localhost'
if (!domain.match(/^https/)) domain = 'https://'+domain;
const keys = await tsig.keys.create();


const con = await oada.connect({domain,token,cache:false,websocket:false});

const vdocid = 'resources/TESTCOI11899-0f86-41f2-b0f5-125ee39a362c';
let vdoc = false;
await con.get({path: `/${vdocid}`})
.then(r => {
  console.log('Test resource exists already, using that one');
  vdoc = r.data;
}).catch(async e => {
  console.log('Test resource did not exist, creating');

  // Put pdf:
  const pdfid = await con.post({
    path: '/resources',
    data: fs.readFileSync('./Goomba.jpg'),
    headers: { 'content-type': 'image/jpeg' }
  }).then(r => r.headers['content-location'].slice(1))
  .catch(e => { throw new Error('Could not post the dummy file as the PDF to /resources.  Error was: '+e.message)}) // e is really big if you stringify it
  await con.put({
    path: `/${pdfid}/_meta/filename`,
    data: '"thefilename.pdf"',
    headers: { 'content-type': 'application/json' }
  }).catch(e => { throw new Error('Could not put up the _meta/name to the dummy pdf.  Error was: '+JSON.stringify(e,false,'  '))});
  console.log('Successfully posted test PDF, id is ', pdfid);

  // Put coi:
  const signed = await testcoi();
  const coiid= await con.post({
    path: '/resources',
    data: signed,
    headers: { 'content-type': 'application/vnd.trellisfw.coi.1+json' },
  }).then(r => r.headers['content-location'].slice(1))
  .catch(e => { throw new Error('Could not post the dummy coi to /resources.  Error was: '+JSON.stringify(e,false,'  ')) });
  console.log('Successfully posted test coi, id is', coiid);

  // Put vdoc:
  await con.put({
    path: `/${vdocid}`,
    data: {
      pdf: { _id: pdfid },
      cois: { 'abc123': { _id: coiid} },
    },
    headers: { 'content-type': 'application/vnd.trellisfw.vdoc.1+json' },
  }).catch(e => { throw new Error(`Could not PUT new vdoc to ${vdocid}, error was: `+JSON.stringify(e,false,'  ')) });
  vdoc = await con.get({path: `/${vdocid}`}).then(r => r.data);
  console.log('Successfully put new vdoc to ',vdocid);

  // Link children to parent vdoc
  await con.put({
    path: `/${pdfid}/_meta/vdoc`,
    data: { _id: vdocid },
    headers: { 'content-type': 'application/json' },
  }).catch(e => { throw new Error(`Could not put the vdoc link to pdf/_meta/vdoc, error was: `+JSON.stringify(e,false,'  ')) });
  console.log(`Successfully put link in pdf ${pdfid}/_meta/vdoc to ${vdocid}`);

  await con.put({
    path: `/${coiid}/_meta/vdoc`,
    data: { _id: vdocid },
    headers: { 'content-type': 'application/json' },
  }).catch(e => { throw new Error(`Could not put the vdoc link to coi ${coiid}/_meta/vdoc, error was: `+JSON.stringify(e,false,'  ')) });
  console.log(`Successfully put link in coi ${coiid}/_meta/vdoc to ${vdocid}`);

  // Put the vdoc into /trellisfw/documents 
  const bookmarkspath = `/bookmarks/trellisfw/documents/${vdocid.replace(/^resources\//,'')}`; // use same id as vdoc, just without the resources/ to simplify debugging
  const link = { _id: vdocid };
  console.log('PUT-ing document to ', bookmarkspath, ', data = ', link);
  await con.put({
    path: bookmarkspath, 
    data: link,
    headers: { 'content-type': 'application/vnd.trellisfw.documents.1+json' },
  }).catch(e => { throw new Error('Could not put the document link into /bookmarks/trellisfw/documents.  Error was: '+JSON.stringify(e,false,'  ')) });
});

console.log('Have vdoc now, posting job to queue');
const jobid = await con.post({
  path: '/bookmarks/services/trellis-masker/jobs',
  data: { _id: vdocid },
  headers: { 'content-type': 'application/vnd.oada.service.jobs.1+json' },
}).then(r => r.headers['content-location'].slice(1))
.catch(e => { throw new Error('FAILED to post new job!  Error was: '+JSON.stringify(e,false,'  ')) });
console.log('Posted job at path: ', jobid);


async function testcoi() {
  const coi = {
    "certificate": {
      "certnum": "CLE-999999999-01",
      "rev": "1",
      "docdate": "2019-04-11T00:00:00",
      "operate_desc": " Fake Food Co Customer and its majority owned Subsidiaries are included as Additional Insured (except Workers Compensation) where required by written cont",
      "file_name": "b436b7ca-a8e0-4ecd-9953-4867160a69ab.pdf"
    },
    "producer": {
      "name": "Grocery Store USA Inc.",
      "location": {
        "street_address": "123 Nowhere Lane",
        "postal_code": "99999",
        "city": "Philadelphia",
        "state": "PA",
        "country": "USA"
      }
    },
    "insured": {
      "name": "Fake Food Co",
      "location": {
        "street_address": "456 Nowhere Lane",
        "postal_code": "99999",
        "city": "Stockton",
        "state": "VA",
        "country": "USA"
      }
    },
    "holder": {
      "name": "Fake Food Co Customer",
      "location": {
        "street_address": "Po Box 1999",
        "postal_code": "99999",
        "city": "New York",
        "state": "NY",
        "country": "USA"
      }
    },
    "policies": {
      "ZZZY943423 11": {
        "number": "ZZZY943423 11",
        "effective_date": "2019-04-30T00:00:00",
        "expire_date": "2020-04-30T00:00:00"
      },
      "YYYY182182 03": {
        "number": "YYYY182182 03",
        "effective_date": "2019-04-30T00:00:00",
        "expire_date": "2020-04-30T00:00:00"
      },
      "GGH4448888 (SSS)": {
        "number": "GGH4448888 (SSS)",
        "effective_date": "2019-04-30T00:00:00",
        "expire_date": "2020-04-30T00:00:00"
      },
      "RT1425336 (AA)": { "number": "RT1425336 (AA)",
        "effective_date": "2019-04-30T00:00:00",
        "expire_date": "2020-04-30T00:00:00"
      }
    },
  }
  return await tsig.sign(coi, keys.private, { signer: { name: 'job poster', url: 'https://oatscenter.org' }, type: 'transcription' });
}

})();
