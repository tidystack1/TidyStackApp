import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  isForaBooking,
  isNetRateForm,
  isNetRateWithCcFeeForm,
  isPublishedRateTicketingFeeForm,
  str,
  type FormData,
} from "./pdf-builder";

const FS_MAX_PASSENGERS = 9;
const FS_LABEL_FILL = "EEEEEE";
const FS_SECTION_FILL = "EEEEEE";
const FS_META_FILL = "F2F2F2";
const FS_BORDER_COLOR = "333333";
const FS_FONT = "Calibri";

function currency(value: string): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return value || "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function present(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "0" && trimmed !== "0.00";
}

function inferPassengerCount(data: FormData): number {
  const explicit = parseInt(str(data, "Number of passengers") || "0", 10);
  if (!Number.isNaN(explicit) && explicit > 0) return explicit;

  let max = 0;
  const re = /^Passenger (\d+)\s/;
  for (const key of Object.keys(data)) {
    const m = key.match(re);
    if (!m) continue;
    const n = parseInt(m[1] ?? "0", 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

const dottedBorder = {
  style: BorderStyle.DOTTED,
  size: 4,
  color: FS_BORDER_COLOR,
};

const solidBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: FS_BORDER_COLOR,
};

function textRuns(text: string, bold = false): TextRun[] {
  const lines = text.split(/\r?\n/);
  const runs: TextRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(
      new TextRun({
        text: lines[i] ?? "",
        font: FS_FONT,
        size: 22,
        bold,
        color: FS_BORDER_COLOR,
      }),
    );
  }
  if (runs.length === 0) {
    runs.push(
      new TextRun({
        text: "",
        font: FS_FONT,
        size: 22,
        bold,
        color: FS_BORDER_COLOR,
      }),
    );
  }
  return runs;
}

function metaParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    border: {
      top: dottedBorder,
      bottom: dottedBorder,
      left: dottedBorder,
      right: dottedBorder,
    },
    shading: { type: ShadingType.CLEAR, fill: FS_META_FILL },
    children: [
      new TextRun({
        text: `${label}: `,
        font: FS_FONT,
        size: 20,
        bold: true,
        color: FS_BORDER_COLOR,
      }),
      new TextRun({
        text: value,
        font: FS_FONT,
        size: 20,
        color: FS_BORDER_COLOR,
      }),
    ],
  });
}

function sectionParagraph(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: {
      top: dottedBorder,
      bottom: dottedBorder,
      left: dottedBorder,
      right: dottedBorder,
    },
    shading: { type: ShadingType.CLEAR, fill: FS_SECTION_FILL },
    children: [
      new TextRun({
        text: title.toUpperCase(),
        font: FS_FONT,
        size: 28,
        bold: true,
        color: FS_BORDER_COLOR,
      }),
    ],
  });
}

function fieldRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 28, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: FS_LABEL_FILL },
        borders: {
          top: solidBorder,
          bottom: solidBorder,
          left: solidBorder,
          right: solidBorder,
        },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: textRuns(label, true),
          }),
        ],
      }),
      new TableCell({
        width: { size: 72, type: WidthType.PERCENTAGE },
        borders: {
          top: solidBorder,
          bottom: solidBorder,
          left: solidBorder,
          right: solidBorder,
        },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: textRuns(value || "—"),
          }),
        ],
      }),
    ],
  });
}

function fieldTable(rows: { label: string; value: string }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r) => fieldRow(r.label, r.value)),
  });
}

/** Formstack-style submission DOCX (gray cells, dotted borders) for HubSpot `form_result_word_doc`. */
export async function buildFormstackDefaultDataStyleDocx(
  data: FormData,
): Promise<Uint8Array> {
  const isFora = isForaBooking(data);
  const numPassengers = inferPassengerCount(data);
  const amountOfDeals = parseInt(
    str(data, "Amount of deals on contact") || "0",
    10,
  );
  const mailingAddressSame =
    str(
      data,
      "Is the mailing address for commission check the same as the agency address?",
    ) === "YES";
  const checkPayableSame =
    str(
      data,
      "Is the commission's check payable name the same as the agency name?",
    ) === "YES";

  const browser = str(data, "Browser");
  const ip = str(data, "IP Address");
  const location = str(data, "Location");

  const children: (Paragraph | Table)[] = [];

  const metaEntries: { label: string; value: string }[] = [];
  if (browser) metaEntries.push({ label: "Browser", value: browser });
  if (ip) metaEntries.push({ label: "IP Address", value: ip });
  if (location) metaEntries.push({ label: "Location", value: location });
  for (const entry of metaEntries) {
    children.push(metaParagraph(entry.label, entry.value));
  }

  const agentRows: { label: string; value: string }[] = [
    { label: "HubSpot Deal ID", value: str(data, "HubSpot Deal ID") },
    { label: "HubSpot Deal Name", value: str(data, "HubSpot Deal Name") },
    {
      label: "Amount of deals on contact",
      value: str(data, "Amount of deals on contact"),
    },
    { label: "Form Type", value: str(data, "Form Type") },
    { label: "Agent Name", value: str(data, "Agent Name") },
    { label: "Agency Name", value: str(data, "Agency Name") },
    { label: "Email", value: str(data, "Email") },
  ];
  if (amountOfDeals === 1) {
    const agencyAddr = str(data, "Please provide your agency address");
    if (agencyAddr)
      agentRows.push({
        label: "Please provide your agency address",
        value: agencyAddr,
      });
  }
  agentRows.push(
    {
      label:
        "Is the mailing address for commission check the same as the agency address?",
      value: str(
        data,
        "Is the mailing address for commission check the same as the agency address?",
      ),
    },
    {
      label:
        "Is the commission's check payable name the same as the agency name?",
      value: str(
        data,
        "Is the commission's check payable name the same as the agency name?",
      ),
    },
  );
  if (!mailingAddressSame) {
    const mailingAddr = str(data, "Mailing Address");
    if (mailingAddr)
      agentRows.push({ label: "Mailing Address", value: mailingAddr });
  }
  if (!checkPayableSame) {
    const checkPayable = str(data, "Check Payable to");
    if (checkPayable)
      agentRows.push({ label: "Check Payable to", value: checkPayable });
  }

  children.push(sectionParagraph("AGENT INFO"));
  children.push(fieldTable(agentRows));

  children.push(sectionParagraph("PAYMENT INFO"));
  const paymentRows: { label: string; value: string }[] = [
    { label: "Form of payment", value: str(data, "Form of payment") },
    {
      label: "Number of passengers",
      value: str(data, "Number of passengers"),
    },
  ];
  if (isPublishedRateTicketingFeeForm(data)) {
    const feePayment = str(data, "How will you pay the fee?");
    if (present(feePayment)) {
      paymentRows.push({
        label: "How will you pay the fee?",
        value: feePayment,
      });
    }
  }
  children.push(fieldTable(paymentRows));

  for (let i = 1; i <= FS_MAX_PASSENGERS; i++) {
    children.push(sectionParagraph(`PASSENGER ${i} INFO`));
    const passengerRows: { label: string; value: string }[] = [];
    if (i <= numPassengers) {
      const name = str(data, `Passenger ${i} Name`);
      if (name)
        passengerRows.push({ label: `Passenger Name ${i}`, value: name });
      const seat = str(data, `Passenger ${i} Seat Preference`);
      const ff = str(data, `Passenger ${i} Frequent Flyer #`);
      const kt = str(data, `Passenger ${i} Known Traveler #`);
      const airline = str(data, `Passenger ${i} Airline`);
      const special = str(data, `Passenger ${i} Special Requests`);
      if (seat) passengerRows.push({ label: "Seat Preference", value: seat });
      if (ff) passengerRows.push({ label: "Frequent Flyer #", value: ff });
      if (kt) passengerRows.push({ label: "Known Traveler #", value: kt });
      if (airline) passengerRows.push({ label: "Airline", value: airline });
      if (special)
        passengerRows.push({ label: "Special Requests", value: special });
    }
    if (passengerRows.length > 0) {
      children.push(fieldTable(passengerRows));
    }
  }

  const reservationRows: { label: string; value: string }[] = [];
  const reservationDetails = str(data, "Reservation Details");
  const penalties = str(data, "Penalties");
  if (reservationDetails)
    reservationRows.push({
      label: "Reservation Details",
      value: reservationDetails,
    });
  if (penalties)
    reservationRows.push({ label: "Penalties", value: penalties });

  children.push(sectionParagraph("RESERVATION INFO"));
  if (reservationRows.length > 0) {
    children.push(fieldTable(reservationRows));
  }

  const fareRows: { label: string; value: string }[] = [];
  const ratePerPerson = str(data, "RATE PER PERSON");
  const basePerPerson = str(data, "Base Per Person");
  const issuingFee = str(data, "Issuing Fee");
  const commissionPP = str(data, "+ COMMISSION PP");
  const taxesAndFees = str(data, "Taxes and Fees Per Person");
  const totalPerPerson = str(data, "Total Per Person");
  const total = str(data, "Total");
  const ccFee = str(data, "+ 3.5% CC FEE (NON-REFUNDABLE)");
  const totalAuthorized = str(data, "= TOTAL AUTHORIZED TO CHARGE PP*");

  if (present(ratePerPerson))
    fareRows.push({ label: "RATE PER PERSON", value: currency(ratePerPerson) });
  if (isFora && present(basePerPerson))
    fareRows.push({
      label: "Base Per Person",
      value: currency(basePerPerson),
    });
  if (isFora && present(taxesAndFees))
    fareRows.push({
      label: "Taxes and Fees Per Person",
      value: currency(taxesAndFees),
    });
  if (present(issuingFee))
    fareRows.push({ label: "Issuing Fee", value: currency(issuingFee) });
  if (present(commissionPP))
    fareRows.push({ label: "+ COMMISSION PP", value: currency(commissionPP) });
  if (present(totalPerPerson))
    fareRows.push({
      label: "Total Per Person",
      value: currency(totalPerPerson),
    });
  if (present(ccFee))
    fareRows.push({
      label: "+ 3.5% CC FEE (NON-REFUNDABLE)",
      value: currency(ccFee),
    });
  if (isNetRateWithCcFeeForm(data) && present(totalAuthorized))
    fareRows.push({
      label: "= TOTAL AUTHORIZED TO CHARGE PP*",
      value: currency(totalAuthorized),
    });
  if (isNetRateForm(data) && present(total))
    fareRows.push({ label: "Total", value: currency(total) });

  children.push(sectionParagraph("FARE BREAKDOWN"));
  children.push(fieldTable(fareRows));

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
