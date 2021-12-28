import fs from 'fs';
import querystring from 'querystring'; // this is built-in to node
import Promise from 'bluebird';
import _ from 'lodash';
import pdfjs from 'pdfjs';
import helvetica from 'pdfjs/font/Helvetica.js';
import helvetica_bold from 'pdfjs/font/Helvetica-Bold.js';
import courier from 'pdfjs/font/Courier.js';
import debug from 'debug';
import ml from '@trellisfw/masklink';
import tsig from '@trellisfw/signatures';
import jsonpointer from 'json-pointer';
import moment from 'moment';
import wrap from 'wrap-ansi';
import oada from '@oada/oada-cache';

import config from './config.js';

const error = debug('trellis-masker#pdfgen:error');
const warn = debug('trellis-masker#pdfgen:warn');
const info = debug('trellis-masker#pdfgen:info');
const trace = debug('trellis-masker#pdfgen:trace');


let DOMAIN = config.get('domain') || '';
if (!DOMAIN.match(/^http/)) DOMAIN = 'https://'+DOMAIN;
if (DOMAIN === 'https://localhost') {
  DOMAIN = 'http://http-handler';
}

// Read in any images or other files for the PDF
const logo = new pdfjs.Image(fs.readFileSync('./pdf-assets/logo-masklink-green.jpg'));

// Give this thing the actual vdoc, not the ID to it.  It will return a link to the new PDF which you 
// can then put in newvdoc.pdf as newvdoc.pdf = makeAndPostPdfFromMaskedVdoc()
// You have to pass the domain and token because the default oada con websocket can't send
// binary data.  Therefore, we have to make a new connection to the same place with websocket off.
async function makeAndPostPdfFromMaskedVdoc({vdoc, con, domain, token}) {
  try {
    let maskedResources = [];
    if (vdoc.audits) {
      trace('Found audits, adding to maskedResources');
      maskedResources = maskedResources.concat(
        await Promise.map(_.keys(vdoc.audits), linkkey => Promise.props({ 
          type: 'audit',
          resourcePath: vdoc.audits[linkkey]._id,
          resource: con.get({path: `/${vdoc.audits[linkkey]._id}`}).then(r=>r.data),
        }))
      );
    }
    if (vdoc.cois) {
      trace('Found cois, adding to maskedResources');
      maskedResources = maskedResources.concat(
        await Promise.map(_.keys(vdoc.cois), linkkey => Promise.props({ 
          type: 'coi',
          resourcePath: vdoc.cois[linkkey]._id,
          resource: con.get({path: `/${vdoc.cois[linkkey]._id}`}).then(r=>r.data),
        }))
      );
    }
    trace('Have a total of '+maskedResources.length+' to add to PDF');
  
    const doc = new pdfjs.Document({
      font: helvetica,
      padding: 10,
      lineHeight: 1.2,
    });
    doc.info.creationDate = new Date();
    doc.info.producer = "Trellis-Masker from The Trellis Framework (https://github.com/trellisfw) hosted by the OATS Center (https://oatscenter.org) at Purdue University";
    trace('PDF object created, creator info is set.  Creating header:');
  
    // From: http://pdfjs.rkusa.st/
  
    //-------------------
    // The header:
    const header = doc.header()
      .table({widths: [null,null], paddingBottom: 1.0*pdfjs.cm}).row();
    header.cell().image(logo, { height: 2*pdfjs.cm })
    header.cell().text({textAlign: 'right' })
      .add('Trellis - Mask & Link\n', { fontSize: 14, font: helvetica_bold })
      .text({textAlign: 'right'})
      .add('A masked document shielding confidential information\n')
      .add('https://github.com/trellisfw', {
        link: 'https://github.com/trellisfw',
        underline: true,
        color: '0x569cd6',
      });
    trace('Header created, creating each masked resource');
  
    _.each(maskedResources, r => {
      trace('Pulling data for '+r.type+', resourceid'+r.resourcePath);
      const data = pullData(r);
      trace('Got this data for r: ', data);
  
      doc.cell({ paddingBottom: 0.5*pdfjs.cm })
        .text(data.title, { fontSize: 16, font: helvetica_bold });
  
      const resTable = doc.table({
        widths: [ 4.0*pdfjs.cm, null ],
        borderHorizontalWidths: function (i) { return 1 },
        padding: 5,
      });
  
      function addRow({key, val, mask}) {
        trace(`Adding row for resource. key = ${key}`);
        const tr = resTable.row();
        tr.cell().text(key);
        if (mask) {
          trace(`Adding mask row for key ${key}  mask = ${mask}`);
          tr.cell()
            .text('< MASKED >')
            .text('If you have permission, click here to verify', { 
              link: 'https://trellisfw.github.io/reagan?trellis-mask='+querystring.escape(JSON.stringify(mask['trellis-mask'])),
              underline: true,
              color: "0x569cd6",
            });
        } else if (val) {
          trace(`Adding val to row for key ${key}  val = ${mask}`);
          tr.cell(val);
        }
      }
      _.each(data.rows, addRow);
  
    });

    trace('Finished adding tables, now adding json');
    // And, in the final pages, add the actual JSON with the signatures
    _.each(maskedResources, r => {
      doc.cell().pageBreak();
      const data = pullData(r);
      const clean = _.cloneDeep(r.resource);
      if (clean._id) delete clean._id;
      if (clean._rev) delete clean._rev;
      if (clean._meta) delete clean._meta;
      if (clean._type) delete clean._type;
  
      doc.cell({ paddingBottom: 0.5*pdfjs.cm})
        .text(data.title+' - Full Signature and Data')
        .text('Click here to verify full resource if you have permission to it', {
          link: 'https://trellisfw.github.io/reagan?masked-resource-url='+querystring.escape(`${DOMAIN}/${r.resourcePath}`),
          underline: true,
          color: "0x569cd6",
        });
  
      doc.cell({ paddingBottom: 0.5*pdfjs.cm, font: courier })
        .text(wrap(JSON.stringify(clean,false,'  '), 80, { hard: true, trim: false }));
    });
    trace('Done adding things to PDF, sending to OADA');
    
  
    // Done!  Now get that as a buffer and POST to OADA, return link for vdoc
    const docbuf = await doc.asBuffer();

    // POST to /resources
    // content-type: application/pdf
    const binary_connection = await oada.connect({domain,token,cache: false, websocket: false});
    const pdfid = await binary_connection.post({
      path: '/resources',
      data: docbuf,
      headers: { 'content-type': 'application/pdf' },
    }).then(r=>r.headers['content-location'].slice(1))
    .catch(e => { throw new Error('ERROR: failed to POST new PDF of masked vdoc to /resources.  Error was: '+JSON.stringify(e)); });
    trace('Finished creating and POSTing new PDF, returning ID ('+pdfid+') for the vdoc to link to');
  
    return { _id: pdfid };
  } catch(e) {
    error('FAILED to create pdf.  Error was: ', e);
  }
}


function pullData(r) {
  let data = { 
    title: 'Unknown Document Type', 
    rows: [ { key: 'Unknown', value: 'Unrecognized Document' } ] 
  };
  if (r.type === 'audit') data = pullAuditData(r.resource);
  if (r.type === 'coi')   data = pullCoIData(r.resource);
  return data;
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function pullAuditData(audit) {
  let validity = null;
  if (audit.certificate_validity_period && audit.certificate_validity_period.start && audit.certificate_validity_period.end) {
    validity = {
      start: moment(audit.certificate_validity_period.start, 'M/D/YYYY'),
      end: moment(audit.certificate_validity_period.end, 'M/D/YYYY'),
    }
    if (!validity.start || !validity.start.isValid()) validity = null;
    if (!validity.end || !validity.end.isValid()) validity = null;
    const now = moment();
    // If it starts after today, or ended before today, it's expired
    validity.expired = validity.start.isAfter(now) || validity.end.isBefore(now);
  }
  const org = (audit.organization && audit.organization.name) || null;
  const score = audit.score && audit.score.final ? audit.score.final.value : false;
  const scope = audit.scope && audit.scope.products_observed ? 
    _.join(_.map(audit.scope.products_observed, p => p.name), ', ') : false;

  const ret = {
    title: 'FSQA Audit: '+(org?org:''),
    rows: []
  };
  if (org)   ret.rows.push({ key: 'Organization:', val: org });
  if (score) ret.rows.push({ key: 'Score:', val: score });
  if (scope) ret.rows.push({ key: 'Scope:', val: scope });
  if (validity) ret.rows.push( { key: 'Validity:', 
    val: validity.start.format('MMM d, YYYY')+' to '+validity.end.format('MMM d, YYYY') 
  })
  // Add all masked things
  const paths = ml.findAllMaskPathsInResource(audit);
  _.each(paths, p => {
    const mask = jsonpointer.get(audit,p);
    const label = _.join(
      _.map(
        jsonpointer.parse(p), 
        word => capitalizeFirstLetter(word)
      ), ' '
    );
    ret.rows.push({ key: label, mask });
  });
  return ret;
}

function pullCoIData(coi) {
  const producer = (coi && coi.producer && coi.producer.name) || null;
  const holder = (coi.holder && coi.holder.name) || null;
  let policies = coi.policies || null; // COI has policies
  // Filter policies whose dates we can't parse
  policies = policies && _.filter(policies, p => {
    p.start = moment(p.effective_date);
    p.end = moment(p.expire_date);
    if (!p.start.isValid())  return false;
    if (!p.end.isValid()) return false;
    const now = moment();
    p.expired = p.start.isAfter(now) || p.end.isBefore(now);
    return true; // keep this one in the list
  });

  const ret = {
    title: 'Certificate of Insurance: '+(producer?producer:''),
    rows: []
  };
  if (producer) ret.rows.push({ key: 'Producer', val: producer });
  if (holder)   ret.rows.push({ key: 'Holder', val: holder });
  _.each(policies, p => {
    ret.rows.push({ key: `Policy ${p.number}:`, 
      val: p.start.format('MMM d, YYYY')+' to '+p.end.format('MMM d, YYYY') })
  });
  const paths = ml.findAllMaskPathsInResource(coi);
  _.each(paths, p => {
    const mask = jsonpointer.get(coi,p);
    const label = _.join(
      _.map(
        jsonpointer.parse(p), 
        word => capitalizeFirstLetter(word)
      ), ' '
    );
    ret.rows.push({ key: label, mask });
  });
  return ret;
}

export default makeAndPostPdfFromMaskedVdoc;
