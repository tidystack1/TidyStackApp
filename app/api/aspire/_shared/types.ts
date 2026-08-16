export type JsonObject = Record<string, unknown>;

export type LobbieAnswer = {
  formElementId: number;
  label?: string;
  fieldType?: string;
  attributeName?: string | null;
  value?: unknown;
  selectedOptions?: string[];
};

export type LobbieForm = {
  id: number;
  formTemplateId: number;
  formTemplateName?: string;
  isComplete?: boolean;
  status?: string;
  answers?: LobbieAnswer[];
};

export type LobbieFormPacket = {
  id: number;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string | null;
  formTemplateIds?: number[];
  isActive?: boolean;
  isArchived?: boolean;
  locationId?: number;
  locationName?: string;
  patientId?: number;
  patientName?: string;
};

export type LobbieAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  postalCode?: string | null;
};

export type LobbiePatient = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  email?: string | null;
  mobilePhone?: string | null;
  homeAddress?: LobbieAddress | null;
  mailingAddress?: LobbieAddress | null;
};

export type LobbieWebhookEnvelope = {
  version?: string;
  eventId?: string;
  eventType?: string;
  accountId?: number;
  environment?: string;
  occurredAt?: string;
  sentAt?: string;
  deliveryAttempt?: number;
  data?: JsonObject;
};

export type FileRef = {
  fieldType: string;
  label: string;
  path: string;
  fileName: string;
};

export type MappedIntake = {
  clientFirstName: string;
  clientLastName: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  diagnosticReport: FileRef | null;
  insurance: string;
  memberId: string;
  insuranceCardFront: FileRef | null;
  insuranceCardBack: FileRef | null;
  guardian1FirstName: string;
  guardian1LastName: string;
  guardian1Email: string;
  guardian1CellPhone: string;
  guardian2FirstName: string;
  guardian2LastName: string;
  guardian2Email: string;
  guardian2CellPhone: string;
  emergencyContact: string;
  primaryCarePhysician: string;
  pcpPhone: string;
};
