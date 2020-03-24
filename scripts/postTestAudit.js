import minimist from 'minimist'
import oada from '@oada/oada-cache';
import tsig from '@trellisfw/signatures';
import fs from 'fs';
const argv = minimist(process.argv.slice(2));
// 0: Look for our dummy vdoc: if there, use it, if not, create it
//   - create it means upload pdf and audit, link _meta/vdoc to parent
//   - also sign the audit (happens in testaudit() function at end)
// 1: post link in /bookmarks/trellisfw/documents
// 1: post link to the vdoc at /bookmarks/services/trellis-masker/jobs

(async () => {
process.env.NODE_TLS_REJECT_UNAUTHORIZED=0;
const token = argv.t || 'god'
let domain = argv.d || 'localhost'
if (!domain.match(/^https/)) domain = 'https://'+domain;
const keys = await tsig.keys.create();


const con = await oada.connect({domain,token,cache:false,websocket:false});

const vdocid = 'resources/TEST3e7a61ff-0f86-41f2-b0f5-125ee39a362c';
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

  // Put audit:
  const signed = await testaudit();
  const auditid = await con.post({
    path: '/resources',
    data: signed,
    headers: { 'content-type': 'application/vnd.trellisfw.audit.sqfi.1+json' },
  }).then(r => r.headers['content-location'].slice(1))
  .catch(e => { throw new Error('Could not post the dummy audit to /resources.  Error was: '+JSON.stringify(e,false,'  ')) });
  console.log('Successfully posted test audit, id is', auditid);

  // Put vdoc:
  await con.put({
    path: `/${vdocid}`,
    data: {
      pdf: { _id: pdfid },
      audits: { 'abc123': { _id: auditid } },
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
    path: `/${auditid}/_meta/vdoc`,
    data: { _id: vdocid },
    headers: { 'content-type': 'application/json' },
  }).catch(e => { throw new Error(`Could not put the vdoc link to audit ${auditid}/_meta/vdoc, error was: `+JSON.stringify(e,false,'  ')) });
  console.log(`Successfully put link in audit ${auditid}/_meta/vdoc to ${vdocid}`);

  // Put the vdoc into /trellisfw/documents 
  const bookmarkspath = `/bookmarks/trellisfw/documents/${vdocid.replace(/^resources\//,'')}`; // use same id as vdoc, just without the resources/ to simplify debugging
  const link = { _id: vdocid, _rev: 1 };
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


async function testaudit() {
  const audit = {
    "certificationid": { "id_source": "certifying_body", "id": "987" },
    "auditid": { "id_source": "certifying_body", "id": "123" },
    "scheme": { "name": "SQFI", "edition": "8.0", "audit_reference_number": "111111" },
    "certifying_body": {
      "name": "Mrieux NutriSciences Certification",
      "auditors": [
        { "FName": "Bob", "LName": "TheAuditGuy", "PersonNum": "2222", "Role": "Lead Auditor" },
      ]
    },
    "organization": {
      "organizationid": { "id_source": "certifying_body", "id": "10138" },
      "GLN": "123456789012",
      "name": "Fake Food Co. - Tallahasee",
      "companyid": "55555",
      "contacts": [ { "name": "" } ],
      "location": {
        "street_address": "123 Nowhere St.",
        "postal_code": "98765",
        "city": "Talahasse",
        "state": "FL",
        "country": "United States"
      },
      "phone": ""
    },
    "scope": {
      "description": "Pickles, Bread, Bacon",
      "operation": {
        "operation_type": "",
        "operator": {
          "contacts": [ { "name": "" } ],
          "name": "Fake Food Co. (12345)"
        },
        "shipper": { "name": "" },
        "location": {
          "address": "",
          "city": "",
          "state": "",
          "postal_code": "",
          "country": ""
        }
      },
      "products_observed": [
        { "name": "Pickles" },
        { "name": "Bread" },
        { "name": "Bacon" },
      ]
    },
    "conditions_during_audit": {
      "operation_observed_date": {
        "start": "2019-04-03T00:00:00",
        "end": "2019-04-05T00:00:00"
      }
    },
    "score": {
      "final": { "value": "95", "units": "%" },
      "rating": "Good"
    },
    "certificate_validity_period": {
      "start": "5/29/2019",
      "end": "6/5/2020"
    },
  };
  return await tsig.sign(audit, keys.private, { signer: { name: 'job poster', url: 'https://oatscenter.org' }, type: 'transcription' });
}

})();
