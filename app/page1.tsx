import Link from "next/link";

export default function Home() {
  return (
    <div>
      <Link href="/playground/cchealthcare/mileageReimbursement">
        Mileage Reimbursement
      </Link>
      <br />
      <Link href="/playground/cchealthcare/expenseReimbursment">
        Expense Reimbursement
      </Link>
      <br />
      <Link href="/playground/cchealthcare/pettyCash">Petty Cash</Link>
      <br />
    </div>
  );
}
