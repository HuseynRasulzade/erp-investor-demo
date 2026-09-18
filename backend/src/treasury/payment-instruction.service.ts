import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const SEQUENCE_PREFIX = 'PAYORD';
const SEQUENCE_CODE = 'PAYMENT_INSTRUCTION';

/**
 * PaymentInstructionService (spec sections 23-25). Not a
 * DocumentFramework document — it never posts accounting or moves cash
 * (spec section 25: "Payment Instruction is NOT bank execution"); its own
 * status lifecycle tracks the bank submission handshake only.
 * `SettlementPaymentPostingHandler`/`BankPaymentService` reference it via
 * `paymentInstructionId` once the actual `SettlementPayment` posts.
 */
@Injectable()
export class PaymentInstructionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { paymentRequestId: string; bankAccountId: string; counterpartyBankAccountId?: string; beneficiaryName?: string; beneficiaryBankDetails?: string; currencyId: string; amount: number; executionDate?: string; purpose?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const request = await this.prisma.paymentRequest.findFirst({ where: { id: dto.paymentRequestId, tenantId, organizationId } });
    if (!request) throw new NotFoundAppError('PaymentRequest', dto.paymentRequestId);
    if (!['APPROVED', 'PARTIALLY_APPROVED', 'PARTIALLY_PAID'].includes(request.status)) {
      throw new ValidationAppError('A payment instruction can only be created from an approved payment request');
    }

    if (dto.counterpartyBankAccountId) {
      const account = await this.prisma.counterpartyBankAccount.findFirst({ where: { id: dto.counterpartyBankAccountId, tenantId } });
      if (!account) throw new NotFoundAppError('CounterpartyBankAccount', dto.counterpartyBankAccountId);
      if (account.status !== 'APPROVED') {
        throw new ValidationAppError('Cannot pay to a counterparty bank account that is not approved');
      }
    }

    await this.ensureSequence(tenantId);
    const businessDate = dto.executionDate ? new Date(dto.executionDate) : new Date();

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SEQUENCE_CODE, businessDate, tx);
      const row = await tx.paymentInstruction.create({
        data: { tenantId, organizationId, number: allocated.formatted, paymentRequestId: dto.paymentRequestId, bankAccountId: dto.bankAccountId, counterpartyBankAccountId: dto.counterpartyBankAccountId, beneficiaryName: dto.beneficiaryName, beneficiaryBankDetails: dto.beneficiaryBankDetails, currencyId: dto.currencyId, amount: dto.amount.toString(), executionDate: dto.executionDate ? new Date(dto.executionDate) : undefined, purpose: dto.purpose, status: 'DRAFT', createdBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_INSTRUCTION_CREATED', entityType: 'PAYMENT_INSTRUCTION', entityId: row.id, action: 'CREATE', userId, newValues: { number: row.number, amount: dto.amount } }, tx);
      return row;
    });
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SEQUENCE_CODE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SEQUENCE_CODE, documentType: SEQUENCE_CODE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }

  async transition(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, status: string, bankReference?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.paymentInstruction.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('PaymentInstruction', id);
    if (['SENT_TO_BANK', 'EXECUTED'].includes(status) && row.counterpartyBankAccountId) {
      const account = await this.prisma.counterpartyBankAccount.findFirst({ where: { id: row.counterpartyBankAccountId, tenantId } });
      if (!account || account.status !== 'APPROVED') {
        throw new ValidationAppError('Cannot send/execute a payment to a counterparty bank account that is not approved');
      }
    }
    if (status === 'SENT_TO_BANK') {
      // Segregation of duties: whoever approved the underlying Payment
      // Request cannot also be the one who sends it to the bank.
      const approval = await this.prisma.paymentApproval.findFirst({
        where: { paymentRequestId: row.paymentRequestId, decision: { in: ['APPROVED', 'PARTIALLY_APPROVED'] }, approverUserId: userId },
      });
      if (approval) {
        throw new ValidationAppError('Cannot send a payment to the bank that you yourself approved');
      }
    }
    return this.prisma.paymentInstruction.update({ where: { id }, data: { status, bankReference: bankReference ?? row.bankReference } });
  }

  list(tenantId: string, organizationId: string, paymentRequestId?: string) {
    return this.prisma.paymentInstruction.findMany({ where: { tenantId, organizationId, paymentRequestId }, orderBy: { createdAt: 'desc' } });
  }
}
