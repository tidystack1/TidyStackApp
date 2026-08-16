import { INTAKE_ELEMENT_IDS } from "./config";
import type {
  FileRef,
  LobbieAddress,
  LobbieAnswer,
  LobbieForm,
  LobbiePatient,
  MappedIntake,
} from "./types";

function answerByElement(
  answers: LobbieAnswer[],
  elementId: number,
): LobbieAnswer | undefined {
  return answers.find((answer) => answer.formElementId === elementId);
}

function answerText(answer: LobbieAnswer | undefined): string {
  if (!answer) return "";
  if (Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0) {
    return answer.selectedOptions.join(", ").trim();
  }
  if (answer.value == null) return "";
  return String(answer.value).trim();
}

function fileRef(answer: LobbieAnswer | undefined): FileRef | null {
  const path = answerText(answer);
  if (!path) return null;
  const fileName = path.split("/").pop() || path;
  return {
    fieldType: answer?.fieldType || "File",
    label: answer?.label || "",
    path,
    fileName,
  };
}

export function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, space).trim(),
    lastName: trimmed.slice(space + 1).trim(),
  };
}

export function formatAddress(address: LobbieAddress | null | undefined): string {
  if (!address) return "";
  return [address.line1, address.line2, address.city, address.stateRegion, address.postalCode]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

export function findIntakeForm(
  forms: LobbieForm[],
  templateId: number,
): LobbieForm | undefined {
  return forms.find((form) => form.formTemplateId === templateId);
}

export function isIntakeFormComplete(form: LobbieForm | undefined): boolean {
  if (!form) return false;
  if (form.isComplete === true) return true;
  return String(form.status || "").toUpperCase() === "COMPLETED";
}

export function mapIntakeFields(
  answers: LobbieAnswer[],
  patient?: LobbiePatient | null,
): MappedIntake {
  const guardian1 = splitFullName(
    answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.guardian1Name)),
  );
  const guardian2 = splitFullName(
    answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.guardian2Name)),
  );

  return {
    clientFirstName:
      answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.firstName)) ||
      patient?.firstName?.trim() ||
      "",
    clientLastName:
      answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.lastName)) ||
      patient?.lastName?.trim() ||
      "",
    dateOfBirth:
      answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.dateOfBirth)) ||
      patient?.dateOfBirth?.trim() ||
      "",
    gender:
      answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.gender)) ||
      patient?.gender?.trim() ||
      "",
    address:
      answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.fullAddress)) ||
      formatAddress(patient?.homeAddress) ||
      "",
    diagnosticReport: fileRef(
      answerByElement(answers, INTAKE_ELEMENT_IDS.diagnosticReport),
    ),
    insurance: answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.insurance)),
    memberId: answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.memberId)),
    insuranceCardFront: fileRef(
      answerByElement(answers, INTAKE_ELEMENT_IDS.insuranceCardFront),
    ),
    insuranceCardBack: fileRef(
      answerByElement(answers, INTAKE_ELEMENT_IDS.insuranceCardBack),
    ),
    guardian1FirstName: guardian1.firstName,
    guardian1LastName: guardian1.lastName,
    guardian1Email: answerText(
      answerByElement(answers, INTAKE_ELEMENT_IDS.guardian1Email),
    ),
    guardian1CellPhone: answerText(
      answerByElement(answers, INTAKE_ELEMENT_IDS.guardian1Cell),
    ),
    guardian2FirstName: guardian2.firstName,
    guardian2LastName: guardian2.lastName,
    guardian2Email: answerText(
      answerByElement(answers, INTAKE_ELEMENT_IDS.guardian2Email),
    ),
    guardian2CellPhone: answerText(
      answerByElement(answers, INTAKE_ELEMENT_IDS.guardian2Cell),
    ),
    emergencyContact: answerText(
      answerByElement(answers, INTAKE_ELEMENT_IDS.emergencyContact),
    ),
    primaryCarePhysician: answerText(
      answerByElement(answers, INTAKE_ELEMENT_IDS.primaryCarePhysician),
    ),
    pcpPhone: answerText(answerByElement(answers, INTAKE_ELEMENT_IDS.pcpPhone)),
  };
}
