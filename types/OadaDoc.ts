export interface OadaAudit {
  _type: string;
  certificationid: SourcedId;
  scheme: AuditScheme;
  organization: Organization;
  scope: Scope;
  score: Score;
  conditions_during_audit: AuditConditions;
  certificate_valitidy_period?: ValidityPeriod;
  certifying_body: {
    name: string;
    auditors: Auditor[];
  };
}

export interface OadaDocIds {
  [key: string]: OadaAudit;
}

interface SourcedId {
  id: string;
  id_source: string;
}

interface AuditScheme {
  name: string;
  edition: string;
}

interface Organization {
  name: string;
  organizationid: SourcedId;
  GLN?: string;
  companyid?: string;
  location: OadaLocation | OadaHash;
}

interface Scope {
  description: string;
  operation: Operation;
  products_observed: Name[];
}

interface Operation {
  operation_type: string;
  operator: Operator;
  shipper: Name;
  location: OadaLocation | OadaHash;
  name?: string;
}

interface AuditConditions {
  operation_observed_date: {
    start: string;
    end: string;
  };
}

interface Operator {
  contacts: Name[];
  name: string;
  location?: OadaLocation | OadaHash;
}

interface OadaLocation {
  postal_code: string;
  street_addr?: string;
  city: string;
  state: string;
  country: string;
  link?: string;
}

interface OadaHash {
  hash: string;
  link: string;
}

interface Score {
  preliminary?: {
    value: string;
    units: string;
  };
  final: {
    value: string;
    units: string;
  };
  rating?: string;
}

interface ValidityPeriod {
  start: string;
  end: string;
}

export interface Auditor {
  FName: string;
  LName: string;
  PersonNum: string;
  Role: string;
}

interface Name {
  name: string;
}
