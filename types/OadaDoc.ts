export interface OadaDoc {
  _type: string;
  certificationid: SourcedId;
  scheme: AuditScheme;
  organization: Organization;
  scope: Scope;
  score: Score;
  conditions_during_audit: {
    start: string;
    end: string;
  };
  certificate_valitidy_period: ValidityPeriod;
  certifying_body: {
    name: string;
    auditors: Auditor[];
  };
}

export interface OadaDocIds {
  [key: string]: OadaDoc
}

interface SourcedId {
  id: string;
  id_source: string,
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
  location: OadaLocation;
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
  location: OadaLocation;
  name?: string;
}

interface Operator {
  contacts: Name[];
  name: string;
  location?: OadaLocation;
}

interface OadaLocation {
  postal_code: string;
  street_addr?: string;
  city: string;
  state: string;
  country: string;
}

interface Score {
  preliminary: {
    value: string;
    units: string;
  };
  final: {
    value: string;
    units: string;
  };
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

