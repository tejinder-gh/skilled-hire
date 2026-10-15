// packages/contracts/src/quote-review.ts
import type { QuoteItemType, QuoteStatus, ChangeOrderStatus } from "./index.js";

export const ONTARIO_LABOUR_ONLY_DISCLAIMER =
  "Under the Ontario Consumer Protection Act and TSSA Fuel Safety regulations, customer-supplied materials/equipment carry no contractor or marketplace warranty. The contractor warranties installation workmanship only. The customer assumes all liability for pre-existing defects, non-compliance, unsuitability, or manufacturer failures.";

export interface ItemizedQuoteItemDTO {
  id: string;
  type: QuoteItemType;
  title: string;
  description?: string | null | undefined;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  isCustomerSupplied: boolean;
  warrantyCaveat?: string | null | undefined;
  materialMetadata?: Record<string, unknown> | null | undefined;
}

export interface DetailedQuoteDTO {
  id: string;
  jobId: string;
  version: number;
  status: QuoteStatus;
  diagnosticFeeCents: number;
  laborSubtotalCents: number;
  materialsSubtotalCents: number;
  disposalSubtotalCents: number;
  permitsSubtotalCents: number;
  customerSuppliedPartsCaveat?: string | null | undefined;
  customerSuppliedAcknowledged: boolean;
  contractorSubtotalCents: number;
  platformFeeCents: number;
  discountCents: number;
  taxCents: number;
  customerTotalCents: number;
  currency: string;
  notes?: string | null | undefined;
  items: ItemizedQuoteItemDTO[];
  expiresAt: string;
  acceptedAt?: string | null | undefined;
  acceptedBy?: string | null | undefined;
  declineReason?: string | null | undefined;
  declinedAt?: string | null | undefined;
  declinedBy?: string | null | undefined;
  createdAt: string;
}

export interface CreateItemizedQuoteRequest {
  items: Array<{
    type: QuoteItemType;
    title: string;
    description?: string | undefined;
    quantity: number;
    unitPriceCents: number;
    isCustomerSupplied?: boolean | undefined;
    warrantyCaveat?: string | undefined;
    materialMetadata?: Record<string, unknown> | undefined;
  }>;
  diagnosticFeeCents?: number | undefined;
  discountCents?: number | undefined;
  notes?: string | undefined;
  expiresAt: string;
  customerSuppliedPartsCaveat?: string | undefined;
}

export interface AcceptQuoteRequest {
  customerSuppliedAcknowledged?: boolean | undefined;
  notes?: string | undefined;
}

export interface DeclineQuoteRequest {
  reason: string;
  notes?: string | undefined;
}

export interface DetailedChangeOrderDTO {
  id: string;
  jobId: string;
  version: number;
  status: ChangeOrderStatus;
  reason: string;
  explanation: string;
  attachmentKeys: string[];
  diagnosticFeeCents: number;
  laborSubtotalCents: number;
  materialsSubtotalCents: number;
  disposalSubtotalCents: number;
  permitsSubtotalCents: number;
  customerSuppliedPartsCaveat?: string | null | undefined;
  customerSuppliedAcknowledged: boolean;
  contractorSubtotalCents: number;
  platformFeeCents: number;
  taxCents: number;
  customerTotalCents: number;
  currency: string;
  items: ItemizedQuoteItemDTO[];
  expiresAt: string;
  acceptedAt?: string | null | undefined;
  acceptedBy?: string | null | undefined;
  declineReason?: string | null | undefined;
  declinedAt?: string | null | undefined;
  declinedBy?: string | null | undefined;
  customerAcknowledgedAt?: string | null | undefined;
  createdAt: string;
}

export interface CreateItemizedChangeOrderRequest {
  reason: string;
  explanation: string;
  attachmentKeys: string[];
  items: Array<{
    type: QuoteItemType;
    title: string;
    description?: string | undefined;
    quantity: number;
    unitPriceCents: number;
    isCustomerSupplied?: boolean | undefined;
    warrantyCaveat?: string | undefined;
    materialMetadata?: Record<string, unknown> | undefined;
  }>;
  customerSuppliedPartsCaveat?: string | undefined;
  expiresAt: string;
}

export interface DeclineChangeOrderRequest {
  reason: string;
  notes?: string | undefined;
}
