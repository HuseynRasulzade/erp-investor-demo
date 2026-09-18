import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../api/client';
import type { BankAccount, Counterparty, Currency } from '../../api/types';
import { useOrganization } from '../../context/OrganizationContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface PaymentRequest {
  id: string;
  number: string | null;
  requestDate: string;
  paymentCategory: string;
  counterpartyId: string | null;
  currencyId: string;
  requestedAmount: string;
  approvedAmount: string;
  paymentPurpose: string | null;
  status: string;
  approvalStatus: string;
}

interface PaymentInstruction {
  id: string;
  number: string | null;
  paymentRequestId: string;
  bankAccountId: string;
  counterpartyBankAccountId: string | null;
  amount: string;
  currencyId: string;
  status: string;
}

interface CounterpartyBankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  status: string;
}

const emptyRequestForm = () => ({
  counterpartyId: '',
  currencyId: '',
  requestedAmount: '',
  paymentCategory: 'SUPPLIER',
  paymentPurpose: '',
  requestDate: new Date().toISOString().slice(0, 10),
});

const emptyInstructionForm = () => ({
  paymentRequestId: '',
  bankAccountId: '',
  counterpartyBankAccountId: '',
  amount: '',
});

/** Treasury Layer 1 (Payment Request, approval-side) and the Payment
 * Order (PaymentInstruction, the bank submission handshake) — neither
 * had any frontend before this page; only Layer 2 execution
 * (TreasuryPaymentsPage/"Bank Payments") did. Kept as one page since the
 * two layers are used together in one workflow: request -> approve ->
 * order -> send to bank -> (BankPayment posts the actual movement). */
export function PaymentRequestsPage() {
  const { currentOrganizationId, organizations } = useOrganization();
  const { hasPermission } = useAuth();
  const { showError, showSuccess } = useToast();

  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [counterpartyBankAccounts, setCounterpartyBankAccounts] = useState<Record<string, CounterpartyBankAccount[]>>({});

  const [requestForm, setRequestForm] = useState(emptyRequestForm());
  const [instructionForm, setInstructionForm] = useState(emptyInstructionForm());
  const [approveAmountByRequest, setApproveAmountByRequest] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!currentOrganizationId) return;
    try {
      const [reqs, instrs, cps, accounts, curr] = await Promise.all([
        api.get<PaymentRequest[]>(`/organizations/${currentOrganizationId}/treasury/payment-requests`).catch(() => []),
        api.get<PaymentInstruction[]>(`/organizations/${currentOrganizationId}/treasury/payment-instructions`).catch(() => []),
        api.get<Counterparty[]>(`/organizations/${currentOrganizationId}/counterparties`),
        api.get<BankAccount[]>(`/organizations/${currentOrganizationId}/bank-accounts`),
        api.get<Currency[]>('/currencies'),
      ]);
      setRequests(reqs);
      setInstructions(instrs);
      setCounterparties(cps);
      setBankAccounts(accounts);
      setCurrencies(curr);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId]);

  const loadCounterpartyBankAccounts = async (counterpartyId: string) => {
    if (!currentOrganizationId || counterpartyBankAccounts[counterpartyId]) return;
    try {
      const cp = await api.get<{ bankAccounts: CounterpartyBankAccount[] }>(`/organizations/${currentOrganizationId}/counterparties/${counterpartyId}`);
      setCounterpartyBankAccounts((prev) => ({ ...prev, [counterpartyId]: cp.bankAccounts ?? [] }));
    } catch {
      setCounterpartyBankAccounts((prev) => ({ ...prev, [counterpartyId]: [] }));
    }
  };

  const submitRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payment-requests`, {
        requestDate: requestForm.requestDate,
        counterpartyId: requestForm.counterpartyId || undefined,
        currencyId: requestForm.currencyId,
        requestedAmount: Number(requestForm.requestedAmount),
        paymentCategory: requestForm.paymentCategory,
        paymentPurpose: requestForm.paymentPurpose || undefined,
      });
      showSuccess('Payment request created (draft)');
      setRequestForm(emptyRequestForm());
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const submitForApproval = async (r: PaymentRequest) => {
    setBusyId(r.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payment-requests/${r.id}/submit`, {});
      showSuccess('Submitted for approval');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (r: PaymentRequest) => {
    const amount = Number(approveAmountByRequest[r.id] ?? r.requestedAmount);
    setBusyId(r.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payment-requests/${r.id}/approve`, { approvedAmount: amount });
      showSuccess('Payment request approved');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r: PaymentRequest) => {
    setBusyId(r.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payment-requests/${r.id}/reject`, {});
      showSuccess('Payment request rejected');
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  const submitInstruction = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;
    const request = requests.find((r) => r.id === instructionForm.paymentRequestId);
    if (!request) return;
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payment-instructions`, {
        paymentRequestId: instructionForm.paymentRequestId,
        bankAccountId: instructionForm.bankAccountId,
        counterpartyBankAccountId: instructionForm.counterpartyBankAccountId || undefined,
        currencyId: request.currencyId,
        amount: Number(instructionForm.amount),
      });
      showSuccess('Payment order created');
      setInstructionForm(emptyInstructionForm());
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const transition = async (i: PaymentInstruction, status: string) => {
    setBusyId(i.id);
    try {
      await api.post(`/organizations/${currentOrganizationId}/treasury/payment-instructions/${i.id}/transition`, { status });
      showSuccess(`Payment order → ${status}`);
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setBusyId(null);
    }
  };

  if (organizations.length === 0) return <p className="empty-hint">Create an organization first.</p>;

  const approvedRequests = requests.filter((r) => ['APPROVED', 'PARTIALLY_APPROVED', 'PARTIALLY_PAID'].includes(r.status));
  const selectedRequest = requests.find((r) => r.id === instructionForm.paymentRequestId);

  return (
    <div>
      <div className="page-header">
        <h1>Payment Requests &amp; Orders</h1>
      </div>

      <section className="card">
        <h2>Payment Requests</h2>
        {hasPermission('treasury.payment_request.create') && (
          <form className="inline-form" onSubmit={submitRequest}>
            <label>
              Counterparty
              <select value={requestForm.counterpartyId} onChange={(e) => setRequestForm({ ...requestForm, counterpartyId: e.target.value })}>
                <option value="">—</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={requestForm.paymentCategory} onChange={(e) => setRequestForm({ ...requestForm, paymentCategory: e.target.value })}>
                {['SUPPLIER', 'PAYROLL', 'TAX', 'RENT', 'LOAN', 'CAPEX', 'OPEX', 'DIVIDEND', 'INTERNAL_TRANSFER', 'OTHER'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Currency
              <select required value={requestForm.currencyId} onChange={(e) => setRequestForm({ ...requestForm, currencyId: e.target.value })}>
                <option value="">Select…</option>
                {currencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input required type="number" step="0.01" min="0.01" value={requestForm.requestedAmount} onChange={(e) => setRequestForm({ ...requestForm, requestedAmount: e.target.value })} />
            </label>
            <label>
              Purpose
              <input value={requestForm.paymentPurpose} onChange={(e) => setRequestForm({ ...requestForm, paymentPurpose: e.target.value })} />
            </label>
            <button type="submit">Create</button>
          </form>
        )}

        <table className="data-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Counterparty</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Approval</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.number ?? r.id.slice(0, 8)}</td>
                <td>{counterparties.find((c) => c.id === r.counterpartyId)?.name ?? '—'}</td>
                <td className="numeric">{Number(r.requestedAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>{r.status}</td>
                <td>{r.approvalStatus}</td>
                <td>
                  {r.status === 'DRAFT' && hasPermission('treasury.payment_request.create') && (
                    <button disabled={busyId === r.id} onClick={() => submitForApproval(r)}>
                      Submit
                    </button>
                  )}
                  {r.status === 'PENDING_APPROVAL' && hasPermission('treasury.payment_request.approve') && (
                    <>
                      <input
                        type="number"
                        step="0.01"
                        style={{ width: '6rem' }}
                        placeholder={r.requestedAmount}
                        value={approveAmountByRequest[r.id] ?? ''}
                        onChange={(e) => setApproveAmountByRequest((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      <button disabled={busyId === r.id} onClick={() => approve(r)}>
                        Approve
                      </button>
                      <button disabled={busyId === r.id} onClick={() => reject(r)}>
                        Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-hint">
                  No payment requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Payment Orders</h2>
        {hasPermission('treasury.payment_plan') && (
          <form className="inline-form" onSubmit={submitInstruction}>
            <label>
              Approved request
              <select
                required
                value={instructionForm.paymentRequestId}
                onChange={(e) => {
                  const req = requests.find((r) => r.id === e.target.value);
                  setInstructionForm({ ...instructionForm, paymentRequestId: e.target.value, amount: req?.approvedAmount ?? '', counterpartyBankAccountId: '' });
                  if (req?.counterpartyId) loadCounterpartyBankAccounts(req.counterpartyId);
                }}
              >
                <option value="">Select…</option>
                {approvedRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number ?? r.id.slice(0, 8)} — {Number(r.approvedAmount).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Our bank account
              <select required value={instructionForm.bankAccountId} onChange={(e) => setInstructionForm({ ...instructionForm, bankAccountId: e.target.value })}>
                <option value="">Select…</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankName} — {a.iban}
                  </option>
                ))}
              </select>
            </label>
            {selectedRequest?.counterpartyId && (
              <label>
                Beneficiary account
                <select value={instructionForm.counterpartyBankAccountId} onChange={(e) => setInstructionForm({ ...instructionForm, counterpartyBankAccountId: e.target.value })}>
                  <option value="">—</option>
                  {(counterpartyBankAccounts[selectedRequest.counterpartyId] ?? []).map((a) => (
                    <option key={a.id} value={a.id} disabled={a.status !== 'APPROVED'}>
                      {a.bankName} — {a.accountNumber} ({a.status})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Amount
              <input required type="number" step="0.01" min="0.01" value={instructionForm.amount} onChange={(e) => setInstructionForm({ ...instructionForm, amount: e.target.value })} />
            </label>
            <button type="submit">Create payment order</button>
          </form>
        )}

        <table className="data-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Request</th>
              <th>Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {instructions.map((i) => (
              <tr key={i.id}>
                <td>{i.number ?? i.id.slice(0, 8)}</td>
                <td>{requests.find((r) => r.id === i.paymentRequestId)?.number ?? i.paymentRequestId.slice(0, 8)}</td>
                <td className="numeric">{Number(i.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>{i.status}</td>
                <td>
                  {hasPermission('treasury.payment_plan') && i.status === 'DRAFT' && (
                    <button disabled={busyId === i.id} onClick={() => transition(i, 'READY')}>
                      Mark ready
                    </button>
                  )}
                  {hasPermission('treasury.payment_plan') && i.status === 'READY' && (
                    <button disabled={busyId === i.id} onClick={() => transition(i, 'SENT_TO_BANK')}>
                      Send to bank
                    </button>
                  )}
                  {hasPermission('treasury.payment_plan') && i.status === 'SENT_TO_BANK' && (
                    <>
                      <button disabled={busyId === i.id} onClick={() => transition(i, 'ACCEPTED_BY_BANK')}>
                        Accepted
                      </button>
                      <button disabled={busyId === i.id} onClick={() => transition(i, 'REJECTED_BY_BANK')}>
                        Rejected
                      </button>
                    </>
                  )}
                  {hasPermission('treasury.payment_plan') && i.status === 'ACCEPTED_BY_BANK' && (
                    <button disabled={busyId === i.id} onClick={() => transition(i, 'EXECUTED')}>
                      Executed
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {instructions.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-hint">
                  No payment orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
